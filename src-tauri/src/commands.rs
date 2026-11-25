// Comandos que la interfaz llama con invoke(). Todo lo de ffmpeg pasa por run_process (array de
// argumentos, sin consola, cancelable) y solo con los binarios ffmpeg/ffprobe.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{oneshot, Semaphore};

use crate::binaries::{resolve_tool, Tool};
use crate::files::{
    cache_key, file_stamp, is_inside, jpeg_size, sanitize_file_stem, unique_path, write_atomic,
};
use crate::process::{run_process, LineSink, ProcessRegistry, Stream, ToolOutput};

/// Texto de error que la interfaz traduce a CancelledError.
pub const CANCELLED: &str = "__cancelled__";

/// Extensiones que ofrece el diálogo de elegir vídeos.
pub const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "mkv", "avi", "webm", "m4v", "3gp", "mts", "m2ts", "mpg", "wmv"];

/// Procesos de miniaturas a la vez.
const THUMBNAIL_CONCURRENCY: usize = 3;
const OUTPUT_FOLDER_NAME: &str = "Mis montajes";
const RECORDINGS_FOLDER_NAME: &str = "Grabaciones";
const AUTOSAVE_FILE: &str = "autosave.json";
const PROJECT_EXTENSION: &str = "easycut";

struct Recording {
    file: Option<fs::File>,
    temp_path: PathBuf,
    stem: String,
    output_path: Option<PathBuf>,
}

pub struct AppState {
    pub registry: Arc<ProcessRegistry>,
    thumbnail_slots: Semaphore,
    recordings: Mutex<HashMap<String, Recording>>,
    counter: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            registry: Arc::new(ProcessRegistry::default()),
            thumbnail_slots: Semaphore::new(THUMBNAIL_CONCURRENCY),
            recordings: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(1),
        }
    }
}

impl AppState {
    fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::Relaxed)
    }
}

fn io_err(context: &str) -> impl Fn(std::io::Error) -> String + '_ {
    move |e| format!("{context}: {e}")
}

fn cache_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join(sub);
    fs::create_dir_all(&dir).map_err(io_err("No se puede crear la carpeta de caché"))?;
    Ok(dir)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(io_err("No se puede crear la carpeta de datos"))?;
    Ok(dir)
}

