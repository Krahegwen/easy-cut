// Los vídeos en marcha: un fichero JSON por proyecto en la carpeta de datos de la app (`projects\<id>.json`,
// en la subcarpeta `pruebas` en desarrollo), con su copia anterior (`<id>.prev.json`) y su historial de
// deshacer (`<id>.history.json`). Solo se lee y se borra dentro de esa carpeta, y solo por identificador
// (letras, números, `-` y `_`): nunca una ruta que venga de la interfaz.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::AppHandle;

use crate::files::write_atomic;

const PROJECTS_FOLDER: &str = "projects";
/// Un proyecto no llega ni de lejos a esto (son unos KB): más es que algo va mal.
const MAX_PROJECT_BYTES: usize = 20 * 1024 * 1024;
/// El historial de deshacer guarda varias copias del proyecto.
const MAX_HISTORY_BYTES: usize = 60 * 1024 * 1024;
const MAX_ID_CHARS: usize = 64;
/// La copia anterior se renueva como mucho cada tanto: así es la de hace un rato, no la del cambio de antes.
const BACKUP_EVERY: Duration = Duration::from_secs(10 * 60);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProject {
    id: String,
    json: String,
    /// Cuándo se cambió por última vez (ms desde 1970).
    modified_ms: u64,
    /// ¿Hay copia anterior?
    has_backup: bool,
}

/// ¿Es un identificador de proyecto válido? (nada de rutas ni puntos).
pub fn valid_project_id(id: &str) -> bool {
    !id.is_empty() && id.chars().count() <= MAX_ID_CHARS && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn checked_id(id: &str) -> Result<&str, String> {
    if valid_project_id(id) {
        Ok(id)
    } else {
        Err("Identificador de proyecto no válido".into())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProjectFile {
    Main,
    Backup,
    History,
}

impl ProjectFile {
    fn suffix(self) -> &'static str {
        match self {
            ProjectFile::Main => ".json",
            ProjectFile::Backup => ".prev.json",
            ProjectFile::History => ".history.json",
        }
    }
}

/// Ruta de uno de los ficheros de un proyecto dentro de `dir` (el identificador ya comprobado).
pub fn project_file(dir: &Path, id: &str, which: ProjectFile) -> Result<PathBuf, String> {
    Ok(dir.join(format!("{}{}", checked_id(id)?, which.suffix())))
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Los proyectos guardados en `dir` (solo `<id>.json` con un identificador válido; ni copias ni historiales).
pub fn list_in(dir: &Path) -> Vec<StoredProject> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".json") else { continue };
        if !valid_project_id(id) {
            continue;
        }
        let path = entry.path();
        if fs::metadata(&path).map(|m| !m.is_file() || m.len() as usize > MAX_PROJECT_BYTES).unwrap_or(true) {
            continue;
        }
        let Ok(json) = fs::read_to_string(&path) else { continue };
        let has_backup = dir.join(format!("{id}{}", ProjectFile::Backup.suffix())).is_file();
        out.push(StoredProject { id: id.to_string(), json, modified_ms: modified_ms(&path), has_backup });
    }
    out
}

/// Guarda el proyecto. Antes, si toca, deja el que había como copia anterior.
pub fn write_in(dir: &Path, id: &str, json: &str, now: SystemTime) -> Result<(), String> {
    if json.len() > MAX_PROJECT_BYTES {
        return Err("El proyecto es demasiado grande".into());
    }
    let main = project_file(dir, id, ProjectFile::Main)?;
    let backup = project_file(dir, id, ProjectFile::Backup)?;
    let backup_age = fs::metadata(&backup).and_then(|m| m.modified()).ok().and_then(|t| now.duration_since(t).ok());
    let stale = backup_age.is_none_or(|age| age >= BACKUP_EVERY);
    if stale && main.is_file() {
        // Si no se puede hacer la copia, se guarda igual: antes eso que perder el cambio.
        if fs::copy(&main, &backup).is_ok() {
            let _ = fs::File::options().write(true).open(&backup).and_then(|f| f.set_modified(now));
        }
    }
    write_atomic(&main, json.as_bytes()).map_err(|e| format!("No se ha podido guardar el vídeo: {e}"))
}

fn read_file(path: &Path, max: usize) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("No se ha podido leer el vídeo: {e}")),
        Ok(m) if m.len() as usize > max => return Err("El fichero es demasiado grande".into()),
        Ok(_) => {}
    }
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("No se ha podido leer el vídeo: {e}")),
    }
}

/// Borra el proyecto con su copia y su historial (no falla si ya no estaban). Nunca toca los originales.
pub fn delete_in(dir: &Path, id: &str) -> Result<(), String> {
    for which in [ProjectFile::Main, ProjectFile::Backup, ProjectFile::History] {
        let path = project_file(dir, id, which)?;
        match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("No se ha podido borrar el vídeo: {e}")),
            _ => {}
        }
    }
    Ok(())
}

