use std::{path::Path, time::Instant};

use serde::Serialize;
use tauri::{Builder, Runtime, State};

mod browse;
mod drives;
#[cfg(windows)]
mod webview2;

use browse::{BrowseError, ErrorCode, Listing};
use drives::Drive;

/// Código de saída quando o app não abre por falta do WebView2 Runtime.
#[cfg(windows)]
const MISSING_WEBVIEW2_EXIT_CODE: i32 = 1;

/// Instante de entrada de `run()` (aproximação do início do processo), base do tempo de inicialização.
struct StartedAt(Instant);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    /// Milissegundos desde a entrada de `run()` até a interface chamar o comando.
    startup_ms: u64,
}

/// `now` é injetado para o cálculo ser determinístico nos testes.
fn build_info(started_at: Instant, now: Instant) -> AppInfo {
    let elapsed = now.saturating_duration_since(started_at);
    AppInfo {
        name: "CompactFS",
        version: env!("CARGO_PKG_VERSION"),
        startup_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
    }
}

#[tauri::command]
fn app_info(started_at: State<'_, StartedAt>) -> AppInfo {
    build_info(started_at.0, Instant::now())
}

/// Discos do computador. Roda fora da thread principal para não travar a interface se um disco demorar.
#[tauri::command]
async fn list_drives() -> Vec<Drive> {
    tauri::async_runtime::spawn_blocking(drives::list_drives)
        .await
        .unwrap_or_default()
}

/// Conteúdo de uma pasta (somente leitura). Roda fora da thread principal: em HD lento a leitura
/// pode demorar, e a interface não pode congelar.
#[tauri::command]
async fn list_dir(path: String) -> Result<Listing, BrowseError> {
    tauri::async_runtime::spawn_blocking(move || browse::list_dir(Path::new(&path)))
        .await
        .map_err(|e| {
            BrowseError::new(
                ErrorCode::Other,
                format!("Falha interna ao listar a pasta: {e}"),
            )
        })?
}

/// Registra o estado e os comandos do app. Separado de `run()` para ser testável com o runtime de mock.
#[doc(hidden)]
pub fn configure<R: Runtime>(builder: Builder<R>, started_at: Instant) -> Builder<R> {
    builder
        .manage(StartedAt(started_at))
        .invoke_handler(tauri::generate_handler![app_info, list_drives, list_dir])
}

pub fn run() {
    let started_at = Instant::now();

    #[cfg(windows)]
    if !webview2::is_runtime_available() {
        webview2::show_missing_runtime_message();
        std::process::exit(MISSING_WEBVIEW2_EXIT_CODE);
    }
    drives::suppress_critical_error_dialogs();

    configure(tauri::Builder::default(), started_at)
        .run(tauri::generate_context!())
        .expect("erro ao executar o CompactFS");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn build_info_reports_package_identity() {
        let now = Instant::now();
        let info = build_info(now, now);
        assert_eq!(info.name, "CompactFS");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn build_info_measures_exact_elapsed_milliseconds() {
        let started_at = Instant::now();
        let now = started_at + Duration::from_millis(250);
        assert_eq!(build_info(started_at, now).startup_ms, 250);
    }

    #[test]
    fn build_info_truncates_sub_millisecond_remainders() {
        let started_at = Instant::now();
        let now = started_at + Duration::from_micros(1_999);
        assert_eq!(build_info(started_at, now).startup_ms, 1);
    }

    #[test]
    fn build_info_never_reports_negative_time_when_clock_order_is_inverted() {
        let now = Instant::now();
        let started_at = now + Duration::from_secs(1);
        assert_eq!(build_info(started_at, now).startup_ms, 0);
    }
}
