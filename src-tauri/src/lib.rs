// Shell de escritorio de easy-cut (Tauri 2): ffmpeg/ffprobe como sidecar, diálogos, ficheros y permisos.

mod binaries;
mod clipboard;
mod commands;
mod files;
mod job_object;
mod media_permissions;
mod process;

use tauri::{Manager, RunEvent};

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::AppState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = media_permissions::grant_camera_and_microphone(&window) {
                    eprintln!("[easy-cut] permisos de cámara/micrófono sin configurar: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::run_tool,
            commands::cancel_job,
            commands::make_thumbnail,
            commands::make_waveform,
            commands::cache_entry,
            commands::promote_cache_file,
            commands::discard_cache_file,
            commands::write_temp_text_file,
            commands::pick_videos,
            commands::pick_output_folder,
            commands::get_output_folder,
            commands::list_file_names,
            commands::path_exists,
            commands::delete_partial_output,
            commands::open_file,
            commands::reveal_in_folder,
            commands::copy_file_to_clipboard,
            commands::clipboard_sequence,
            commands::clipboard_files,
            commands::save_autosave,
            commands::load_autosave,
            commands::clear_autosave,
            commands::save_project,
            commands::load_project,
            commands::recording_begin,
            commands::recording_append,
            commands::recording_finish,
            commands::recording_cleanup,
        ])
        .build(tauri::generate_context!())
        .expect("no se ha podido arrancar Easy Cut");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Que no quede ningún ffmpeg trabajando al cerrar.
            handle.state::<commands::AppState>().registry.cancel_all();
        }
    });
}
