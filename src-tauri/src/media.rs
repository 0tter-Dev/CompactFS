//! Miniaturas e páginas de PDF no Android, feitas pelo `MediaPlugin` (Kotlin) com as classes do
//! próprio sistema. Fora do Android os comandos existem, mas só respondem "não se aplica".

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "android")]
use crate::thumbs::ThumbErrorCode;
use crate::thumbs::{ThumbError, Thumbnail};
use crate::viewer::ViewError;
#[cfg(target_os = "android")]
use crate::viewer::ViewErrorCode;

/// Número e tamanho (em pontos) das páginas de um PDF.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    pub pages: u32,
    pub width: u32,
    pub height: u32,
}

/// Decodifica base64 padrão (com ou sem `=` no fim, sem quebras de linha). O Kotlin entrega os
/// pixels assim; um decodificador de 20 linhas evita uma dependência só para isso.
#[cfg(any(target_os = "android", test))]
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    fn sextet(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some(u32::from(c - b'A')),
            b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let symbols: Vec<u8> = text.bytes().filter(|&b| b != b'=').collect();
    let mut out = Vec::with_capacity(symbols.len() * 3 / 4);
    for group in symbols.chunks(4) {
        let mut acc = 0u32;
        for &c in group {
            acc = (acc << 6) | sextet(c)?;
        }
        match group.len() {
            4 => out.extend([(acc >> 16) as u8, (acc >> 8) as u8, acc as u8]),
            3 => out.extend([(acc >> 10) as u8, (acc >> 2) as u8]),
            2 => out.push((acc >> 4) as u8),
            _ => return None,
        }
    }
    Some(out)
}

#[cfg(target_os = "android")]
mod android {
    use serde::{Deserialize, Serialize};
    use tauri::{
        plugin::{mobile::PluginInvokeError, Builder, PluginHandle, TauriPlugin},
        AppHandle, Manager, Runtime,
    };

    pub struct Handle<R: Runtime>(pub PluginHandle<R>);

    #[derive(Serialize)]
    pub struct ThumbArgs<'a> {
        pub path: &'a str,
        pub size: u32,
    }

    #[derive(Serialize)]
    pub struct PdfInfoArgs<'a> {
        pub path: &'a str,
    }

    #[derive(Serialize)]
    pub struct PdfPageArgs<'a> {
        pub path: &'a str,
        pub page: u32,
        pub width: u32,
    }

    #[derive(Deserialize)]
    pub struct ThumbReply {
        pub width: u32,
        pub height: u32,
        pub rgba: String,
    }

    #[derive(Deserialize)]
    pub struct PdfInfoReply {
        pub pages: u32,
        #[serde(default)]
        pub width: u32,
        #[serde(default)]
        pub height: u32,
    }

    #[derive(Deserialize)]
    pub struct PdfPageReply {
        pub jpeg: String,
    }

    /// Código e mensagem que o Kotlin devolveu ao recusar um pedido.
    pub fn rejection(e: PluginInvokeError) -> (Option<String>, String) {
        match e {
            PluginInvokeError::InvokeRejected(r) => (
                r.code,
                r.message.unwrap_or_else(|| "Falha no plugin.".to_owned()),
            ),
            other => (None, other.to_string()),
        }
    }

    pub fn handle<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, Handle<R>> {
        app.state::<Handle<R>>()
    }

    /// Registra o `MediaPlugin` (Kotlin) no app.
    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("media")
            .setup(|app, api| {
                let handle =
                    api.register_android_plugin("dev.otterdev.compactfs", "MediaPlugin")?;
                app.manage(Handle(handle));
                Ok(())
            })
            .build()
    }
}

#[cfg(target_os = "android")]
pub use android::init;

#[cfg(target_os = "android")]
pub fn thumbnail<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
    size: u32,
) -> Result<Thumbnail, ThumbError> {
    let text = path.to_string_lossy();
    let reply: android::ThumbReply = android::handle(app)
        .0
        .run_mobile_plugin("thumbnail", android::ThumbArgs { path: &text, size })
        .map_err(|e| {
            let (code, message) = android::rejection(e);
            let code = match code.as_deref() {
                Some("unavailable") => ThumbErrorCode::Unavailable,
                Some("notFound") => ThumbErrorCode::NotFound,
                _ => ThumbErrorCode::Other,
            };
            ThumbError::new(code, message)
        })?;
    let rgba = decode_base64(&reply.rgba)
        .filter(|px| px.len() as u64 == u64::from(reply.width) * u64::from(reply.height) * 4);
    match rgba {
        Some(rgba) => Ok(Thumbnail {
            width: reply.width,
            height: reply.height,
            rgba,
        }),
        None => Err(ThumbError::new(
            ThumbErrorCode::Other,
            "A miniatura chegou corrompida.",
        )),
    }
}

#[cfg(target_os = "android")]
fn view_error(e: tauri::plugin::mobile::PluginInvokeError) -> ViewError {
    let (code, message) = android::rejection(e);
    let code = match code.as_deref() {
        Some("notFound") => ViewErrorCode::NotFound,
        _ => ViewErrorCode::Other,
    };
    ViewError::new(code, message)
}

