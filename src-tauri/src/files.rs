// Utilidades puras de ficheros: nombres válidos en Windows, nombres sin sobrescribir,
// claves de caché y tamaño de un JPEG. Todo testeable sin Tauri.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};

const RESERVED_WINDOWS_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];
const MAX_STEM_CHARS: usize = 120;

/// Convierte un texto en un nombre de fichero (sin extensión) válido en Windows.
pub fn sanitize_file_stem(name: &str, fallback: &str) -> String {
    let replaced: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    // Espacios repetidos fuera; sin puntos ni espacios al final (Windows los quita y confunde).
    let mut stem = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if stem.chars().count() > MAX_STEM_CHARS {
        stem = stem.chars().take(MAX_STEM_CHARS).collect();
    }
    let stem = stem.trim_end_matches(['.', ' ']).trim_start().to_string();
    if stem.is_empty() {
        return fallback.to_string();
    }
    let base = stem.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    if RESERVED_WINDOWS_NAMES.contains(&base.as_str()) {
        return format!("{stem}_");
    }
    stem
}

/// «nombre.ext», «nombre (2).ext», «nombre (3).ext»… el primero que no esté en `existing`
/// (comparación sin distinguir mayúsculas, como Windows).
pub fn unique_file_name(existing: &HashSet<String>, stem: &str, ext: &str) -> String {
    let taken = |name: &str| existing.contains(&name.to_lowercase());
    let first = format!("{stem}.{ext}");
    if !taken(&first) {
        return first;
    }
    (2..)
        .map(|n| format!("{stem} ({n}).{ext}"))
        .find(|candidate| !taken(candidate))
        .expect("siempre hay un número libre")
}

/// Nombres (en minúsculas) de lo que hay en la carpeta.
pub fn existing_names_lowercase(dir: &Path) -> io::Result<HashSet<String>> {
    let mut names = HashSet::new();
    match fs::read_dir(dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                names.insert(entry.file_name().to_string_lossy().to_lowercase());
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    Ok(names)
}

/// Ruta libre en `dir` para `stem.ext`, sin sobrescribir nada.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> io::Result<PathBuf> {
    let existing = existing_names_lowercase(dir)?;
    Ok(dir.join(unique_file_name(&existing, stem, ext)))
}

/// Identidad de un fichero para la caché: si cambia el contenido, cambia la fecha o el tamaño.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileStamp {
    pub modified_ms: u128,
    pub size: u64,
}

pub fn file_stamp(path: &Path) -> io::Result<FileStamp> {
    let meta = fs::metadata(path)?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(FileStamp { modified_ms, size: meta.len() })
}

/// Clave de caché estable entre ejecuciones (SHA-256 truncado a 32 hex).
/// `parts` son los parámetros que cambian el resultado (instante, alto, versión del formato…).
pub fn cache_key(path: &str, stamp: &FileStamp, parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"easy-cut-cache\0");
    hasher.update(path.as_bytes());
    hasher.update(b"\0");
    hasher.update(stamp.modified_ms.to_string().as_bytes());
    hasher.update(b"\0");
    hasher.update(stamp.size.to_string().as_bytes());
    for p in parts {
        hasher.update(b"\0");
        hasher.update(p.as_bytes());
    }
    let digest = hasher.finalize();
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

/// Ancho y alto de un JPEG leyendo su cabecera SOF. None si no es un JPEG válido.
pub fn jpeg_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut i = 2;
    while i + 3 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        // Relleno 0xFF o marcadores sin longitud.
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }
        if marker == 0xD9 || marker == 0xDA {
            return None;
        }
        let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
        let is_sof = (0xC0..=0xCF).contains(&marker) && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
        if is_sof {
            if i + 8 >= bytes.len() {
                return None;
            }
            let height = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
            let width = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
            return Some((width, height));
        }
        i += 2 + len;
    }
    None
}

/// Escribe el fichero de forma atómica: primero a `.tmp` y luego se renombra encima.
pub fn write_atomic(path: &Path, contents: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)
}

