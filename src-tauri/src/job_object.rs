// Job Object de Windows con KILL_ON_JOB_CLOSE: cada ffmpeg/ffprobe se mete en él al arrancar.
// Si Easy Cut termina por lo que sea (cerrar, cuelgue, matarlo desde el Administrador de tareas),
// Windows cierra el handle del job y mata los procesos que queden: no hay ffmpeg huérfanos.
// Solo se meten los procesos de ffmpeg: lo que se abre con la app predeterminada (un reproductor)
// no debe cerrarse con Easy Cut.

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    struct Job(HANDLE);
    // El handle solo se usa para asignar procesos; Windows lo admite desde cualquier hilo.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    fn job() -> Option<&'static Job> {
        static JOB: OnceLock<Option<Job>> = OnceLock::new();
        JOB.get_or_init(|| unsafe {
            let handle = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            // El handle no se cierra nunca: se cierra solo al terminar el proceso, y eso mata el job.
            Some(Job(handle))
        })
        .as_ref()
    }

    /// Mete el proceso en el job. Si falla, no es grave: la cancelación normal sigue funcionando.
    pub fn assign(process: std::os::windows::io::RawHandle) {
        let Some(job) = job() else { return };
        unsafe {
            if let Err(e) = AssignProcessToJobObject(job.0, HANDLE(process)) {
                eprintln!("[easy-cut] no se ha podido meter ffmpeg en el job: {e}");
            }
        }
    }
}

#[cfg(windows)]
pub use imp::assign;
