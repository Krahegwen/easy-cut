// Limpieza de la caché (miniaturas, formas de onda, proxies de vista previa, temporales y biblioteca
// descargada), que si no crece sin fin. Política sencilla y segura:
//   1. Nunca se borra lo que usa un vídeo de la lista (proxies, miniaturas y formas de onda de sus ficheros,
//      y lo que usa de la biblioteca), ni las vistas previas de la biblioteca, ni las grabaciones en curso.
//   2. Lo demás se borra si hace mucho que no se usa (cada uso renueva la fecha del fichero): temporales a los
//      2 días, proxies a los 30, miniaturas y formas de onda a los 60, la biblioteca a los 90.
//   3. Si aun así la caché pasa de 3 GB, lo más viejo (sin proteger) hasta bajar de 2 GB.
// Solo se mira dentro de la carpeta de caché de la app, y los ficheros se buscan aquí (la interfaz solo dice
// qué ficheros originales y qué elementos de la biblioteca se usan). Se hace como mucho una vez al día.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::files::{cache_key, file_stamp, source_tag};

const DAY: u64 = 24 * 60 * 60;
/// Para no repetirla en cada arranque.
const STAMP_FILE: &str = "ultima-limpieza";
const EVERY: Duration = Duration::from_secs(20 * 60 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Thumb,
    Wave,
    Proxy,
    Library,
    Temp,
}

#[derive(Clone, Copy, Debug)]
pub struct Policy {
    pub max_age_thumb: Duration,
    pub max_age_proxy: Duration,
    pub max_age_library: Duration,
    pub max_age_temp: Duration,
    pub max_total_bytes: u64,
    pub target_total_bytes: u64,
}

pub const DEFAULT_POLICY: Policy = Policy {
    max_age_thumb: Duration::from_secs(60 * DAY),
    max_age_proxy: Duration::from_secs(30 * DAY),
    max_age_library: Duration::from_secs(90 * DAY),
    max_age_temp: Duration::from_secs(2 * DAY),
    max_total_bytes: 3 * 1024 * 1024 * 1024,
    target_total_bytes: 2 * 1024 * 1024 * 1024,
};

#[derive(Clone, Debug)]
pub struct CacheFile {
    pub path: PathBuf,
    pub kind: Kind,
    pub size: u64,
    /// Desde cuándo no se usa.
    pub age: Duration,
    pub protected: bool,
}

/// Qué borrar (índices de `files`): primero por antigüedad y luego, si hace falta, por tamaño total.
pub fn plan(files: &[CacheFile], policy: &Policy) -> Vec<usize> {
    let max_age = |k: Kind| match k {
        Kind::Thumb | Kind::Wave => policy.max_age_thumb,
        Kind::Proxy => policy.max_age_proxy,
        Kind::Library => policy.max_age_library,
        Kind::Temp => policy.max_age_temp,
    };
    let mut delete: Vec<usize> = Vec::new();
    let mut kept: Vec<usize> = Vec::new();
    for (i, f) in files.iter().enumerate() {
        if !f.protected && f.age > max_age(f.kind) {
            delete.push(i);
        } else {
            kept.push(i);
        }
    }
    let mut total: u64 = kept.iter().map(|&i| files[i].size).sum();
    if total > policy.max_total_bytes {
        let mut candidates: Vec<usize> = kept.iter().copied().filter(|&i| !files[i].protected).collect();
        // Lo que lleva más tiempo sin usarse, primero.
        candidates.sort_by(|&a, &b| files[b].age.cmp(&files[a].age));
        for i in candidates {
            if total <= policy.target_total_bytes {
                break;
            }
            total -= files[i].size;
            delete.push(i);
        }
    }
    delete.sort_unstable();
    delete
}

/// Lo que se protege: etiquetas de los ficheros originales (miniaturas y formas de onda llevan la suya
/// delante), nombres exactos de proxies y nombres de la biblioteca.
#[derive(Default)]
pub struct Protected {
    pub source_tags: HashSet<String>,
    pub names: HashSet<String>,
}

fn kind_of(sub: &str, name: &str) -> Option<Kind> {
    if name.contains(".part.") || name.ends_with(".tmp") {
        return Some(Kind::Temp);
    }
    match sub {
        "thumbs" => Some(Kind::Thumb),
        "waves" => Some(Kind::Wave),
        "proxies" => Some(Kind::Proxy),
        "library" => Some(Kind::Library),
        "tmp" => Some(Kind::Temp),
        // Las grabaciones en curso (y cualquier otra cosa) no se tocan nunca.
        _ => None,
    }
}

