// Ejecución de ffmpeg/ffprobe: array de argumentos, sin ventana de consola, salida línea a línea
// y cancelación por «trabajo» (un id que elige la interfaz y que agrupa uno o varios procesos).

use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::watch;

/// CREATE_NO_WINDOW: que no parpadee una consola al lanzar el proceso.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Líneas de stderr que se guardan cuando no se captura todo.
const STDERR_TAIL_LINES: usize = 200;
/// Tope de lo capturado por flujo (por si un proceso escupe sin fin).
const CAPTURE_LIMIT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

pub type LineSink = Arc<dyn Fn(Stream, &str) + Send + Sync>;

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutput {
    /// Código de salida (None si lo mató una señal o la cancelación).
    pub exit_code: Option<i32>,
    pub cancelled: bool,
    /// stdout completo si se pidió capturar; vacío si no.
    pub stdout: String,
    /// stderr completo si se pidió capturar; si no, sus últimas líneas.
    pub stderr: String,
}

struct JobEntry {
    cancel: watch::Sender<bool>,
    active: usize,
}

/// Registro de trabajos en marcha y cancelados.
#[derive(Default)]
pub struct ProcessRegistry {
    jobs: Mutex<HashMap<String, JobEntry>>,
}

impl ProcessRegistry {
    fn entry<'a>(jobs: &'a mut HashMap<String, JobEntry>, job: &str) -> &'a mut JobEntry {
        jobs.entry(job.to_string()).or_insert_with(|| JobEntry { cancel: watch::channel(false).0, active: 0 })
    }

    /// Registra un proceso del trabajo. Devuelve None si el trabajo ya estaba cancelado.
    fn acquire(&self, job: &str) -> Option<watch::Receiver<bool>> {
        let mut jobs = self.jobs.lock().unwrap();
        let entry = Self::entry(&mut jobs, job);
        if *entry.cancel.borrow() {
            return None;
        }
        entry.active += 1;
        Some(entry.cancel.subscribe())
    }

    fn release(&self, job: &str) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(entry) = jobs.get_mut(job) {
            entry.active = entry.active.saturating_sub(1);
            // Los cancelados se quedan apuntados: un proceso posterior del mismo trabajo no debe arrancar.
            if entry.active == 0 && !*entry.cancel.borrow() {
                jobs.remove(job);
            }
        }
    }

    /// Cancela el trabajo: mata sus procesos en marcha e impide que arranquen más.
    pub fn cancel(&self, job: &str) {
        let mut jobs = self.jobs.lock().unwrap();
        Self::entry(&mut jobs, job).cancel.send_replace(true);
    }

    pub fn is_cancelled(&self, job: &str) -> bool {
        self.jobs.lock().unwrap().get(job).map(|e| *e.cancel.borrow()).unwrap_or(false)
    }

    /// Al cerrar la aplicación: mata todo lo que quede.
    pub fn cancel_all(&self) {
        for entry in self.jobs.lock().unwrap().values() {
            entry.cancel.send_replace(true);
        }
    }

    #[cfg(test)]
    fn tracked_jobs(&self) -> usize {
        self.jobs.lock().unwrap().len()
    }
}

struct ReleaseGuard<'a> {
    registry: &'a ProcessRegistry,
    job: &'a str,
}

impl Drop for ReleaseGuard<'_> {
    fn drop(&mut self) {
        self.registry.release(self.job);
    }
}

async fn wait_cancelled(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow_and_update() {
            return;
        }
        if rx.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

/// Acumula lo leído y emite cada línea (separadas por \n o \r) en cuanto está completa.
struct LineSplitter {
    pending: Vec<u8>,
}

impl LineSplitter {
    fn new() -> Self {
        Self { pending: Vec::new() }
    }

    fn push(&mut self, chunk: &[u8], mut emit: impl FnMut(&str)) {
        for &b in chunk {
            if b == b'\n' || b == b'\r' {
                self.flush(&mut emit);
            } else {
                self.pending.push(b);
            }
        }
    }

    fn flush(&mut self, emit: &mut impl FnMut(&str)) {
        if !self.pending.is_empty() {
            let line = String::from_utf8_lossy(&self.pending).into_owned();
            self.pending.clear();
            emit(&line);
        }
    }
}

async fn pump<R: AsyncRead + Unpin>(
    mut reader: R,
    stream: Stream,
    sink: Option<LineSink>,
    capture: bool,
    keep_tail: bool,
) -> String {
    let mut buf = vec![0u8; 16 * 1024];
    let mut captured: Vec<u8> = Vec::new();
    let mut tail: VecDeque<String> = VecDeque::new();
    let mut splitter = LineSplitter::new();
    let mut on_line = |line: &str| {
        if let Some(sink) = &sink {
            sink(stream, line);
        }
        if keep_tail && !capture {
            if tail.len() == STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line.to_string());
        }
    };
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let chunk = &buf[..n];
        if capture && captured.len() < CAPTURE_LIMIT_BYTES {
            captured.extend_from_slice(chunk);
        }
        if sink.is_some() || keep_tail {
            splitter.push(chunk, &mut on_line);
        }
    }
    splitter.flush(&mut on_line);
    if capture {
        String::from_utf8_lossy(&captured).into_owned()
    } else {
        tail.into_iter().collect::<Vec<_>>().join("\n")
    }
}