#[cfg(target_os = "android")]
pub fn pdf_info<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<Option<PdfInfo>, ViewError> {
    let text = path.to_string_lossy();
    let reply: android::PdfInfoReply = android::handle(app)
        .0
        .run_mobile_plugin("pdfInfo", android::PdfInfoArgs { path: &text })
        .map_err(view_error)?;
    Ok(Some(PdfInfo {
        pages: reply.pages,
        width: reply.width,
        height: reply.height,
    }))
}

/// JPEG da página `page` (a partir de 0) com `width` pixels de largura.
#[cfg(target_os = "android")]
pub fn pdf_page<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
    page: u32,
    width: u32,
) -> Result<Vec<u8>, ViewError> {
    let text = path.to_string_lossy();
    let reply: android::PdfPageReply = android::handle(app)
        .0
        .run_mobile_plugin(
            "pdfPage",
            android::PdfPageArgs {
                path: &text,
                page,
                width,
            },
        )
        .map_err(view_error)?;
    decode_base64(&reply.jpeg)
        .ok_or_else(|| ViewError::new(ViewErrorCode::Other, "A página chegou corrompida."))
}

/// No Windows o PDF abre no visualizador nativo do WebView2: `None` diz isso à interface.
#[cfg(not(target_os = "android"))]
pub fn pdf_info<R: Runtime>(
    _app: &AppHandle<R>,
    _path: &Path,
) -> Result<Option<PdfInfo>, ViewError> {
    Ok(None)
}

#[cfg(not(target_os = "android"))]
pub fn pdf_page<R: Runtime>(
    _app: &AppHandle<R>,
    _path: &Path,
    _page: u32,
    _width: u32,
) -> Result<Vec<u8>, ViewError> {
    Err(ViewError::new(
        crate::viewer::ViewErrorCode::Other,
        "As páginas do PDF só são geradas pelo app no Android.",
    ))
}

/// Miniatura de `path`: no Android vem do plugin; nos outros sistemas, do extrator do sistema.
#[cfg(not(target_os = "android"))]
pub fn thumbnail<R: Runtime>(
    _app: &AppHandle<R>,
    path: &Path,
    size: u32,
) -> Result<Thumbnail, ThumbError> {
    crate::thumbs::thumbnail(path, size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_base64_handles_every_padding_length() {
        assert_eq!(decode_base64("").unwrap(), b"");
        assert_eq!(decode_base64("Zg==").unwrap(), b"f");
        assert_eq!(decode_base64("Zm8=").unwrap(), b"fo");
        assert_eq!(decode_base64("Zm9v").unwrap(), b"foo");
        assert_eq!(decode_base64("Zm9vYg==").unwrap(), b"foob");
        assert_eq!(decode_base64("Zm9vYmE=").unwrap(), b"fooba");
        assert_eq!(decode_base64("Zm9vYmFy").unwrap(), b"foobar");
    }

    #[test]
    fn decode_base64_accepts_missing_padding() {
        assert_eq!(decode_base64("Zg").unwrap(), b"f");
        assert_eq!(decode_base64("Zm8").unwrap(), b"fo");
    }

    #[test]
    fn decode_base64_covers_the_whole_alphabet() {
        // 0xfb 0xff 0xbf usa '+' e '/' ; 0x00 0x10 0x83 usa o começo do alfabeto.
        assert_eq!(decode_base64("+/+/").unwrap(), [0xfb, 0xff, 0xbf]);
        assert_eq!(decode_base64("ABCD").unwrap(), [0x00, 0x10, 0x83]);
        assert_eq!(decode_base64("abcd").unwrap(), [0x69, 0xb7, 0x1d]);
        assert_eq!(decode_base64("0123").unwrap(), [0xd3, 0x5d, 0xb7]);
    }

    #[test]
    fn decode_base64_rejects_invalid_input() {
        assert!(decode_base64("Zm9v\n").is_none());
        assert!(decode_base64("Zm 9v").is_none());
        assert!(decode_base64("Zm9v!").is_none());
        assert!(decode_base64("Z").is_none());
        assert!(decode_base64("Zm9vY").is_none());
    }

    #[test]
    fn decode_base64_round_trips_a_larger_buffer() {
        // Codifica à mão (referência independente) um padrão que passa por todos os valores de byte.
        const ALPHA: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let data: Vec<u8> = (0..1000u32).map(|i| (i * 7 % 256) as u8).collect();
        let mut text = String::new();
        for chunk in data.chunks(3) {
            let n = chunk
                .iter()
                .enumerate()
                .fold(0u32, |a, (i, &b)| a | (u32::from(b) << (16 - 8 * i)));
            let take = chunk.len() + 1;
            for k in 0..take {
                text.push(ALPHA[((n >> (18 - 6 * k)) & 63) as usize] as char);
            }
            for _ in take..4 {
                text.push('=');
            }
        }
        assert_eq!(decode_base64(&text).unwrap(), data);
    }
}
