//! Contrato IPC da busca por nome: resumo em camelCase, erros com código e cancelamento.

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

fn call(window: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
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

fn search_args(root: &std::path::Path, query: &str, hidden: bool) -> Value {
    json!({
        "root": root.to_string_lossy(),
        "query": query,
        "showHidden": hidden,
        // O Tauri entrega um Channel como o texto "__CHANNEL__:<id>".
        "onEvent": "__CHANNEL__:1",
    })
}

#[test]
fn search_names_returns_the_summary_expected_by_the_frontend() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("a/b")).unwrap();
    std::fs::write(dir.path().join("a/b/relatório 2024.pdf"), b"x").unwrap();
    std::fs::write(dir.path().join("relatorio.txt"), b"x").unwrap();
    std::fs::write(dir.path().join("outro.txt"), b"x").unwrap();
    let (_app, window) = setup();

    let summary = call(
        &window,
        "search_names",
        search_args(dir.path(), "RELATORIO", false),
    )
    .expect("comando search_names registrado");
    assert_eq!(summary["matches"], 2);
    assert_eq!(summary["scannedDirs"], 3);
    assert_eq!(summary["scannedEntries"], 5);
    assert_eq!(summary["skippedDirs"], 0);
    assert_eq!(summary["truncated"], false);
    assert_eq!(summary["cancelled"], false);
    assert!(summary["elapsedMs"].is_u64());
    assert!(summary.get("scanned_dirs").is_none() && summary.get("elapsed_ms").is_none());
}

#[test]
fn search_names_reports_errors_with_a_code_and_a_portuguese_message() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = setup();

    let empty = call(
        &window,
        "search_names",
        search_args(dir.path(), "   ", false),
    )
    .expect_err("texto vazio");
    assert!(empty["message"]
        .as_str()
        .is_some_and(|m| m.contains("Digite algo")));

    let missing = call(
        &window,
        "search_names",
        search_args(&dir.path().join("nao-existe"), "x", false),
    )
    .expect_err("pasta inexistente");
    assert_eq!(missing["code"], "notFound");

    assert!(call(
        &window,
        "search_names",
        json!({ "root": "x", "query": "y" })
    )
    .is_err());
}

#[test]
fn cancel_search_is_harmless_when_nothing_is_running() {
    let (_app, window) = setup();
    assert!(call(&window, "cancel_search", json!({})).is_ok());
    assert!(call(&window, "cancel_search", json!({})).is_ok());
}