/// Lanza el programa con estos argumentos (nunca a través de un shell) y espera a que acabe o se cancele.
/// Con `capture`, devuelve stdout y stderr completos; si no, emite las líneas a `sink` y guarda la cola de stderr.
pub async fn run_process(
    registry: &ProcessRegistry,
    program: &Path,
    args: &[String],
    job: &str,
    capture: bool,
    sink: Option<LineSink>,
) -> Result<ToolOutput, String> {
    let Some(mut cancel_rx) = registry.acquire(job) else {
        return Ok(ToolOutput { cancelled: true, ..Default::default() });
    };
    let _guard = ReleaseGuard { registry, job };

    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("No se ha podido arrancar {}: {e}", program.display()))?;
    // Si la app muere sin poder cancelar (cuelgue, Administrador de tareas), Windows mata este proceso.
    #[cfg(windows)]
    if let Some(handle) = child.raw_handle() {
        crate::job_object::assign(handle);
    }
    let stdout = child.stdout.take().expect("stdout con pipe");
    let stderr = child.stderr.take().expect("stderr con pipe");
    let out_task = tokio::spawn(pump(stdout, Stream::Stdout, sink.clone(), capture, false));
    let err_task = tokio::spawn(pump(stderr, Stream::Stderr, sink, capture, true));

    let mut cancelled = false;
    let status = tokio::select! {
        status = child.wait() => status,
        _ = wait_cancelled(&mut cancel_rx) => {
            cancelled = true;
            let _ = child.start_kill();
            child.wait().await
        }
    };
    let status = status.map_err(|e| format!("Error esperando a {}: {e}", program.display()))?;
    let stdout = out_task.await.unwrap_or_default();
    let stderr = err_task.await.unwrap_or_default();
    Ok(ToolOutput { exit_code: if cancelled { None } else { status.code() }, cancelled, stdout, stderr })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitter_handles_crlf_cr_and_partial_chunks() {
        let mut lines = Vec::new();
        let mut s = LineSplitter::new();
        s.push(b"frame=1\r\nout_ti", |l| lines.push(l.to_string()));
        s.push(b"me_us=5\rprogress=continue\n\n", |l| lines.push(l.to_string()));
        s.push("ruta=C:\\Vídeos\\a.mp4".as_bytes(), |l| lines.push(l.to_string()));
        s.flush(&mut |l: &str| lines.push(l.to_string()));
        assert_eq!(lines, vec!["frame=1", "out_time_us=5", "progress=continue", "ruta=C:\\Vídeos\\a.mp4"]);
    }

    #[test]
    fn registry_forgets_finished_jobs_but_remembers_cancelled_ones() {
        let r = ProcessRegistry::default();
        let rx = r.acquire("a").unwrap();
        r.release("a");
        drop(rx);
        assert_eq!(r.tracked_jobs(), 0);

        r.cancel("b");
        assert!(r.is_cancelled("b"));
        assert!(r.acquire("b").is_none());
        assert_eq!(r.tracked_jobs(), 1);
    }

    #[cfg(windows)]
    fn cmd_exe() -> std::path::PathBuf {
        std::path::PathBuf::from(std::env::var("ComSpec").unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into()))
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn captures_output_and_exit_code() {
        let r = ProcessRegistry::default();
        let args = vec!["/d".into(), "/c".into(), "echo hola& echo error 1>&2& exit /b 3".into()];
        let out = run_process(&r, &cmd_exe(), &args, "t1", true, None).await.unwrap();
        assert_eq!(out.exit_code, Some(3));
        assert!(!out.cancelled);
        assert!(out.stdout.contains("hola"));
        assert!(out.stderr.contains("error"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn cancel_kills_the_running_process() {
        let r = Arc::new(ProcessRegistry::default());
        let r2 = r.clone();
        let started = std::time::Instant::now();
        let task = tokio::spawn(async move {
            // ping tarda ~20 s si nadie lo mata (se lanza directo, sin cmd, como ffmpeg).
            let ping = std::path::PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()))
                .join("System32")
                .join("PING.EXE");
            let args = vec!["-n".into(), "20".into(), "127.0.0.1".into()];
            run_process(&r2, &ping, &args, "slow", false, None).await
        });
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        r.cancel("slow");
        let out = task.await.unwrap().unwrap();
        assert!(out.cancelled);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        // Un proceso nuevo del mismo trabajo ya no arranca.
        let again = run_process(&r, &cmd_exe(), &["/c".into(), "echo x".into()], "slow", true, None).await.unwrap();
        assert!(again.cancelled);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn streams_lines_to_the_sink() {
        let r = ProcessRegistry::default();
        let lines = Arc::new(Mutex::new(Vec::<(Stream, String)>::new()));
        let l2 = lines.clone();
        let sink: LineSink = Arc::new(move |s, line| l2.lock().unwrap().push((s, line.to_string())));
        let args = vec!["/d".into(), "/c".into(), "echo uno& echo dos& echo tres 1>&2".into()];
        let out = run_process(&r, &cmd_exe(), &args, "t3", false, Some(sink)).await.unwrap();
        assert_eq!(out.exit_code, Some(0));
        let got = lines.lock().unwrap().clone();
        assert!(got.contains(&(Stream::Stdout, "uno".into())));
        assert!(got.contains(&(Stream::Stdout, "dos".into())));
        assert!(got.iter().any(|(s, l)| *s == Stream::Stderr && l.trim() == "tres"));
        assert!(out.stderr.contains("tres"));
    }
}
