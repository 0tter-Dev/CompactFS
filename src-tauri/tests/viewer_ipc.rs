//! Contrato IPC dos comandos dos visualizadores (texto, escopo de arquivos e "abrir no app padrão").

use std::time::Instant;

use compactfs_lib::configure;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::MockRuntime;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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

fn path_of(p: &std::path::Path) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn read_text_returns_the_json_shape_expected_by_the_frontend() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("nota.txt");
    std::fs::write(&file, "olá, mundo\n").unwrap();
    let (_app, window) = setup();

    let value =
        call(&window, "read_text", json!({ "path": path_of(&file) })).expect("comando read_text");
    assert_eq!(value["text"], "olá, mundo\n");
    assert_eq!(value["encoding"], "utf-8");
    assert_eq!(value["truncated"], false);
    assert_eq!(value["totalBytes"], 12);
    assert!(value.get("total_bytes").is_none());
}

#[test]
fn read_text_reports_errors_with_a_code() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("dados.bin");
    std::fs::write(&bin, [0u8, 1, 2, 3]).unwrap();
    let (_app, window) = setup();

    let binary = call(&window, "read_text", json!({ "path": path_of(&bin) })).expect_err("binário");
    assert_eq!(binary["code"], "binary");
    let missing = call(
        &window,
        "read_text",
        json!({ "path": path_of(&dir.path().join("x.txt")) }),
    )
    .expect_err("inexistente");
    assert_eq!(missing["code"], "notFound");
    let folder =
        call(&window, "read_text", json!({ "path": path_of(dir.path()) })).expect_err("pasta");
    assert_eq!(folder["code"], "notAFile");
    assert!(call(&window, "read_text", json!({})).is_err());
}

#[test]
fn open_default_refuses_programs_and_scripts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = setup();
    for name in [
        "programa.exe",
        "script.bat",
        "atalho.lnk",
        "macro.docm",
        "truque.exe.",
    ] {
        let file = dir.path().join(name);
        std::fs::write(&file, b"x").unwrap();
        let err = call(&window, "open_default", json!({ "path": path_of(&file) }))
            .expect_err(&format!("{name} deveria ser recusado"));
        assert_eq!(err["code"], "blocked", "{name}");
        assert!(err["message"]
            .as_str()
            .is_some_and(|m| m.contains("não é aberto")));
    }
}

#[test]
fn allow_view_unlocks_only_the_requested_file_in_the_asset_scope() {
    let dir = tempfile::tempdir().unwrap();
    let (a, b) = (dir.path().join("a.png"), dir.path().join("b.png"));
    std::fs::write(&a, b"a").unwrap();
    std::fs::write(&b, b"b").unwrap();
    let (app, window) = setup();
    let scope = app.asset_protocol_scope();
    assert!(!scope.is_allowed(&a), "o escopo deve começar vazio");

    call(&window, "allow_view", json!({ "path": path_of(&a) })).expect("allow_view");
    assert!(scope.is_allowed(&a), "o arquivo pedido deve ficar liberado");
    assert!(
        !scope.is_allowed(&b),
        "outro arquivo da mesma pasta não pode ser liberado"
    );
    assert!(
        !scope.is_allowed(dir.path()),
        "a pasta não pode ser liberada"
    );
}

#[test]
fn allow_view_refuses_missing_files_and_folders_without_touching_the_scope() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = setup();
    let missing = dir.path().join("nao-existe.png");

    let err =
        call(&window, "allow_view", json!({ "path": path_of(&missing) })).expect_err("inexistente");
    assert_eq!(err["code"], "notFound");
    let err = call(
        &window,
        "allow_view",
        json!({ "path": path_of(dir.path()) }),
    )
    .expect_err("pasta");
    assert_eq!(err["code"], "notAFile");
    assert!(!app.asset_protocol_scope().is_allowed(&missing));
    assert!(!app
        .asset_protocol_scope()
        .is_allowed(dir.path().join("qualquer.txt")));
}