fn output_folder(app: &AppHandle) -> Result<PathBuf, String> {
    let videos = app.path().video_dir().map_err(|e| format!("No se encuentra la carpeta Vídeos: {e}"))?;
    let dir = videos.join(OUTPUT_FOLDER_NAME);
    fs::create_dir_all(&dir).map_err(io_err("No se puede crear la carpeta de los montajes"))?;
    Ok(dir)
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn file_paths(paths: Vec<FilePath>) -> Vec<String> {
    paths.into_iter().filter_map(|p| p.into_path().ok()).map(|p| path_string(&p)).collect()
}

// ---------------------------------------------------------------- procesos

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EventStream {
    Stdout,
    Stderr,
    /// Último mensaje del canal: la interfaz espera a recibirlo para no perder líneas que lleguen
    /// después de la respuesta de invoke (el canal y la respuesta no van ordenados entre sí).
    End,
}

#[derive(Clone, Serialize)]
pub struct LineEvent {
    stream: EventStream,
    line: String,
}

/// Ejecuta ffmpeg o ffprobe. Con `capture`, devuelve stdout/stderr enteros; si no, manda cada línea por el canal.
/// En los dos casos, el canal acaba con un mensaje `end`.
#[tauri::command]
pub async fn run_tool(
    state: State<'_, AppState>,
    tool: String,
    args: Vec<String>,
    job_id: String,
    capture: bool,
    on_line: Channel<LineEvent>,
) -> Result<ToolOutput, String> {
    let program = resolve_tool(Tool::parse(&tool)?)?;
    let sink: Option<LineSink> = if capture {
        None
    } else {
        let channel = on_line.clone();
        Some(Arc::new(move |stream, line: &str| {
            let stream = match stream {
                Stream::Stdout => EventStream::Stdout,
                Stream::Stderr => EventStream::Stderr,
            };
            let _ = channel.send(LineEvent { stream, line: line.to_string() });
        }))
    };
    let result = run_process(&state.registry, &program, &args, &job_id, capture, sink).await;
    let _ = on_line.send(LineEvent { stream: EventStream::End, line: String::new() });
    result
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: String) {
    state.registry.cancel(&job_id);
}

// ---------------------------------------------------------------- miniaturas y caché

#[derive(Serialize)]
pub struct ThumbnailFile {
    path: String,
    width: u32,
    height: u32,
}

fn read_thumbnail(path: &Path) -> Option<ThumbnailFile> {
    let bytes = fs::read(path).ok()?;
    let (width, height) = jpeg_size(&bytes)?;
    Some(ThumbnailFile { path: path_string(path), width, height })
}

/// Genera (o reutiliza de la caché) un JPG del instante `time_ms` con este alto.
#[tauri::command]
pub async fn make_thumbnail(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    time_ms: u64,
    height: u32,
    job_id: String,
) -> Result<ThumbnailFile, String> {
    let height = height.clamp(16, 1080) & !1;
    let stamp = file_stamp(Path::new(&path)).map_err(|e| format!("No se encuentra el vídeo {path}: {e}"))?;
    let key = cache_key(&path, &stamp, &["thumb-v1", &time_ms.to_string(), &height.to_string()]);
    let dir = cache_dir(&app, "thumbs")?;
    let final_path = dir.join(format!("{key}.jpg"));
    if let Some(found) = read_thumbnail(&final_path) {
        return Ok(found);
    }
    if state.registry.is_cancelled(&job_id) {
        return Err(CANCELLED.into());
    }
    let _slot = state.thumbnail_slots.acquire().await.map_err(|e| e.to_string())?;
    // Otro trabajo pudo generarla mientras se esperaba turno.
    if let Some(found) = read_thumbnail(&final_path) {
        return Ok(found);
    }
    let tmp = dir.join(format!("{key}.{}.part.jpg", state.next_id()));
    let args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-nostdin".into(),
        "-y".into(),
        "-ss".into(),
        format!("{:.3}", time_ms as f64 / 1000.0),
        "-i".into(),
        path.clone(),
        "-map".into(),
        "0:v:0".into(),
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
        "-sn".into(),
        "-vf".into(),
        format!("scale=-2:{height}"),
        "-q:v".into(),
        "5".into(),
        "-update".into(),
        "1".into(),
        path_string(&tmp),
    ];
    let program = resolve_tool(Tool::Ffmpeg)?;
    let out = run_process(&state.registry, &program, &args, &job_id, true, None).await?;
    if out.cancelled {
        let _ = fs::remove_file(&tmp);
        return Err(CANCELLED.into());
    }
    let Some(_) = read_thumbnail(&tmp) else {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "No se ha podido sacar la imagen del segundo {:.1}: {}",
            time_ms as f64 / 1000.0,
            out.stderr.trim()
        ));
    };
    if fs::rename(&tmp, &final_path).is_err() {
        let _ = fs::remove_file(&tmp);
    }
    read_thumbnail(&final_path).ok_or_else(|| "No se ha podido guardar la miniatura.".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    path: String,
    tmp_path: String,
    exists: bool,
}

/// Dónde va (o está ya) el derivado cacheado de un original. Por ahora, solo el proxy de vista previa.
#[tauri::command]
pub fn cache_entry(app: AppHandle, state: State<'_, AppState>, kind: String, path: String) -> Result<CacheEntry, String> {
    let (sub, ext, version) = match kind.as_str() {
        "proxy" => ("proxies", "mp4", "proxy-v1"),
        other => return Err(format!("Tipo de caché desconocido: {other}")),
    };
    let stamp = file_stamp(Path::new(&path)).map_err(|e| format!("No se encuentra el vídeo {path}: {e}"))?;
    let key = cache_key(&path, &stamp, &[version]);
    let dir = cache_dir(&app, sub)?;
    let final_path = dir.join(format!("{key}.{ext}"));
    let tmp_path = dir.join(format!("{key}.{}.part.{ext}", state.next_id()));
    let exists = fs::metadata(&final_path).map(|m| m.len() > 0).unwrap_or(false);
    Ok(CacheEntry { path: path_string(&final_path), tmp_path: path_string(&tmp_path), exists })
}

fn ensure_in_cache(app: &AppHandle, path: &Path) -> Result<(), String> {
    let root = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    if is_inside(path, &root) {
        Ok(())
    } else {
        Err("Solo se pueden mover o borrar ficheros de la caché de la aplicación.".into())
    }
}

#[tauri::command]
pub fn promote_cache_file(app: AppHandle, tmp_path: String, final_path: String) -> Result<(), String> {
    let (tmp, dest) = (PathBuf::from(&tmp_path), PathBuf::from(&final_path));
    ensure_in_cache(&app, &tmp)?;
    ensure_in_cache(&app, &dest)?;
    fs::rename(&tmp, &dest).map_err(io_err("No se ha podido guardar el fichero en la caché"))
}

