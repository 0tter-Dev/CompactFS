use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Builder, Manager, Runtime, State};

mod address;
mod browse;
mod drives;
mod media;
mod search;
mod storage;
mod thumbs;
mod viewer;
#[cfg(windows)]
mod webview2;

use address::Resolved;
use browse::{BrowseError, ErrorCode, Listing};
use drives::Drive;
use media::PdfInfo;
use search::{Query, SearchEvent, SearchSummary};
use storage::StorageAccess;
use thumbs::{ThumbError, ThumbErrorCode};
use viewer::{TextContent, ViewError, ViewErrorCode};

/// Código de saída quando o app não abre por falta do WebView2 Runtime.
#[cfg(windows)]
const MISSING_WEBVIEW2_EXIT_CODE: i32 = 1;

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

/// `now` é injetado para o cálculo ser determinístico nos testes.
fn build_info(started_at: Instant, now: Instant) -> AppInfo {
    let elapsed = now.saturating_duration_since(started_at);
    AppInfo {
        name: "CompactFS",
        version: env!("CARGO_PKG_VERSION"),
        startup_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
    }
}

#[tauri::command]
fn app_info(started_at: State<'_, StartedAt>) -> AppInfo {
    build_info(started_at.0, Instant::now())
}

/// Discos do computador. Roda fora da thread principal para não travar a interface se um disco demorar.
#[tauri::command]
async fn list_drives() -> Vec<Drive> {
    tauri::async_runtime::spawn_blocking(drives::list_drives)
        .await
        .unwrap_or_default()
}

/// Conteúdo de uma pasta (somente leitura). Roda fora da thread principal: em HD lento a leitura
/// pode demorar, e a interface não pode congelar.
#[tauri::command]
async fn list_dir(path: String) -> Result<Listing, BrowseError> {
    tauri::async_runtime::spawn_blocking(move || browse::list_dir(Path::new(&path)))
        .await
        .map_err(|e| {
            BrowseError::new(
                ErrorCode::Other,
                format!("Falha interna ao listar a pasta: {e}"),
            )
        })?
}

/// Se o app já tem o acesso a todos os arquivos (Android). Fora do Android não há o que pedir.
#[tauri::command]
async fn storage_access<R: Runtime>(app: AppHandle<R>) -> Result<StorageAccess, BrowseError> {
    tauri::async_runtime::spawn_blocking(move || storage::status(&app))
        .await
        .map_err(|e| {
            BrowseError::new(
                ErrorCode::Other,
                format!("Falha interna ao consultar o acesso: {e}"),
            )
        })?
}

/// Abre a tela do sistema onde o usuário concede o acesso a todos os arquivos (Android).
#[tauri::command]
async fn request_storage_access<R: Runtime>(app: AppHandle<R>) -> Result<(), BrowseError> {
    tauri::async_runtime::spawn_blocking(move || storage::request(&app))
        .await
        .map_err(|e| {
            BrowseError::new(
                ErrorCode::Other,
                format!("Falha interna ao pedir o acesso: {e}"),
            )
        })?
}

/// Diz para onde o texto digitado na barra de endereço aponta (pasta, arquivo ou "Este computador").
/// Só consulta metadados; `base` é a pasta aberta, usada para caminhos relativos.
#[tauri::command]
async fn resolve_path(input: String, base: Option<String>) -> Result<Resolved, BrowseError> {
    tauri::async_runtime::spawn_blocking(move || {
        address::resolve(&input, base.as_deref().map(Path::new))
    })
    .await
    .map_err(|e| {
        BrowseError::new(
            ErrorCode::Other,
            format!("Falha interna ao resolver o caminho: {e}"),
        )
    })?
}

/// Miniatura de um arquivo, em binário: largura e altura (u32 little-endian) e depois o RGBA.
/// Roda fora da thread principal; a extração é limitada em paralelismo e em tempo (ver `thumbs`).
#[tauri::command]
async fn thumbnail<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    size: u32,
) -> Result<tauri::ipc::Response, ThumbError> {
    let thumb = tauri::async_runtime::spawn_blocking(move || {
        media::thumbnail(&app, Path::new(&path), size)
    })
    .await
    .map_err(|e| {
        ThumbError::new(
            ThumbErrorCode::Other,
            format!("Falha interna ao gerar a miniatura: {e}"),
        )
    })??;
    Ok(tauri::ipc::Response::new(thumbs::encode(&thumb)))
}

/// Páginas de um PDF quando o app mesmo as desenha (Android). `None` no Windows, onde o
/// visualizador nativo do WebView2 mostra o PDF.
#[tauri::command]
async fn pdf_info<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Option<PdfInfo>, ViewError> {
    tauri::async_runtime::spawn_blocking(move || media::pdf_info(&app, Path::new(&path)))
        .await
        .map_err(|e| {
            ViewError::new(
                ViewErrorCode::Other,
                format!("Falha interna ao abrir o PDF: {e}"),
            )
        })?
}

/// Uma página do PDF em JPEG (binário). Só no Android.
#[tauri::command]
async fn pdf_page<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    page: u32,
    width: u32,
) -> Result<tauri::ipc::Response, ViewError> {
    let jpeg = tauri::async_runtime::spawn_blocking(move || {
        media::pdf_page(&app, Path::new(&path), page, width)
    })
    .await
    .map_err(|e| {
        ViewError::new(
            ViewErrorCode::Other,
            format!("Falha interna ao desenhar a página: {e}"),
        )
    })??;
    Ok(tauri::ipc::Response::new(jpeg))
}