/// Vuelve a la copia anterior: la copia pasa a ser el proyecto (y el proyecto de ahora, la copia), y el
/// historial de deshacer se descarta (era del otro).
pub fn restore_backup_in(dir: &Path, id: &str) -> Result<String, String> {
    let main = project_file(dir, id, ProjectFile::Main)?;
    let backup = project_file(dir, id, ProjectFile::Backup)?;
    let previous = read_file(&backup, MAX_PROJECT_BYTES)?.ok_or("No hay copia anterior de este vídeo")?;
    let current = read_file(&main, MAX_PROJECT_BYTES)?;
    write_atomic(&main, previous.as_bytes()).map_err(|e| format!("No se ha podido recuperar la copia: {e}"))?;
    if let Some(current) = current {
        let _ = write_atomic(&backup, current.as_bytes());
    }
    let _ = fs::remove_file(project_file(dir, id, ProjectFile::History)?);
    Ok(previous)
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::commands::data_dir(app)?.join(PROJECTS_FOLDER);
    fs::create_dir_all(&dir).map_err(|e| format!("No se puede crear la carpeta de los vídeos en marcha: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<StoredProject>, String> {
    Ok(list_in(&projects_dir(&app)?))
}

#[tauri::command]
pub fn read_project(app: AppHandle, id: String) -> Result<Option<String>, String> {
    read_file(&project_file(&projects_dir(&app)?, &id, ProjectFile::Main)?, MAX_PROJECT_BYTES)
}

#[tauri::command]
pub fn write_project(app: AppHandle, id: String, json: String) -> Result<(), String> {
    write_in(&projects_dir(&app)?, &id, &json, SystemTime::now())
}

#[tauri::command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    delete_in(&projects_dir(&app)?, &id)
}

#[tauri::command]
pub fn restore_project_backup(app: AppHandle, id: String) -> Result<String, String> {
    restore_backup_in(&projects_dir(&app)?, &id)
}

#[tauri::command]
pub fn read_project_history(app: AppHandle, id: String) -> Result<Option<String>, String> {
    read_file(&project_file(&projects_dir(&app)?, &id, ProjectFile::History)?, MAX_HISTORY_BYTES)
}

#[tauri::command]
pub fn write_project_history(app: AppHandle, id: String, json: String) -> Result<(), String> {
    if json.len() > MAX_HISTORY_BYTES {
        return Err("El historial es demasiado grande".into());
    }
    let path = project_file(&projects_dir(&app)?, &id, ProjectFile::History)?;
    write_atomic(&path, json.as_bytes()).map_err(|e| format!("No se ha podido guardar el historial: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("easy-cut-test-projects-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ids_are_never_paths() {
        assert!(valid_project_id("6f1c2a9e-1b2c-4d5e-8f90-123456789abc"));
        assert!(valid_project_id("proyecto_1"));
        for bad in ["", "..", "a/b", "a\\b", "C:", "a.json", "a b", "ñ", &"x".repeat(65)] {
            assert!(!valid_project_id(bad), "{bad}");
        }
        let dir = Path::new("C:\\datos");
        assert!(project_file(dir, "..\\..\\Windows", ProjectFile::Main).is_err());
        assert_eq!(project_file(dir, "abc", ProjectFile::Backup).unwrap(), dir.join("abc.prev.json"));
    }

    #[test]
    fn list_only_returns_project_files() {
        let dir = temp_dir("list");
        write_in(&dir, "uno", "{\"a\":1}", SystemTime::now()).unwrap();
        fs::write(dir.join("uno.prev.json"), "{}").unwrap();
        fs::write(dir.join("uno.history.json"), "{}").unwrap();
        fs::write(dir.join("mal nombre.json"), "{}").unwrap();
        fs::write(dir.join("notas.txt"), "x").unwrap();
        fs::create_dir_all(dir.join("carpeta.json")).unwrap();
        let list = list_in(&dir);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "uno");
        assert_eq!(list[0].json, "{\"a\":1}");
        assert!(list[0].has_backup);
        assert!(list[0].modified_ms > 0);
        assert!(list_in(&dir.join("no-existe")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn writing_keeps_a_previous_copy_from_a_while_ago() {
        let dir = temp_dir("backup");
        let t0 = SystemTime::now();
        write_in(&dir, "p", "v1", t0).unwrap();
        // El primer guardado no tiene nada que copiar.
        assert!(!dir.join("p.prev.json").exists());
        write_in(&dir, "p", "v2", t0).unwrap();
        assert_eq!(fs::read_to_string(dir.join("p.prev.json")).unwrap(), "v1");
        // Al rato todavía no se renueva: la copia sigue siendo la de antes.
        write_in(&dir, "p", "v3", t0 + Duration::from_secs(60)).unwrap();
        assert_eq!(fs::read_to_string(dir.join("p.prev.json")).unwrap(), "v1");
        write_in(&dir, "p", "v4", t0 + BACKUP_EVERY + Duration::from_secs(1)).unwrap();
        assert_eq!(fs::read_to_string(dir.join("p.prev.json")).unwrap(), "v3");
        assert_eq!(fs::read_to_string(dir.join("p.json")).unwrap(), "v4");
        // Volver a la copia: se intercambian, y el historial se descarta.
        fs::write(dir.join("p.history.json"), "h").unwrap();
        assert_eq!(restore_backup_in(&dir, "p").unwrap(), "v3");
        assert_eq!(fs::read_to_string(dir.join("p.json")).unwrap(), "v3");
        assert_eq!(fs::read_to_string(dir.join("p.prev.json")).unwrap(), "v4");
        assert!(!dir.join("p.history.json").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_removes_only_that_project() {
        let dir = temp_dir("delete");
        for id in ["a", "b"] {
            write_in(&dir, id, "x", SystemTime::now()).unwrap();
            write_in(&dir, id, "y", SystemTime::now()).unwrap();
        }
        fs::write(dir.join("a.history.json"), "h").unwrap();
        delete_in(&dir, "a").unwrap();
        assert!(!dir.join("a.json").exists() && !dir.join("a.prev.json").exists() && !dir.join("a.history.json").exists());
        assert!(dir.join("b.json").exists() && dir.join("b.prev.json").exists());
        // Otra vez, o uno que no existe: no falla.
        delete_in(&dir, "a").unwrap();
        assert!(delete_in(&dir, "../b").is_err());
        assert!(restore_backup_in(&dir, "a").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
