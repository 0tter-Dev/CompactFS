//! Testes de integração do contrato IPC entre a interface e o núcleo, com o runtime de mock do Tauri.

use std::time::{Duration, Instant};

use compactfs_lib::configure;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn invoke_with(cmd: &str, body: Value, started_at: Instant) -> Result<Value, Value> {
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
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize().expect("json"))
}

fn invoke(cmd: &str, started_at: Instant) -> Result<Value, Value> {
    invoke_with(cmd, json!({}), started_at)
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

#[test]
fn list_dir_returns_the_json_shape_expected_by_the_frontend() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("pasta")).unwrap();
    std::fs::write(dir.path().join("dados.bin"), [0u8; 42]).unwrap();

    let path = dir.path().to_string_lossy().into_owned();
    let listing = invoke_with("list_dir", json!({ "path": path }), Instant::now())
        .expect("comando list_dir registrado");

    assert_eq!(listing["path"], path.as_str());
    assert!(listing["parent"].is_string());
    assert!(listing["breadcrumbs"]
        .as_array()
        .is_some_and(|c| !c.is_empty()));
    assert!(listing["separator"].is_string());
    assert_eq!(listing["skipped"], 0);
    assert!(listing["elapsedMs"].is_u64());
    assert!(listing.get("elapsed_ms").is_none());

    let entries = listing["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 2);
    // Pastas primeiro.
    assert_eq!(entries[0]["name"], "pasta");
    assert_eq!(entries[0]["kind"], "dir");
    assert_eq!(entries[1]["name"], "dados.bin");
    assert_eq!(entries[1]["kind"], "file");
    assert_eq!(entries[1]["size"], 42);
    assert!(entries[1]["modifiedMs"].is_i64());
    assert_eq!(entries[1]["hidden"], false);
    assert_eq!(entries[1]["isLink"], false);
    assert!(entries[1].get("modified_ms").is_none());
}

#[test]
fn list_dir_reports_errors_with_a_code_and_a_portuguese_message() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("nao-existe").to_string_lossy().into_owned();
    let err = invoke_with("list_dir", json!({ "path": missing }), Instant::now())
        .expect_err("pasta inexistente deve falhar");
    assert_eq!(err["code"], "notFound");
    assert!(err["message"]
        .as_str()
        .is_some_and(|m| m.contains("não foi encontrada")));
}

#[test]
fn list_dir_rejects_a_missing_path_argument() {
    assert!(invoke("list_dir", Instant::now()).is_err());
}

#[cfg(windows)]
#[test]
fn list_drives_returns_drive_roots_in_the_expected_shape() {
    let drives = invoke("list_drives", Instant::now()).expect("comando list_drives registrado");
    let drives = drives.as_array().expect("lista de discos");
    assert!(!drives.is_empty());
    for d in drives {
        let path = d["path"].as_str().expect("path");
        assert!(
            path.len() == 3 && path.ends_with(":\\"),
            "caminho inesperado: {path}"
        );
        assert!(matches!(
            d["kind"].as_str(),
            Some("removable" | "fixed" | "network" | "optical" | "ram" | "unknown")
        ));
        assert!(d["ready"].is_boolean());
        assert!(d.get("total_bytes").is_none());
    }
}
