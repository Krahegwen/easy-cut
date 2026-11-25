// Cámara y micrófono: WebView2 pregunta con su propio diálogo cada vez que la página llama a
// getUserMedia. Aquí se conceden directamente, solo a la propia app (tauri.localhost o el dev server).

#[cfg(windows)]
pub fn grant_camera_and_microphone(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            eprintln!("[easy-cut] no se ha podido acceder a WebView2 para los permisos de cámara");
            return;
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(
            |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                if kind != COREWEBVIEW2_PERMISSION_KIND_CAMERA && kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    return Ok(());
                }
                let mut uri = windows::core::PWSTR::null();
                args.Uri(&mut uri)?;
                let uri = webview2_com::take_pwstr(uri);
                if is_own_origin(&uri) {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                } else {
                    eprintln!("[easy-cut] permiso de cámara/micrófono no concedido a {uri}");
                }
                Ok(())
            },
        ));
        let mut token = Default::default();
        if let Err(e) = core.add_PermissionRequested(&handler, &mut token) {
            eprintln!("[easy-cut] no se ha podido registrar el permiso de cámara: {e}");
        }
    })
}

#[cfg(not(windows))]
pub fn grant_camera_and_microphone(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

/// Orígenes de la propia app: el protocolo de Tauri en Windows y el dev server de Vite.
pub fn is_own_origin(uri: &str) -> bool {
    const OWN: &[&str] = &["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:4850"];
    // Origen = esquema://host[:puerto], hasta la primera barra tras «://».
    let Some(scheme_end) = uri.find("://") else { return false };
    let rest = &uri[scheme_end + 3..];
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let origin = &uri[..scheme_end + 3 + host_end];
    OWN.iter().any(|o| origin.eq_ignore_ascii_case(o))
}

#[cfg(test)]
mod tests {
    use super::is_own_origin;

    #[test]
    fn only_the_app_origins_get_the_camera() {
        assert!(is_own_origin("http://tauri.localhost/"));
        assert!(is_own_origin("http://tauri.localhost/index.html"));
        assert!(is_own_origin("http://tauri.localhost"));
        assert!(is_own_origin("http://localhost:4850/"));
        assert!(!is_own_origin("http://localhost:4851/"));
        assert!(!is_own_origin("http://tauri.localhost.evil.com/"));
        assert!(!is_own_origin("https://example.com/"));
    }
}
