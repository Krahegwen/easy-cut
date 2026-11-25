// Los comandos propios se declaran en el manifiesto de la app: así cada uno necesita un permiso
// explícito en capabilities/ (allow-<comando>) y no queda nada abierto por defecto.
const COMMANDS: &[&str] = &[
    "run_tool",
    "cancel_job",
    "make_thumbnail",
    "make_waveform",
    "cache_entry",
    "promote_cache_file",
    "discard_cache_file",
    "write_temp_text_file",
    "pick_videos",
    "pick_output_folder",
    "get_output_folder",
    "list_file_names",
    "path_exists",
    "delete_partial_output",
    "open_file",
    "reveal_in_folder",
    "copy_file_to_clipboard",
    "clipboard_sequence",
    "clipboard_files",
    "save_autosave",
    "load_autosave",
    "clear_autosave",
    "save_project",
    "load_project",
    "recording_begin",
    "recording_append",
    "recording_finish",
    "recording_cleanup",
    "library_status",
    "library_fetch",
    "library_catalog",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("fallo al preparar el build de Tauri");
}
