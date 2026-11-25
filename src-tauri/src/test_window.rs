// Modo de pruebas de la ventana (solo en compilación de desarrollo): con EASY_CUT_TEST=1 la ventana se abre
// sin quitarle el foco a lo que se esté usando y por detrás de las demás, pero visible y sin minimizar
// (minimizada u oculta, Chromium para requestAnimationFrame, frena los temporizadores y puede pausar el
// vídeo). En release no existe: la variable se ignora.

/// ¿Abrir la ventana en modo de pruebas?
pub fn enabled() -> bool {
    cfg!(debug_assertions) && is_on(std::env::var("EASY_CUT_TEST").ok().as_deref())
}

fn is_on(value: Option<&str>) -> bool {
    value == Some("1")
}

/// Enseña la ventana (creada oculta) sin activarla y detrás de las demás.
#[cfg(windows)]
pub fn show_behind(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };
    let Ok(handle) = window.hwnd() else {
        eprintln!("[easy-cut] modo de pruebas: no se ha podido obtener la ventana");
        let _ = window.show();
        return;
    };
    // El HWND de tauri es de otra versión del crate windows: se pasa por el puntero.
    let hwnd = HWND(handle.0);
    // Enseñarla y ponerla al fondo en una sola llamada, sin activarla (window.show() de tao sí la activa).
    // SAFETY: hwnd es la ventana viva que se acaba de crear; SetWindowPos no toma posesión de nada.
    let flags = SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW;
    if let Err(e) = unsafe { SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, flags) } {
        eprintln!("[easy-cut] modo de pruebas: no se ha podido enseñar la ventana detrás: {e}");
        let _ = window.show();
    }
}

#[cfg(not(windows))]
pub fn show_behind(window: &tauri::WebviewWindow) {
    let _ = window.show();
}

#[cfg(test)]
mod tests {
    use super::is_on;

    #[test]
    fn only_exactly_one_turns_it_on() {
        assert!(is_on(Some("1")));
        assert!(!is_on(Some("0")));
        assert!(!is_on(Some("true")));
        assert!(!is_on(None));
    }
}
