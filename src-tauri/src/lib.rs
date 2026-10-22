use std::time::Instant;

use serde::Serialize;
use tauri::State;

/// Momento em que o processo iniciou, usado para medir o tempo até a janela ficar pronta.
struct StartedAt(Instant);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    startup_ms: u128,
}

fn build_info(started_at: Instant) -> AppInfo {
    AppInfo {
        name: "CompactFS",
        version: env!("CARGO_PKG_VERSION"),
        startup_ms: started_at.elapsed().as_millis(),
    }
}

#[tauri::command]
fn app_info(started_at: State<'_, StartedAt>) -> AppInfo {
    build_info(started_at.0)
}

pub fn run() {
    let started_at = StartedAt(Instant::now());
    tauri::Builder::default()
        .manage(started_at)
        .invoke_handler(tauri::generate_handler![app_info])
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
        assert!(build_info(started_at).startup_ms >= 250);
    }
}
