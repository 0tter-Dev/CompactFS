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
fn csp_lets_files_in_only_through_the_asset_protocol() {
    let csp = csp();
    // Imagem, mídia e o quadro do PDF só podem vir do protocolo de arquivos do app.
    for name in ["img-src", "media-src", "frame-src"] {
        let d = directive(&csp, name).unwrap_or_else(|| panic!("{name} ausente na CSP: {csp}"));
        assert!(
            d.contains("asset:") && d.contains("http://asset.localhost"),
            "{name}: {d}"
        );
        for forbidden in [" *", "data:", "blob:", "https:", "http:/", "unsafe"] {
            // "http://asset.localhost" é o único http permitido.
            let without_asset = d.replace("http://asset.localhost", "");
            assert!(
                !without_asset.contains(forbidden),
                "{name} permite {forbidden:?}: {d}"
            );
        }
    }
    // Nenhuma outra diretiva abre a porta para conteúdo externo.
    assert!(
        directive(&csp, "script-src").is_none(),
        "script-src só vem de default-src 'self'"
    );
    assert!(
        directive(&csp, "object-src").is_none(),
        "object-src só vem de default-src 'self'"
    );
}

#[test]
fn the_asset_protocol_starts_with_an_empty_scope() {
    let conf: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json válido");
    let asset = &conf["app"]["security"]["assetProtocol"];
    assert_eq!(asset["enable"], true);
    // Escopo vazio: nada é legível até o usuário abrir um arquivo (comando allow_view).
    assert_eq!(asset["scope"].as_array().map(Vec::len), Some(0), "{asset}");
}

#[test]
fn main_window_capability_grants_no_extra_permissions() {
    let cap: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("capability válida");
    let perms = cap["permissions"].as_array().expect("permissions é lista");
    assert!(perms.is_empty(), "permissões inesperadas: {perms:?}");
}