/// Libera o arquivo para o protocolo de arquivos (`asset:`), que alimenta imagem, vídeo, áudio e PDF.
/// O escopo começa vazio: só arquivos que o usuário abriu num visualizador ficam acessíveis.
#[tauri::command]
fn allow_view<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), ViewError> {
    let path = Path::new(&path);
    viewer::ensure_file(path)?;
    app.asset_protocol_scope().allow_file(path).map_err(|e| {
        ViewError::new(
            ViewErrorCode::Other,
            format!("Não foi possível liberar o arquivo: {e}"),
        )
    })
}

/// Texto de um arquivo (até 1 MiB), com a codificação detectada. Roda fora da thread principal.
#[tauri::command]
async fn read_text(path: String) -> Result<TextContent, ViewError> {
    tauri::async_runtime::spawn_blocking(move || viewer::read_text(Path::new(&path)))
        .await
        .map_err(|e| {
            ViewError::new(
                ViewErrorCode::Other,
                format!("Falha interna ao ler o arquivo: {e}"),
            )
        })?
}

/// Abre o arquivo no app padrão do sistema (nunca programas, scripts, atalhos nem macros).
#[tauri::command]
async fn open_default<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), ViewError> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        {
            viewer::check_openable(Path::new(&path))?;
            storage::open_file(&app, Path::new(&path))
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = &app;
            viewer::open_default(Path::new(&path))
        }
    })
    .await
    .map_err(|e| {
        ViewError::new(
            ViewErrorCode::Other,
            format!("Falha interna ao abrir o arquivo: {e}"),
        )
    })?
}

/// Bandeira de cancelamento da busca em andamento (só existe uma por vez).
#[derive(Default)]
struct SearchControl(Mutex<Option<Arc<AtomicBool>>>);

/// Busca por nome na pasta e nas subpastas. Os resultados chegam em lotes pelo canal enquanto a busca
/// anda; o retorno é o resumo final. Uma busca nova cancela a anterior.
#[tauri::command]
async fn search_names(
    control: State<'_, SearchControl>,
    root: String,
    query: String,
    show_hidden: bool,
    on_event: Channel<SearchEvent>,
) -> Result<SearchSummary, BrowseError> {
    let Some(query) = Query::parse(&query) else {
        return Err(BrowseError::new(
            ErrorCode::Other,
            "Digite algo para buscar.",
        ));
    };
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(previous) = control
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .replace(cancel.clone())
    {
        previous.store(true, Ordering::Relaxed);
    }
    let flag = cancel.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let summary = search::search(
            Path::new(&root),
            &query,
            show_hidden,
            search::MAX_RESULTS,
            &flag,
            |event| {
                // Se a janela sumiu, não há para quem enviar; a busca segue até acabar ou ser cancelada.
                let _ = on_event.send(event);
            },
        )?;
        // O fim vai pelo mesmo canal dos resultados: a interface só pode concluir a busca depois de
        // ter recebido todos os lotes, e a resposta do comando pode chegar antes deles.
        let _ = on_event.send(SearchEvent::Done {
            summary: summary.clone(),
        });
        Ok(summary)
    })
    .await
    .map_err(|e| BrowseError::new(ErrorCode::Other, format!("Falha interna na busca: {e}")))?;

    // Só limpa a bandeira se ainda for a desta busca (outra pode ter começado no meio tempo).
    let mut current = control.0.lock().unwrap_or_else(|e| e.into_inner());
    if current.as_ref().is_some_and(|c| Arc::ptr_eq(c, &cancel)) {
        *current = None;
    }
    result
}

/// Cancela a busca em andamento, se houver.
#[tauri::command]
fn cancel_search(control: State<'_, SearchControl>) {
    if let Some(flag) = control.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Registra o estado e os comandos do app. Separado de `run()` para ser testável com o runtime de mock.
#[doc(hidden)]
pub fn configure<R: Runtime>(builder: Builder<R>, started_at: Instant) -> Builder<R> {
    #[cfg(target_os = "android")]
    let builder = builder.plugin(storage::init()).plugin(media::init());
    builder
        .manage(StartedAt(started_at))
        .manage(SearchControl::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_drives,
            list_dir,
            resolve_path,
            thumbnail,
            allow_view,
            read_text,
            open_default,
            search_names,
            cancel_search,
            storage_access,
            request_storage_access,
            pdf_info,
            pdf_page
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let started_at = Instant::now();

    #[cfg(windows)]
    if !webview2::is_runtime_available() {
        webview2::show_missing_runtime_message();
        std::process::exit(MISSING_WEBVIEW2_EXIT_CODE);
    }
    drives::suppress_critical_error_dialogs();

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
        let now = Instant::now();
        let info = build_info(now, now);
        assert_eq!(info.name, "CompactFS");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn build_info_measures_exact_elapsed_milliseconds() {
        let started_at = Instant::now();
        let now = started_at + Duration::from_millis(250);
        assert_eq!(build_info(started_at, now).startup_ms, 250);
    }

    #[test]
    fn build_info_truncates_sub_millisecond_remainders() {
        let started_at = Instant::now();
        let now = started_at + Duration::from_micros(1_999);
        assert_eq!(build_info(started_at, now).startup_ms, 1);
    }

    #[test]
    fn build_info_never_reports_negative_time_when_clock_order_is_inverted() {
        let now = Instant::now();
        let started_at = now + Duration::from_secs(1);
        assert_eq!(build_info(started_at, now).startup_ms, 0);
    }
}
