// Biblioteca de sonidos y efectos: descarga bajo demanda de los ficheros (assets de una release de GitHub) a la
// caché de la app, con progreso, cancelación, reintentos y comprobación del SHA-256; uso sin conexión de lo ya
// descargado y el catálogo actualizado. Solo se descarga de los hosts de las releases de GitHub, por https, y
// con nombres de fichero saneados. Nada de lo descargado se ejecuta: son vídeos, sonidos e imágenes que se
// reproducen o que lee ffmpeg.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::commands::{AppState, CANCELLED};

/// Hosts permitidos (los mismos que LIBRARY_HOSTS de src/domain/library.ts).
pub const ALLOWED_HOSTS: &[&str] = &["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
/// Tamaño máximo de un fichero de la biblioteca y del catálogo.
const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
const MAX_CATALOG_BYTES: u64 = 1024 * 1024;
const CATALOG_CACHE: &str = "catalog.json";
const ATTEMPTS: u32 = 3;
const USER_AGENT: &str = concat!("easy-cut/", env!("CARGO_PKG_VERSION"));

/// Descargas en marcha que se pueden cancelar (por id de trabajo, como los procesos).
#[derive(Default)]
pub struct Downloads {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Downloads {
    fn start(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.flags.lock().unwrap().insert(job_id.to_string(), flag.clone());
        flag
    }
    fn finish(&self, job_id: &str) {
        self.flags.lock().unwrap().remove(job_id);
    }
    /// Marca la descarga como cancelada (si la hay). La llama cancel_job.
    pub fn cancel(&self, job_id: &str) {
        if let Some(flag) = self.flags.lock().unwrap().get(job_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// ¿Es un nombre de fichero seguro? Minúsculas, números, «.», «-» y «_», sin rutas (como SAFE_FILE_NAME en TS).
pub fn is_safe_file_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 91
        && bytes[0].is_ascii_alphanumeric()
        && !name.contains("..")
        && bytes.iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'_'))
}

pub fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// ¿Se puede descargar de esta URL? (https, sin usuario ni contraseña, y uno de los hosts permitidos).
pub fn is_allowed_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().map(|h| ALLOWED_HOSTS.contains(&h)).unwrap_or(false)
}

/// Nombre en la caché: el principio del SHA-256 delante, para que una versión nueva con el mismo nombre no pise a la vieja.
pub fn cache_file_name(file: &str, sha256: &str) -> String {
    format!("{}-{file}", &sha256[..16])
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let base = if cfg!(debug_assertions) { base.join("pruebas") } else { base };
    let dir = base.join("library");
    fs::create_dir_all(&dir).map_err(|e| format!("No se puede crear la carpeta de la biblioteca: {e}"))?;
    Ok(dir)
}

/// En desarrollo, la carpeta local con los ficheros generados (library/dist del repo, o EASY_CUT_LIBRARY_DIR),
/// para poder usar la biblioteca antes de que exista la release. En la app instalada, nunca.
fn local_source_dir() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    if let Ok(dir) = std::env::var("EASY_CUT_LIBRARY_DIR") {
        let p = PathBuf::from(dir);
        return p.is_dir().then_some(p);
    }
    #[cfg(debug_assertions)]
    {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("library").join("dist");
        if p.is_dir() {
            return Some(p);
        }
    }
    None
}

