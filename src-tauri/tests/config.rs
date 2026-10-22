//! Guarda a configuração de segurança do Tauri contra regressões (a CSP já quebrou o IPC uma vez).

fn csp() -> String {
    let conf: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json válido");
    conf["app"]["security"]["csp"]
        .as_str()
        .expect("csp definida como string")
        .to_owned()
}

fn directive(csp: &str, name: &str) -> Option<String> {
    csp.split(';')
        .map(str::trim)
        .find(|d| d.split_whitespace().next() == Some(name))
        .map(str::to_owned)
}

#[test]
fn csp_allows_the_tauri_ipc_protocol() {
    let connect = directive(&csp(), "connect-src").expect("connect-src definida");
    assert!(connect.contains("ipc:"), "connect-src sem ipc: {connect}");
    assert!(
        connect.contains("http://ipc.localhost"),
        "connect-src sem http://ipc.localhost: {connect}"
    );
}

#[test]
fn csp_stays_restrictive() {
    let csp = csp();
    assert_eq!(
        directive(&csp, "default-src").as_deref(),
        Some("default-src 'self'")
    );
    assert!(
        !csp.contains("unsafe-inline"),
        "unsafe-inline na CSP: {csp}"
    );
    assert!(!csp.contains("unsafe-eval"), "unsafe-eval na CSP: {csp}");
    assert_eq!(
        directive(&csp, "base-uri").as_deref(),
        Some("base-uri 'none'")
    );
    assert_eq!(
        directive(&csp, "form-action").as_deref(),
        Some("form-action 'none'")
    );
}

#[test]
fn main_window_capability_grants_no_extra_permissions() {
    let cap: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("capability válida");
    let perms = cap["permissions"].as_array().expect("permissions é lista");
    assert!(perms.is_empty(), "permissões inesperadas: {perms:?}");
}
