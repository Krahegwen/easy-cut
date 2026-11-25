// Resolución de ffmpeg/ffprobe: primero el sidecar empaquetado junto al ejecutable;
// si no está (desarrollo sin empaquetar), el del PATH. Solo se admiten estos dos binarios.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Ffmpeg,
    Ffprobe,
}

impl Tool {
    /// Convierte el nombre que llega de la interfaz. Cualquier otro ejecutable se rechaza.
    pub fn parse(name: &str) -> Result<Tool, String> {
        match name {
            "ffmpeg" => Ok(Tool::Ffmpeg),
            "ffprobe" => Ok(Tool::Ffprobe),
            other => Err(format!("Solo se pueden ejecutar ffmpeg y ffprobe, no «{other}».")),
        }
    }

    pub fn file_name(self) -> &'static str {
        match (self, cfg!(windows)) {
            (Tool::Ffmpeg, true) => "ffmpeg.exe",
            (Tool::Ffprobe, true) => "ffprobe.exe",
            (Tool::Ffmpeg, false) => "ffmpeg",
            (Tool::Ffprobe, false) => "ffprobe",
        }
    }
}

/// Busca el binario: junto al ejecutable (sidecar) y, si no, en cada carpeta de `path_var`.
pub fn resolve_tool_in(tool: Tool, exe_dir: Option<&Path>, path_var: Option<&OsStr>) -> Option<PathBuf> {
    let name = tool.file_name();
    if let Some(dir) = exe_dir {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(path_var) = path_var {
        for dir in std::env::split_paths(path_var) {
            if dir.as_os_str().is_empty() {
                continue;
            }
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Ruta del binario, resuelta una vez por proceso.
pub fn resolve_tool(tool: Tool) -> Result<PathBuf, String> {
    static FFMPEG: OnceLock<Option<PathBuf>> = OnceLock::new();
    static FFPROBE: OnceLock<Option<PathBuf>> = OnceLock::new();
    let cell = match tool {
        Tool::Ffmpeg => &FFMPEG,
        Tool::Ffprobe => &FFPROBE,
    };
    cell.get_or_init(|| {
        let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
        let path_var = std::env::var_os("PATH");
        let found = resolve_tool_in(tool, exe_dir.as_deref(), path_var.as_deref());
        match &found {
            Some(p) => eprintln!("[easy-cut] {} → {}", tool.file_name(), p.display()),
            None => eprintln!("[easy-cut] no se encuentra {}", tool.file_name()),
        }
        found
    })
    .clone()
    .ok_or_else(|| {
        format!(
            "No se encuentra {}. Reinstala el programa (o, en desarrollo, ejecuta scripts\\fetch-ffmpeg.ps1).",
            tool.file_name()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("easy-cut-test-bin-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parse_only_accepts_the_two_tools() {
        assert_eq!(Tool::parse("ffmpeg"), Ok(Tool::Ffmpeg));
        assert_eq!(Tool::parse("ffprobe"), Ok(Tool::Ffprobe));
        assert!(Tool::parse("cmd").is_err());
        assert!(Tool::parse("ffmpeg.exe").is_err());
        assert!(Tool::parse("C:\\Windows\\System32\\cmd.exe").is_err());
        assert!(Tool::parse("../ffmpeg").is_err());
    }

    #[test]
    fn sidecar_wins_over_path() {
        let exe = temp_dir("sidecar-exe");
        let in_path = temp_dir("sidecar-path");
        fs::write(exe.join(Tool::Ffmpeg.file_name()), b"x").unwrap();
        fs::write(in_path.join(Tool::Ffmpeg.file_name()), b"x").unwrap();
        let path_var = std::env::join_paths([in_path.clone()]).unwrap();
        let found = resolve_tool_in(Tool::Ffmpeg, Some(&exe), Some(&path_var)).unwrap();
        assert_eq!(found, exe.join(Tool::Ffmpeg.file_name()));
    }

    #[test]
    fn falls_back_to_path_in_order() {
        let exe = temp_dir("fallback-exe");
        let first = temp_dir("fallback-first");
        let second = temp_dir("fallback-second");
        fs::write(second.join(Tool::Ffprobe.file_name()), b"x").unwrap();
        fs::write(first.join(Tool::Ffprobe.file_name()), b"x").unwrap();
        let path_var = std::env::join_paths([OsString::from(""), first.clone().into(), second.clone().into()]).unwrap();
        let found = resolve_tool_in(Tool::Ffprobe, Some(&exe), Some(&path_var)).unwrap();
        assert_eq!(found, first.join(Tool::Ffprobe.file_name()));
    }

    #[test]
    fn ignores_directories_with_the_same_name_and_missing_tools() {
        let exe = temp_dir("dir-exe");
        fs::create_dir_all(exe.join(Tool::Ffmpeg.file_name())).unwrap();
        assert_eq!(resolve_tool_in(Tool::Ffmpeg, Some(&exe), None), None);
        let empty = temp_dir("dir-empty");
        let path_var = std::env::join_paths([empty]).unwrap();
        assert_eq!(resolve_tool_in(Tool::Ffmpeg, Some(&exe), Some(&path_var)), None);
    }
}