fn sha256_of(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("No se puede leer {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProgress {
    received: u64,
    total: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    file: String,
    sha256: String,
}

fn check_entry(file: &str, sha256: &str) -> Result<(), String> {
    if !is_safe_file_name(file) {
        return Err(format!("Nombre de fichero de la biblioteca no válido: {file}"));
    }
    if !is_sha256(sha256) {
        return Err("SHA-256 no válido en el catálogo de la biblioteca.".into());
    }
    Ok(())
}

/// Qué ficheros de la biblioteca ya están en la caché (ruta) y cuáles no (null). Sin red: para saber qué se
/// puede usar sin conexión.
#[tauri::command]
pub fn library_status(app: AppHandle, entries: Vec<LibraryEntry>) -> Result<Vec<Option<String>>, String> {
    let dir = library_dir(&app)?;
    Ok(entries
        .iter()
        .map(|e| {
            if check_entry(&e.file, &e.sha256).is_err() {
                return None;
            }
            let p = dir.join(cache_file_name(&e.file, &e.sha256));
            p.is_file().then(|| p.to_string_lossy().into_owned())
        })
        .collect())
}

fn client() -> Result<reqwest::Client, String> {
    // reqwest con rustls sin proveedor (el mismo que usa el actualizador): se instala ring si no hay ninguno.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        // Las releases de GitHub redirigen a sus servidores de ficheros: cada salto tiene que ser a un host permitido.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5 {
                attempt.error("demasiadas redirecciones")
            } else if is_allowed_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("redirección a un sitio no permitido")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

enum Failure {
    /// Merece otro intento (red, servidor ocupado, fichero que no cuadra).
    Retry(String),
    /// No sirve reintentar (no existe, cancelado…).
    Fatal(String),
}

async fn download_once(
    url: &reqwest::Url,
    tmp: &Path,
    expected_bytes: u64,
    expected_sha: &str,
    cancelled: &AtomicBool,
    on_progress: &Channel<FetchProgress>,
) -> Result<(), Failure> {
    let client = client().map_err(Failure::Fatal)?;
    let mut response = client.get(url.clone()).send().await.map_err(|e| Failure::Retry(format!("No hay conexión con el servidor de la biblioteca ({e}).")))?;
    let status = response.status();
    if status.is_client_error() {
        return Err(Failure::Fatal(format!("Este elemento de la biblioteca no está disponible ({status}).")));
    }
    if !status.is_success() {
        return Err(Failure::Retry(format!("El servidor de la biblioteca ha respondido {status}.")));
    }
    if response.content_length().map(|n| n > MAX_FILE_BYTES).unwrap_or(false) {
        return Err(Failure::Fatal("El fichero de la biblioteca es demasiado grande.".into()));
    }
    let mut file = fs::File::create(tmp).map_err(|e| Failure::Fatal(format!("No se puede guardar el fichero de la biblioteca: {e}")))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last_sent: u64 = 0;
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(Failure::Fatal(CANCELLED.into()));
        }
        let chunk = response.chunk().await.map_err(|e| Failure::Retry(format!("Se ha cortado la descarga ({e}).")))?;
        let Some(chunk) = chunk else { break };
        received += chunk.len() as u64;
        if received > MAX_FILE_BYTES || received > expected_bytes {
            return Err(Failure::Retry("El fichero descargado no es el que dice el catálogo (tamaño).".into()));
        }
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| Failure::Fatal(format!("No se puede guardar el fichero de la biblioteca: {e}")))?;
        // Progreso cada ~64 KB (no inunda el canal).
        if received - last_sent >= 64 * 1024 || received == expected_bytes {
            last_sent = received;
            let _ = on_progress.send(FetchProgress { received, total: expected_bytes });
        }
    }
    file.flush().map_err(|e| Failure::Fatal(e.to_string()))?;
    drop(file);
    if received != expected_bytes {
        return Err(Failure::Retry("El fichero descargado está incompleto.".into()));
    }
    if format!("{:x}", hasher.finalize()) != expected_sha {
        return Err(Failure::Retry("El fichero descargado no es el que dice el catálogo (SHA-256).".into()));
    }
    Ok(())
}

/// Trae un fichero de la biblioteca a la caché y devuelve su ruta. Si ya está, al momento (también sin red).
/// En desarrollo lo copia de la carpeta local si lo tiene; si no, lo descarga de `url` (solo hosts permitidos),
/// con tres intentos, progreso y cancelación (cancel_job con el mismo `job_id`). Siempre comprueba el SHA-256.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn library_fetch(
    app: AppHandle,
    state: State<'_, AppState>,
    file: String,
    sha256: String,
    bytes: u64,
    url: String,
    job_id: String,
    on_progress: Channel<FetchProgress>,
) -> Result<String, String> {
    check_entry(&file, &sha256)?;
    if bytes == 0 || bytes > MAX_FILE_BYTES {
        return Err("Tamaño no válido en el catálogo de la biblioteca.".into());
    }
    let dir = library_dir(&app)?;
    let dest = dir.join(cache_file_name(&file, &sha256));
    if fs::metadata(&dest).map(|m| m.len() == bytes).unwrap_or(false) {
        return Ok(dest.to_string_lossy().into_owned());
    }
    let tmp = dir.join(format!("{}.part", cache_file_name(&file, &sha256)));

    // Desarrollo: la carpeta local hace de release.
    if let Some(local) = local_source_dir().map(|d| d.join(&file)).filter(|p| p.is_file()) {
        fs::copy(&local, &tmp).map_err(|e| format!("No se puede copiar {}: {e}", local.display()))?;
        let got = sha256_of(&tmp)?;
        if got != sha256 {
            let _ = fs::remove_file(&tmp);
            return Err(format!("El fichero local {file} no es el del catálogo (SHA-256): vuelve a generar la biblioteca."));
        }
        fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
        let _ = on_progress.send(FetchProgress { received: bytes, total: bytes });
        return Ok(dest.to_string_lossy().into_owned());
    }

    let parsed = reqwest::Url::parse(&url).map_err(|_| "La dirección de descarga de la biblioteca no es válida.".to_string())?;
    if !is_allowed_url(&parsed) {
        return Err("La biblioteca solo se descarga de las releases de GitHub.".into());
    }
    let cancelled = state.downloads.start(&job_id);
    let mut last_error = String::new();
    let mut result = Err(String::new());
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(600 * u64::from(attempt) * u64::from(attempt))).await;
        }
        match download_once(&parsed, &tmp, bytes, &sha256, &cancelled, &on_progress).await {
            Ok(()) => {
                result = fs::rename(&tmp, &dest).map(|_| dest.to_string_lossy().into_owned()).map_err(|e| e.to_string());
                break;
            }
            Err(Failure::Fatal(msg)) => {
                last_error = msg;
                break;
            }
            Err(Failure::Retry(msg)) => last_error = msg,
        }
    }
    state.downloads.finish(&job_id);
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return Err(last_error);
    }
    result
}

