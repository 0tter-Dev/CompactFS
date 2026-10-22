//! Testes de integração do contrato IPC entre a interface e o núcleo, com o runtime de mock do Tauri.

use std::time::{Duration, Instant};

use compactfs_lib::configure;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn invoke(cmd: &str, started_at: Instant) -> Result<serde_json::Value, serde_json::Value> {
    let app = configure(mock_builder(), started_at)
        .build(mock_context(noop_assets()))
        .expect("app de teste");
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .expect("janela de teste");
    get_ipc_response(
        &window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("url"),
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize().expect("json"))
}

#[test]
fn app_info_command_returns_camel_case_json_expected_by_the_frontend() {
    let started_at = Instant::now() - Duration::from_millis(250);
    let value = invoke("app_info", started_at).expect("comando app_info registrado");
    assert_eq!(value["name"], "CompactFS");
    assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
    let ms = value["startupMs"].as_u64().expect("startupMs numérico");
    assert!((250..10_250).contains(&ms), "startupMs fora da faixa: {ms}");
    assert!(value.get("startup_ms").is_none());
}

#[test]
fn unknown_command_is_rejected() {
    assert!(invoke("get_app_info", Instant::now()).is_err());
}
