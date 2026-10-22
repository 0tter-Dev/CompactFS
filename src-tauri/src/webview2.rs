//! Verificação do runtime do Microsoft Edge WebView2 antes de abrir a janela.
//!
//! Sem o runtime, o Tauri mostraria um diálogo próprio em inglês. Aqui avisamos em português
//! e encerramos de forma limpa. Reaproveita crates que o Tauri já embute (sem peso novo).

use std::path::Path;

use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

pub const MISSING_TITLE: &str = "CompactFS";

pub const MISSING_MESSAGE: &str = "O CompactFS precisa do Microsoft Edge WebView2 Runtime, que não foi encontrado neste computador.\n\nInstale-o em https://developer.microsoft.com/microsoft-edge/webview2/ e abra o CompactFS novamente.";

/// Indica se há um runtime do WebView2 utilizável.
///
/// Com `folder = None` usa a instalação do sistema (ou a variável `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`);
/// com `Some(pasta)` procura apenas nessa pasta (runtime "fixed version").
pub fn runtime_available_in(folder: Option<&Path>) -> bool {
    let folder = folder.map(|p| HSTRING::from(p.to_string_lossy().as_ref()));
    let folder = folder
        .as_ref()
        .map_or(PCWSTR::null(), |h| PCWSTR(h.as_ptr()));

    let mut version = PWSTR::null();
    // SAFETY: `folder` é nulo ou aponta para um HSTRING vivo até o fim da função; `version` é um
    // ponteiro de saída válido.
    let result = unsafe { GetAvailableCoreWebView2BrowserVersionString(folder, &mut version) };
    if result.is_err() || version.is_null() {
        return false;
    }
    // SAFETY: a string retornada é alocada com CoTaskMemAlloc e pertence a quem chamou.
    unsafe { CoTaskMemFree(Some(version.0.cast_const().cast())) };
    true
}

pub fn is_runtime_available() -> bool {
    runtime_available_in(None)
}

pub fn show_missing_runtime_message() {
    let text = HSTRING::from(MISSING_MESSAGE);
    let title = HSTRING::from(MISSING_TITLE);
    // SAFETY: os dois HSTRING vivem até o fim da chamada.
    unsafe {
        MessageBoxW(None, &text, &title, MB_OK | MB_ICONERROR);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_unavailable_when_runtime_folder_does_not_exist() {
        let missing = Path::new("C:\\compactfs-test\\pasta-que-nao-existe\\webview2");
        assert!(!runtime_available_in(Some(missing)));
    }

    #[test]
    fn missing_runtime_message_is_in_portuguese_and_points_to_the_download() {
        assert!(MISSING_MESSAGE.contains("não foi encontrado"));
        assert!(
            MISSING_MESSAGE.contains("https://developer.microsoft.com/microsoft-edge/webview2/")
        );
    }
}