/// Catálogo actualizado de la release (si hay red y es JSON), guardado en la caché; si no se puede, el último
/// que se guardó; si nunca se descargó, null (la interfaz usa el empaquetado con la app).
#[tauri::command]
pub async fn library_catalog(app: AppHandle, url: String) -> Result<Option<String>, String> {
    let dir = library_dir(&app)?;
    let cached = dir.join(CATALOG_CACHE);
    let fresh = async {
        let parsed = reqwest::Url::parse(&url).ok().filter(is_allowed_url)?;
        let response = client().ok()?.get(parsed).timeout(Duration::from_secs(10)).send().await.ok()?;
        if !response.status().is_success() || response.content_length().map(|n| n > MAX_CATALOG_BYTES).unwrap_or(false) {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        if bytes.len() as u64 > MAX_CATALOG_BYTES {
            return None;
        }
        let text = String::from_utf8(bytes.to_vec()).ok()?;
        serde_json::from_str::<serde_json::Value>(&text).ok()?;
        Some(text)
    }
    .await;
    if let Some(text) = fresh {
        let _ = crate::files::write_atomic(&cached, text.as_bytes());
        return Ok(Some(text));
    }
    Ok(fs::read_to_string(&cached).ok())
}

#[cfg(test)]
mod tests {
    use super::{cache_file_name, is_allowed_url, is_safe_file_name, is_sha256};

    #[test]
    fn only_safe_file_names() {
        assert!(is_safe_file_name("confeti.mp4"));
        assert!(is_safe_file_name("tic-tac.preview.webm"));
        assert!(!is_safe_file_name("../confeti.mp4"));
        assert!(!is_safe_file_name("a..b.mp4"));
        assert!(!is_safe_file_name("C:\\x.mp4"));
        assert!(!is_safe_file_name("sub/x.mp4"));
        assert!(!is_safe_file_name("Mayus.mp4"));
        assert!(!is_safe_file_name(".oculto"));
        assert!(!is_safe_file_name(""));
        assert!(!is_safe_file_name(&"a".repeat(92)));
    }

    #[test]
    fn only_https_from_github_releases() {
        let ok = |s: &str| is_allowed_url(&reqwest::Url::parse(s).unwrap());
        assert!(ok("https://github.com/Krahegwen/easy-cut/releases/download/library-v1/confeti.mp4"));
        assert!(ok("https://objects.githubusercontent.com/github-production-release-asset/1"));
        assert!(ok("https://release-assets.githubusercontent.com/x"));
        assert!(!ok("http://github.com/x"));
        assert!(!ok("https://github.com.evil.example/x"));
        assert!(!ok("https://evil.example/github.com"));
        assert!(!ok("https://user:pass@github.com/x"));
        assert!(!ok("file:///C:/Windows/notepad.exe"));
    }

    #[test]
    fn sha_and_cache_names() {
        let sha = "a".repeat(64);
        assert!(is_sha256(&sha));
        assert!(!is_sha256(&"A".repeat(64)));
        assert!(!is_sha256("abc"));
        assert_eq!(cache_file_name("confeti.mp4", &sha), "aaaaaaaaaaaaaaaa-confeti.mp4");
    }
}
