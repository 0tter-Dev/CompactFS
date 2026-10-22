use std::time::Instant;

use serde::Serialize;
use tauri::{Builder, Runtime, State};

#[cfg(windows)]
mod webview2;

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

fn build_info(started_at: Instant) -> AppInfo {
    AppInfo {
        name: "CompactFS",
        version: env!("CARGO_PKG_VERSION"),
        startup_ms: u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX),
    }
}

#[tauri::command]
fn app_info(started_at: State<'_, StartedAt>) -> AppInfo {
    build_info(started_at.0)
}

/// Registra o estado e os comandos do app. Separado de `run()` para ser testável com o runtime de mock.
#[doc(hidden)]
pub fn configure<R: Runtime>(builder: Builder<R>, started_at: Instant) -> Builder<R> {
    builder
        .manage(StartedAt(started_at))
        .invoke_handler(tauri::generate_handler![app_info])
}

pub fn run() {
    let started_at = Instant::now();

    #[cfg(windows)]
    if !webview2::is_runtime_available() {
        webview2::show_missing_runtime_message();
        return;
    }

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
        let info = build_info(Instant::now());
        assert_eq!(info.name, "CompactFS");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn build_info_measures_elapsed_time_since_start() {
        let started_at = Instant::now() - Duration::from_millis(250);
        let ms = build_info(started_at).startup_ms;
        assert!(
            (250..10_250).contains(&ms),
            "startup_ms fora da faixa: {ms}"
        );
    }
}
