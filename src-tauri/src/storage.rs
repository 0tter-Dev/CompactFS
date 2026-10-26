//! Acesso a todos os arquivos no Android: consulta e pedido, feitos por um plugin em Kotlin
//! (`StoragePlugin`). Fora do Android não há nada a pedir.

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::browse::BrowseError;
#[cfg(target_os = "android")]
use crate::browse::ErrorCode;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageAccess {
    /// `false` quando não há o que pedir (Windows, ou Android anterior ao 11).
    pub supported: bool,
    pub granted: bool,
}

#[cfg(target_os = "android")]
mod android {
    use serde::Deserialize;
    use tauri::{
        plugin::{Builder, PluginHandle, TauriPlugin},
        Manager, Runtime,
    };

    pub struct Handle<R: Runtime>(pub PluginHandle<R>);

    #[derive(Deserialize)]
    pub struct Status {
        pub supported: bool,
        pub granted: bool,
    }

    /// Registra o `StoragePlugin` (Kotlin) no app.
    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("storage")
            .setup(|app, api| {
                let handle =
                    api.register_android_plugin("dev.otterdev.compactfs", "StoragePlugin")?;
                app.manage(Handle(handle));
                Ok(())
            })
            .build()
    }
}

#[cfg(target_os = "android")]
pub use android::init;

#[cfg(target_os = "android")]
fn plugin_error(e: impl std::fmt::Display) -> BrowseError {
    BrowseError::new(
        ErrorCode::Other,
        format!("Não foi possível consultar o acesso aos arquivos: {e}"),
    )
}

#[cfg(target_os = "android")]
pub fn status<R: Runtime>(app: &AppHandle<R>) -> Result<StorageAccess, BrowseError> {
    use tauri::Manager;
    let handle = app.state::<android::Handle<R>>();
    let status: android::Status = handle
        .0
        .run_mobile_plugin("status", ())
        .map_err(plugin_error)?;
    Ok(StorageAccess {
        supported: status.supported,
        granted: status.granted,
    })
}

/// Abre a tela de configurações do sistema onde o usuário concede o acesso.
#[cfg(target_os = "android")]
pub fn request<R: Runtime>(app: &AppHandle<R>) -> Result<(), BrowseError> {
    use tauri::Manager;
    let handle = app.state::<android::Handle<R>>();
    handle
        .0
        .run_mobile_plugin::<()>("requestAccess", ())
        .map_err(plugin_error)
}

#[cfg(not(target_os = "android"))]
pub fn status<R: Runtime>(_app: &AppHandle<R>) -> Result<StorageAccess, BrowseError> {
    Ok(StorageAccess {
        supported: false,
        granted: true,
    })
}

#[cfg(not(target_os = "android"))]
pub fn request<R: Runtime>(_app: &AppHandle<R>) -> Result<(), BrowseError> {
    Ok(())
}
