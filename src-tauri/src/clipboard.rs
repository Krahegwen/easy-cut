// Ficheros copiados en el Explorador (formato CF_HDROP del portapapeles de Windows), para pegarlos con
// Ctrl+V como trozos. Win32 directo: unos 3 ms con el viaje de invoke (PowerShell con Get-Clipboard eran
// ~300 ms solo de arrancar), y las rutas llegan en UTF-16, así que las tildes y la «ñ» no se estropean.

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFiles {
    /// Número de secuencia del portapapeles: cambia cada vez que algo copia (GetClipboardSequenceNumber).
    pub sequence: u32,
    pub paths: Vec<String>,
}

/// UTF-16 (sin el cero final) → String, sin perder caracteres válidos.
pub fn decode_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

#[cfg(windows)]
mod imp {
    use super::{decode_wide, ClipboardFiles};
    use std::ffi::c_void;
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard};

    /// CF_HDROP (winuser.h).
    const CF_HDROP: u32 = 15;

    #[link(name = "shell32")]
    extern "system" {
        fn DragQueryFileW(hdrop: *mut c_void, ifile: u32, lpszfile: *mut u16, cch: u32) -> u32;
    }

    pub fn sequence() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    /// Lee las rutas de un bloque HDROP (el del portapapeles o uno hecho a mano en las pruebas).
    ///
    /// # Safety
    /// `hdrop` debe apuntar a un bloque DROPFILES válido mientras dure la llamada.
    pub unsafe fn paths_from_hdrop(hdrop: *mut c_void) -> Vec<String> {
        let count = unsafe { DragQueryFileW(hdrop, 0xFFFF_FFFF, std::ptr::null_mut(), 0) };
        let mut out = Vec::with_capacity(count as usize);
        for i in 0..count {
            let len = unsafe { DragQueryFileW(hdrop, i, std::ptr::null_mut(), 0) };
            if len == 0 {
                continue;
            }
            let mut buf = vec![0u16; len as usize + 1];
            let got = unsafe { DragQueryFileW(hdrop, i, buf.as_mut_ptr(), buf.len() as u32) };
            if got > 0 {
                out.push(decode_wide(&buf[..got as usize]));
            }
        }
        out
    }

    pub fn files() -> Result<ClipboardFiles, String> {
        let sequence = sequence();
        // Sin ficheros no hace falta ni abrir el portapapeles.
        if unsafe { IsClipboardFormatAvailable(CF_HDROP) }.is_err() {
            return Ok(ClipboardFiles { sequence, paths: Vec::new() });
        }
        // Otro programa puede tenerlo abierto un instante: se reintenta unas veces (como mucho ~100 ms).
        let mut opened = false;
        for _ in 0..10 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        if !opened {
            return Err("El portapapeles está ocupado por otro programa.".into());
        }
        let paths = match unsafe { GetClipboardData(CF_HDROP) } {
            Ok(handle) => unsafe { paths_from_hdrop(handle.0) },
            Err(_) => Vec::new(),
        };
        let _ = unsafe { CloseClipboard() };
        Ok(ClipboardFiles { sequence, paths })
    }
}

#[cfg(windows)]
pub use imp::{files, sequence};

#[cfg(not(windows))]
pub fn sequence() -> u32 {
    0
}

#[cfg(not(windows))]
pub fn files() -> Result<ClipboardFiles, String> {
    Ok(ClipboardFiles { sequence: 0, paths: Vec::new() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16_with_accents() {
        let s = "C:\\Usuarios\\Ana\\Vídeos\\cumpleaños de María.mp4";
        let mut wide: Vec<u16> = s.encode_utf16().collect();
        wide.push(0);
        wide.push(65);
        assert_eq!(decode_wide(&wide), s);
    }

    #[test]
    fn reading_the_sequence_leaves_the_clipboard_alone() {
        // Solo lee el número; dos lecturas seguidas sin copiar nada dan lo mismo (o más, si otro programa copia).
        let a = sequence();
        let b = sequence();
        assert!(b >= a);
    }

    /// Un bloque DROPFILES hecho a mano (como el que deja el Explorador), sin tocar el portapapeles real.
    #[cfg(windows)]
    #[test]
    fn reads_paths_from_an_hdrop_with_accents() {
        #[link(name = "kernel32")]
        extern "system" {
            fn GlobalAlloc(flags: u32, bytes: usize) -> *mut std::ffi::c_void;
            fn GlobalLock(h: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
            fn GlobalUnlock(h: *mut std::ffi::c_void) -> i32;
            fn GlobalFree(h: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        }
        const GMEM_MOVEABLE_ZEROINIT: u32 = 0x0002 | 0x0040;
        let paths = ["C:\\Vídeos\\Año nuevo\\toma 1.mp4", "D:\\Música\\voz ñandú.m4a"];
        // DROPFILES: pFiles (u32), pt (2 × i32), fNC (i32), fWide (i32) = 20 bytes; luego las rutas UTF-16
        // separadas por cero y un cero más al final.
        let mut wide: Vec<u16> = Vec::new();
        for p in paths {
            wide.extend(p.encode_utf16());
            wide.push(0);
        }
        wide.push(0);
        let header = 20usize;
        let bytes = header + wide.len() * 2;
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE_ZEROINIT, bytes);
            assert!(!h.is_null());
            let p = GlobalLock(h) as *mut u8;
            (p as *mut u32).write_unaligned(header as u32);
            (p.add(16) as *mut i32).write_unaligned(1);
            std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, p.add(header), wide.len() * 2);
            GlobalUnlock(h);
            let got = imp::paths_from_hdrop(h);
            GlobalFree(h);
            assert_eq!(got, paths.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        }
    }
}