/// ¿`path` está dentro de `dir`? (comparando rutas absolutas normalizadas).
pub fn is_inside(path: &Path, dir: &Path) -> bool {
    match (path.parent().and_then(|p| p.canonicalize().ok()), dir.canonicalize().ok()) {
        (Some(parent), Some(dir)) => parent.starts_with(dir),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_removes_invalid_characters_and_reserved_names() {
        assert_eq!(sanitize_file_stem("Mi vídeo: «ensayo» 1/2?", "x"), "Mi vídeo «ensayo» 1 2");
        assert_eq!(sanitize_file_stem("  ..  ", "Grabación"), "Grabación");
        assert_eq!(sanitize_file_stem("final. . ", "x"), "final");
        assert_eq!(sanitize_file_stem("con", "x"), "con_");
        assert_eq!(sanitize_file_stem("NUL.backup", "x"), "NUL.backup_");
        assert_eq!(sanitize_file_stem("a\tb\nc", "x"), "a b c");
        assert_eq!(sanitize_file_stem(&"á".repeat(300), "x").chars().count(), MAX_STEM_CHARS);
    }

    #[test]
    fn unique_name_never_overwrites_case_insensitively() {
        let mut existing = HashSet::new();
        assert_eq!(unique_file_name(&existing, "Grabación", "mp4"), "Grabación.mp4");
        existing.insert("grabación.mp4".to_string());
        assert_eq!(unique_file_name(&existing, "Grabación", "mp4"), "Grabación (2).mp4");
        existing.insert("grabación (2).mp4".to_string());
        existing.insert("grabación (3).mp4".to_string());
        assert_eq!(unique_file_name(&existing, "Grabación", "mp4"), "Grabación (4).mp4");
        // Otra extensión no choca.
        assert_eq!(unique_file_name(&existing, "Grabación", "webm"), "Grabación.webm");
    }

    #[test]
    fn unique_path_looks_at_the_real_folder() {
        let dir = std::env::temp_dir().join(format!("easy-cut-test-unique-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        // Carpeta que aún no existe: el primer nombre vale.
        assert_eq!(unique_path(&dir, "Toma", "mp4").unwrap(), dir.join("Toma.mp4"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("TOMA.mp4"), b"x").unwrap();
        assert_eq!(unique_path(&dir, "Toma", "mp4").unwrap(), dir.join("Toma (2).mp4"));
    }

    #[test]
    fn cache_key_depends_on_every_input() {
        let stamp = FileStamp { modified_ms: 1_700_000_000_000, size: 1234 };
        let base = cache_key("C:\\Vídeos\\a.mp4", &stamp, &["thumb", "1000", "90"]);
        assert_eq!(base.len(), 32);
        assert_eq!(base, cache_key("C:\\Vídeos\\a.mp4", &stamp, &["thumb", "1000", "90"]));
        assert_ne!(base, cache_key("C:\\Vídeos\\b.mp4", &stamp, &["thumb", "1000", "90"]));
        assert_ne!(base, cache_key("C:\\Vídeos\\a.mp4", &FileStamp { modified_ms: 1, size: 1234 }, &["thumb", "1000", "90"]));
        assert_ne!(base, cache_key("C:\\Vídeos\\a.mp4", &FileStamp { size: 1, ..stamp.clone() }, &["thumb", "1000", "90"]));
        assert_ne!(base, cache_key("C:\\Vídeos\\a.mp4", &stamp, &["thumb", "2000", "90"]));
        assert_ne!(base, cache_key("C:\\Vídeos\\a.mp4", &stamp, &["thumb", "1000", "120"]));
        // Las partes no se pueden «fusionar» para colisionar.
        assert_ne!(cache_key("a", &stamp, &["1", "23"]), cache_key("a", &stamp, &["12", "3"]));
    }

    #[test]
    fn jpeg_size_reads_the_sof_header() {
        // SOI, APP0 de 16 bytes, SOF0 con alto 90 y ancho 160.
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        jpeg.extend_from_slice(&[0u8; 14]);
        jpeg.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 90, 0x00, 160, 0x03]);
        jpeg.extend_from_slice(&[0u8; 9]);
        assert_eq!(jpeg_size(&jpeg), Some((160, 90)));
        assert_eq!(jpeg_size(b"not a jpeg"), None);
        assert_eq!(jpeg_size(&[0xFF, 0xD8, 0xFF, 0xD9]), None);
    }

    #[test]
    fn write_atomic_replaces_existing_file() {
        let dir = std::env::temp_dir().join(format!("easy-cut-test-atomic-{}", std::process::id()));
        let file = dir.join("autosave.json");
        write_atomic(&file, b"uno").unwrap();
        write_atomic(&file, b"dos").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "dos");
        assert!(is_inside(&file, &dir));
        assert!(!is_inside(&file, &dir.join("otra")));
    }
}