fn is_protected(kind: Kind, name: &str, p: &Protected) -> bool {
    match kind {
        Kind::Temp => false,
        // Las vistas previas de la biblioteca se ven al navegar por ella: se quedan.
        Kind::Library => name.contains(".preview.") || p.names.contains(name),
        Kind::Proxy => p.names.contains(name),
        Kind::Thumb | Kind::Wave => name.split_once('-').map(|(tag, _)| p.source_tags.contains(tag)).unwrap_or(false),
    }
}

/// Los ficheros de la caché que se pueden limpiar, con su antigüedad de uso y si están protegidos.
pub fn scan(root: &Path, protected: &Protected, now: SystemTime) -> Vec<CacheFile> {
    let mut out = Vec::new();
    for sub in ["thumbs", "waves", "proxies", "library", "tmp"] {
        let Ok(entries) = fs::read_dir(root.join(sub)) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(kind) = kind_of(sub, &name) else { continue };
            let age = meta.modified().ok().and_then(|t| now.duration_since(t).ok()).unwrap_or_default();
            out.push(CacheFile { path: entry.path(), kind, size: meta.len(), age, protected: is_protected(kind, &name, protected) });
        }
    }
    out
}

/// Marca un fichero de la caché como usado ahora (para que la limpieza sepa qué no se usa).
pub fn touch(path: &Path) {
    if let Ok(f) = fs::File::options().write(true).open(path) {
        let _ = f.set_modified(SystemTime::now());
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    /// false si no tocaba (se hizo hace poco).
    ran: bool,
    deleted: usize,
    freed_bytes: u64,
    kept_bytes: u64,
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    Ok(if cfg!(debug_assertions) { base.join("pruebas") } else { base })
}

/// Limpia la caché. `sources`: ficheros que usan los vídeos de la lista; `library_files`: nombres en la caché
/// (`<sha16>-<fichero>`) de lo que usan de la biblioteca. Con `force`, aunque se haya hecho hace poco.
#[tauri::command]
pub async fn clean_cache(app: AppHandle, sources: Vec<String>, library_files: Vec<String>, force: Option<bool>) -> Result<CleanupReport, String> {
    let root = cache_root(&app)?;
    let stamp = root.join(STAMP_FILE);
    let now = SystemTime::now();
    let recent = fs::metadata(&stamp).and_then(|m| m.modified()).ok().and_then(|t| now.duration_since(t).ok()).is_some_and(|age| age < EVERY);
    if recent && !force.unwrap_or(false) {
        return Ok(CleanupReport::default());
    }
    tokio::task::spawn_blocking(move || {
        let mut protected = Protected::default();
        for s in &sources {
            let Ok(st) = file_stamp(Path::new(s)) else { continue };
            protected.source_tags.insert(source_tag(s, &st));
            protected.names.insert(format!("{}.mp4", cache_key(s, &st, &["proxy-v1"])));
        }
        protected.names.extend(library_files.into_iter().filter(|n| crate::library::is_safe_cache_name(n)));
        let files = scan(&root, &protected, now);
        let mut report = CleanupReport { ran: true, ..Default::default() };
        let doomed: HashSet<usize> = plan(&files, &DEFAULT_POLICY).into_iter().collect();
        for (i, f) in files.iter().enumerate() {
            if doomed.contains(&i) && f.path.starts_with(&root) && fs::remove_file(&f.path).is_ok() {
                report.deleted += 1;
                report.freed_bytes += f.size;
            } else {
                report.kept_bytes += f.size;
            }
        }
        let _ = fs::create_dir_all(&root);
        let _ = fs::write(&stamp, b"");
        report
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1024 * 1024;

    fn f(name: &str, kind: Kind, days: u64, size: u64, protected: bool) -> CacheFile {
        CacheFile { path: PathBuf::from(name), kind, size, age: Duration::from_secs(days * DAY), protected }
    }

    #[test]
    fn old_files_go_and_protected_ones_never() {
        let files = vec![
            f("t-viejo", Kind::Thumb, 61, MB, false),
            f("t-nuevo", Kind::Thumb, 3, MB, false),
            f("p-viejo", Kind::Proxy, 31, 100 * MB, false),
            f("p-protegido", Kind::Proxy, 400, 100 * MB, true),
            f("l-viejo", Kind::Library, 91, MB, false),
            f("l-usado", Kind::Library, 900, MB, true),
            f("tmp", Kind::Temp, 3, MB, false),
            f("tmp-hoy", Kind::Temp, 0, MB, false),
        ];
        let names: Vec<&str> = plan(&files, &DEFAULT_POLICY).into_iter().map(|i| files[i].path.to_str().unwrap()).collect();
        assert_eq!(names, vec!["t-viejo", "p-viejo", "l-viejo", "tmp"]);
    }

    #[test]
    fn only_library_cache_names_are_accepted_from_the_interface() {
        use crate::library::is_safe_cache_name;
        assert!(is_safe_cache_name("0123456789abcdef-aplausos.m4a"));
        for bad in ["aplausos.m4a", "0123456789abcdeg-a.m4a", "0123-a.m4a", "0123456789abcdef-../x", "0123456789abcdef-A.m4a", "0123456789abcdef-"] {
            assert!(!is_safe_cache_name(bad), "{bad}");
        }
    }

    #[test]
    fn source_tags_change_with_the_file() {
        use crate::files::{source_tag, FileStamp};
        let a = source_tag("C:\\v.mp4", &FileStamp { modified_ms: 1, size: 10 });
        assert_eq!(a.len(), 12);
        assert_eq!(a, source_tag("C:\\v.mp4", &FileStamp { modified_ms: 1, size: 10 }));
        assert_ne!(a, source_tag("C:\\v.mp4", &FileStamp { modified_ms: 2, size: 10 }));
        assert_ne!(a, source_tag("C:\\w.mp4", &FileStamp { modified_ms: 1, size: 10 }));
    }

    #[test]
    fn over_the_size_limit_the_least_recently_used_go_first() {
        let policy = Policy { max_total_bytes: 300 * MB, target_total_bytes: 200 * MB, ..DEFAULT_POLICY };
        let files = vec![
            f("reciente", Kind::Proxy, 1, 100 * MB, false),
            f("de-hace-10", Kind::Proxy, 10, 100 * MB, false),
            f("de-hace-20", Kind::Proxy, 20, 100 * MB, false),
            f("protegido-viejo", Kind::Proxy, 29, 100 * MB, true),
        ];
        let names: Vec<&str> = plan(&files, &policy).into_iter().map(|i| files[i].path.to_str().unwrap()).collect();
        assert_eq!(names, vec!["de-hace-10", "de-hace-20"]);
        // Si lo protegido ya pasa del tope, no se borra igualmente.
        let only = vec![f("protegido", Kind::Proxy, 1, 400 * MB, true)];
        assert!(plan(&only, &policy).is_empty());
    }

    #[test]
    fn scan_classifies_and_protects_by_source_and_name() {
        let root = std::env::temp_dir().join(format!("easy-cut-test-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for sub in ["thumbs", "waves", "proxies", "library", "tmp", "recordings"] {
            fs::create_dir_all(root.join(sub)).unwrap();
        }
        for (sub, name) in [
            ("thumbs", "abc123-k1.jpg"),
            ("thumbs", "zzz999-k2.jpg"),
            ("thumbs", "abc123-k3.4.part.jpg"),
            ("waves", "abc123-w.png"),
            ("proxies", "clave.mp4"),
            ("proxies", "otra.mp4"),
            ("library", "0123456789abcdef-aplausos.m4a"),
            ("library", "0123456789abcdef-confeti.preview.png"),
            ("library", "fedcba9876543210-campana.m4a"),
            ("tmp", "1-filtro.txt"),
            ("recordings", "rec-1.webm"),
        ] {
            fs::write(root.join(sub).join(name), b"x").unwrap();
        }
        let mut p = Protected::default();
        p.source_tags.insert("abc123".into());
        p.names.insert("clave.mp4".into());
        p.names.insert("0123456789abcdef-aplausos.m4a".into());
        let mut files = scan(&root, &p, SystemTime::now());
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let summary: Vec<(String, Kind, bool)> =
            files.iter().map(|f| (f.path.file_name().unwrap().to_string_lossy().into_owned(), f.kind, f.protected)).collect();
        assert_eq!(
            summary,
            vec![
                ("0123456789abcdef-aplausos.m4a".into(), Kind::Library, true),
                ("0123456789abcdef-confeti.preview.png".into(), Kind::Library, true),
                ("fedcba9876543210-campana.m4a".into(), Kind::Library, false),
                ("clave.mp4".into(), Kind::Proxy, true),
                ("otra.mp4".into(), Kind::Proxy, false),
                ("abc123-k1.jpg".into(), Kind::Thumb, true),
                ("abc123-k3.4.part.jpg".into(), Kind::Temp, false),
                ("zzz999-k2.jpg".into(), Kind::Thumb, false),
                ("1-filtro.txt".into(), Kind::Temp, false),
                ("abc123-w.png".into(), Kind::Wave, true),
            ]
        );
        // Las grabaciones en curso no salen nunca.
        assert!(files.iter().all(|f| !f.path.to_string_lossy().contains("rec-1")));
        let _ = fs::remove_dir_all(&root);
    }
}