#[tauri::command]
pub fn discard_cache_file(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(());
    }
    ensure_in_cache(&app, &p)?;
    fs::remove_file(&p).map_err(io_err("No se ha podido borrar el fichero temporal"))
}

/// Fichero de texto temporal (p. ej. el filter_complex) en la caché de la app.
#[tauri::command]
pub fn write_temp_text_file(app: AppHandle, state: State<'_, AppState>, name: String, contents: String) -> Result<String, String> {
    let dir = cache_dir(&app, "tmp")?;
    let safe = sanitize_file_stem(&name, "temporal.txt");
    let path = dir.join(format!("{}-{safe}", state.next_id()));
    fs::write(&path, contents).map_err(io_err("No se ha podido escribir el fichero temporal"))?;
    Ok(path_string(&path))
}

// ---------------------------------------------------------------- diálogos y carpetas

#[tauri::command]
pub async fn pick_videos(
    app: AppHandle,
    window: WebviewWindow,
    multiple: bool,
    default_folder: Option<String>,
) -> Result<Vec<String>, String> {
    let folder = default_folder.map(PathBuf::from).filter(|p| p.is_dir()).or_else(|| app.path().video_dir().ok());
    let mut dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(if multiple { "Elige los vídeos" } else { "Elige un vídeo" })
        .add_filter("Vídeos", VIDEO_EXTENSIONS);
    if let Some(folder) = folder {
        dialog = dialog.set_directory(folder);
    }
    let (tx, rx) = oneshot::channel();
    if multiple {
        dialog.pick_files(move |picked| {
            let _ = tx.send(picked.map(file_paths).unwrap_or_default());
        });
    } else {
        dialog.pick_file(move |picked| {
            let _ = tx.send(picked.map(|p| file_paths(vec![p])).unwrap_or_default());
        });
    }
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_output_folder(app: AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().set_parent(&window).set_title("Elige dónde guardar los vídeos");
    if let Ok(folder) = output_folder(&app) {
        dialog = dialog.set_directory(folder);
    }
    let (tx, rx) = oneshot::channel();
    dialog.pick_folder(move |picked| {
        let _ = tx.send(picked.and_then(|p| p.into_path().ok()).map(|p| path_string(&p)));
    });
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_output_folder(app: AppHandle) -> Result<String, String> {
    output_folder(&app).map(|p| path_string(&p))
}

#[tauri::command]
pub fn list_file_names(folder: String) -> Result<Vec<String>, String> {
    match fs::read_dir(&folder) {
        Ok(entries) => Ok(entries.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("No se puede leer la carpeta {folder}: {e}")),
    }
}

/// Borra un vídeo a medias de la carpeta de los montajes (exportación cancelada o fallida).
/// Solo .mp4 dentro de Vídeos\Mis montajes: nunca un original. Reintenta unas veces porque ffmpeg
/// puede tardar un instante en soltar el fichero tras matarlo.
#[tauri::command]
pub async fn delete_partial_output(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let is_mp4 = p.extension().map(|e| e.eq_ignore_ascii_case("mp4")).unwrap_or(false);
    let root = output_folder(&app)?;
    if !is_mp4 || !is_inside(&p, &root) {
        return Err("Solo se pueden borrar vídeos a medias de la carpeta de los montajes.".into());
    }
    let mut last_error = None;
    for _ in 0..20 {
        if !p.exists() {
            return Ok(());
        }
        match fs::remove_file(&p) {
            Ok(()) => return Ok(()),
            Err(e) => last_error = Some(e),
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }
    Err(format!(
        "No se ha podido borrar el vídeo a medias {path}: {}",
        last_error.map(|e| e.to_string()).unwrap_or_default()
    ))
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
pub fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(&path, None::<&str>).map_err(|e| format!("No se ha podido abrir {path}: {e}"))
}

/// Explorador con el fichero seleccionado (o la carpeta abierta, si es una carpeta).
#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let result = if p.is_dir() {
        app.opener().open_path(&path, None::<&str>)
    } else {
        app.opener().reveal_item_in_dir(&p)
    };
    result.map_err(|e| format!("No se ha podido mostrar {path} en el Explorador: {e}"))
}

/// Copia el fichero al portapapeles como «fichero» (CF_HDROP), para pegarlo con Ctrl+V en WhatsApp o el Explorador.
#[tauri::command]
pub async fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    if !Path::new(&path).is_file() {
        return Err(format!("No existe el fichero {path}"));
    }
    #[cfg(windows)]
    {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let powershell = PathBuf::from(system_root).join("System32\\WindowsPowerShell\\v1.0\\powershell.exe");
        // La ruta va por variable de entorno, no dentro del texto del comando: nada que escapar ni inyectar.
        let mut cmd = tokio::process::Command::new(powershell);
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-STA",
            "-Command",
            "Set-Clipboard -LiteralPath $env:EASY_CUT_CLIPBOARD_PATH",
        ])
        .env("EASY_CUT_CLIPBOARD_PATH", &path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .creation_flags(crate::process::CREATE_NO_WINDOW);
        let out = cmd.output().await.map_err(|e| format!("No se ha podido copiar al portapapeles: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "No se ha podido copiar al portapapeles: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Copiar ficheros al portapapeles solo está hecho para Windows.".into())
    }
}

// ---------------------------------------------------------------- proyecto

#[tauri::command]
pub fn save_autosave(app: AppHandle, json: String) -> Result<(), String> {
    write_atomic(&data_dir(&app)?.join(AUTOSAVE_FILE), json.as_bytes()).map_err(io_err("No se ha podido guardar el proyecto"))
}

#[tauri::command]
pub fn load_autosave(app: AppHandle) -> Result<Option<String>, String> {
    match fs::read_to_string(data_dir(&app)?.join(AUTOSAVE_FILE)) {
        Ok(json) => Ok(Some(json)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("No se ha podido leer el proyecto guardado: {e}")),
    }
}

#[tauri::command]
pub fn clear_autosave(app: AppHandle) -> Result<(), String> {
    match fs::remove_file(data_dir(&app)?.join(AUTOSAVE_FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("No se ha podido borrar el proyecto: {e}")),
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn save_project(app: AppHandle, window: WebviewWindow, json: String, path: Option<String>) -> Result<Option<String>, String> {
    let target = match path {
        Some(p) => Some(PathBuf::from(p)),
        None => {
            let (tx, rx) = oneshot::channel();
            let mut dialog = app
                .dialog()
                .file()
                .set_parent(&window)
                .set_title("Guardar el proyecto")
                .set_file_name(format!("Proyecto.{PROJECT_EXTENSION}"))
                .add_filter("Proyecto de Easy Cut", &[PROJECT_EXTENSION]);
            if let Ok(dir) = output_folder(&app) {
                dialog = dialog.set_directory(dir);
            }
            dialog.save_file(move |p| {
                let _ = tx.send(p.and_then(|p| p.into_path().ok()));
            });
            rx.await.map_err(|e| e.to_string())?
        }
    };
    let Some(target) = target else { return Ok(None) };
    write_atomic(&target, json.as_bytes()).map_err(io_err("No se ha podido guardar el proyecto"))?;
    Ok(Some(path_string(&target)))
}

#[derive(Serialize)]
pub struct LoadedProject {
    path: String,
    json: String,
}

#[tauri::command]
pub async fn load_project(app: AppHandle, window: WebviewWindow, path: Option<String>) -> Result<Option<LoadedProject>, String> {
    let source = match path {
        Some(p) => Some(PathBuf::from(p)),
        None => {
            let (tx, rx) = oneshot::channel();
            let mut dialog = app
                .dialog()
                .file()
                .set_parent(&window)
                .set_title("Abrir un proyecto")
                .add_filter("Proyecto de Easy Cut", &[PROJECT_EXTENSION]);
            if let Ok(dir) = output_folder(&app) {
                dialog = dialog.set_directory(dir);
            }
            dialog.pick_file(move |p| {
                let _ = tx.send(p.and_then(|p| p.into_path().ok()));
            });
            rx.await.map_err(|e| e.to_string())?
        }
    };
    let Some(source) = source else { return Ok(None) };
    let json = fs::read_to_string(&source).map_err(io_err("No se ha podido abrir el proyecto"))?;
    Ok(Some(LoadedProject { path: path_string(&source), json }))
}

// ---------------------------------------------------------------- grabaciones

/// Quita una extensión de vídeo que venga en el nombre sugerido.
fn recording_stem(suggested: &str) -> String {
    let lower = suggested.to_lowercase();
    let trimmed = [".webm", ".mp4", ".mkv"]
        .iter()
        .find(|ext| lower.ends_with(*ext))
        .map(|ext| &suggested[..suggested.len() - ext.len()])
        .unwrap_or(suggested);
    sanitize_file_stem(trimmed, "Grabación")
}

/// Empieza a recibir una grabación. Los datos llegan por trozos con recording_append.
#[tauri::command]
pub fn recording_begin(app: AppHandle, state: State<'_, AppState>, suggested_name: String) -> Result<String, String> {
    let dir = cache_dir(&app, "recordings")?;
    let token = format!("rec-{}-{}", std::process::id(), state.next_id());
    let temp_path = dir.join(format!("{token}.webm"));
    let file = fs::File::create(&temp_path).map_err(io_err("No se ha podido empezar a guardar la grabación"))?;
    state.recordings.lock().unwrap().insert(
        token.clone(),
        Recording { file: Some(file), temp_path, stem: recording_stem(&suggested_name), output_path: None },
    );
    Ok(token)
}

/// Un trozo de la grabación, en el cuerpo binario de invoke (cabecera `x-recording-token`).
#[tauri::command]
pub fn recording_append(state: State<'_, AppState>, request: Request<'_>) -> Result<(), String> {
    let token = request
        .headers()
        .get("x-recording-token")
        .and_then(|v| v.to_str().ok())
        .ok_or("Falta la cabecera x-recording-token")?
        .to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("La grabación tiene que llegar como datos binarios".into());
    };
    let mut recordings = state.recordings.lock().unwrap();
    let rec = recordings.get_mut(&token).ok_or("Grabación desconocida")?;
    let file = rec.file.as_mut().ok_or("La grabación ya está cerrada")?;
    file.write_all(bytes).map_err(io_err("No se ha podido guardar la grabación"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingTargets {
    temp_path: String,
    output_path: String,
}

/// Cierra la grabación y reserva el MP4 de destino en Vídeos\Mis montajes\Grabaciones, sin sobrescribir.
#[tauri::command]
pub fn recording_finish(app: AppHandle, state: State<'_, AppState>, token: String) -> Result<RecordingTargets, String> {
    let folder = output_folder(&app)?.join(RECORDINGS_FOLDER_NAME);
    fs::create_dir_all(&folder).map_err(io_err("No se puede crear la carpeta de grabaciones"))?;
    let mut recordings = state.recordings.lock().unwrap();
    let rec = recordings.get_mut(&token).ok_or("Grabación desconocida")?;
    if let Some(mut file) = rec.file.take() {
        file.flush().map_err(io_err("No se ha podido cerrar la grabación"))?;
    }
    let output = unique_path(&folder, &rec.stem, "mp4").map_err(io_err("No se puede leer la carpeta de grabaciones"))?;
    // Fichero vacío que reserva el nombre; ffmpeg lo sobrescribe con -y.
    fs::File::create(&output).map_err(io_err("No se puede crear el vídeo de la grabación"))?;
    rec.output_path = Some(output.clone());
    Ok(RecordingTargets { temp_path: path_string(&rec.temp_path), output_path: path_string(&output) })
}

/// Tras convertir: si salió bien, borra el WebM temporal; si no, lo deja en Grabaciones (no se pierde
/// nada) y devuelve su ruta.
#[tauri::command]
pub fn recording_cleanup(app: AppHandle, state: State<'_, AppState>, token: String, success: bool) -> Result<Option<String>, String> {
    let rec = state.recordings.lock().unwrap().remove(&token).ok_or("Grabación desconocida")?;
    drop(rec.file);
    if success {
        let _ = fs::remove_file(&rec.temp_path);
        return Ok(None);
    }
    if let Some(output) = &rec.output_path {
        let _ = fs::remove_file(output);
    }
    let folder = output_folder(&app)?.join(RECORDINGS_FOLDER_NAME);
    fs::create_dir_all(&folder).map_err(io_err("No se puede crear la carpeta de grabaciones"))?;
    let kept = unique_path(&folder, &rec.stem, "webm").map_err(io_err("No se puede leer la carpeta de grabaciones"))?;
    // rename falla entre unidades distintas: entonces, copiar y borrar.
    if fs::rename(&rec.temp_path, &kept).is_err() {
        fs::copy(&rec.temp_path, &kept).map_err(io_err("No se ha podido conservar la grabación"))?;
        let _ = fs::remove_file(&rec.temp_path);
    }
    Ok(Some(path_string(&kept)))
}

#[cfg(test)]
mod tests {
    use super::recording_stem;

    #[test]
    fn recording_stem_drops_video_extensions() {
        assert_eq!(recording_stem("Toma 1.webm"), "Toma 1");
        assert_eq!(recording_stem("Toma 1.MP4"), "Toma 1");
        assert_eq!(recording_stem("Toma: 1"), "Toma 1");
        assert_eq!(recording_stem(""), "Grabación");
        assert_eq!(recording_stem("notas.txt"), "notas.txt");
    }
}
