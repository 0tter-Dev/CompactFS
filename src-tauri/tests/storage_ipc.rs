//! Contrato IPC do acesso a todos os arquivos. No Windows não há o que pedir: o app informa isso.

use std::time::Instant;

use compactfs_lib::configure;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

fn setup() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = configure(mock_builder(), Instant::now())
        .build(mock_context(noop_assets()))
        .expect("app de teste");
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .expect("janela de teste");
    (app, window)
}

fn call(window: &WebviewWindow<MockRuntime>, cmd: &str) -> Result<Value, Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("url"),
            body: InvokeBody::Json(json!({})),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize().expect("json"))
}

#[test]
fn storage_access_reports_nothing_to_ask_outside_android() {
    let (_app, window) = setup();
    let access = call(&window, "storage_access").expect("comando registrado");
    assert_eq!(access, json!({ "supported": false, "granted": true }));
}

#[test]
fn request_storage_access_is_harmless_outside_android() {
    let (_app, window) = setup();
    assert!(call(&window, "request_storage_access").is_ok());
}
