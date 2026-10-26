//! Contrato IPC da barra de endereço: o formato do JSON que a interface recebe.

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

fn call(window: &WebviewWindow<MockRuntime>, body: Value) -> Result<Value, Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: "resolve_path".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().expect("url"),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize().expect("json"))
}

#[test]
fn resolve_path_returns_tagged_results_in_camel_case() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("nota.txt");
    std::fs::write(&file, b"x").unwrap();
    let (_app, window) = setup();

    let computer = call(&window, json!({ "input": "Este computador", "base": null })).unwrap();
    assert_eq!(computer, json!({ "kind": "computer" }));

    let folder = call(
        &window,
        json!({ "input": dir.path().to_string_lossy(), "base": null }),
    )
    .unwrap();
    assert_eq!(folder["kind"], "dir");
    assert_eq!(folder["path"], dir.path().to_string_lossy().as_ref());

    let found = call(
        &window,
        json!({ "input": file.to_string_lossy(), "base": null }),
    )
    .unwrap();
    assert_eq!(found["kind"], "file");
    assert_eq!(found["name"], "nota.txt");
    assert_eq!(found["parent"], dir.path().to_string_lossy().as_ref());
}

#[test]
fn resolve_path_accepts_a_missing_base_and_uses_it_for_relative_paths() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    let (_app, window) = setup();

    // `base` omitido (undefined no JS) equivale a nulo.
    let no_base = call(&window, json!({ "input": "sub" })).expect_err("sem base");
    assert!(no_base["message"]
        .as_str()
        .is_some_and(|m| m.contains("caminho completo")));

    let relative = call(
        &window,
        json!({ "input": "sub", "base": dir.path().to_string_lossy() }),
    )
    .unwrap();
    assert_eq!(relative["kind"], "dir");
}

#[test]
fn resolve_path_reports_errors_with_a_code_and_a_portuguese_message() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = setup();

    let empty = call(&window, json!({ "input": "  ", "base": null })).expect_err("vazio");
    assert!(empty["message"]
        .as_str()
        .is_some_and(|m| m.contains("Digite um caminho")));

    let missing = call(
        &window,
        json!({ "input": dir.path().join("nao-existe").to_string_lossy(), "base": null }),
    )
    .expect_err("inexistente");
    assert_eq!(missing["code"], "notFound");

    assert!(call(&window, json!({ "base": null })).is_err());
}
