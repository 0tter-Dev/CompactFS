package dev.otterdev.compactfs

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Acesso a todos os arquivos (MANAGE_EXTERNAL_STORAGE): consulta e pedido. O usuário concede ou
 * revoga na tela de configurações do sistema; o app só abre essa tela e consulta o resultado.
 */
@TauriPlugin
class StoragePlugin(private val activity: Activity) : Plugin(activity) {
    /** Antes do Android 11 essa permissão não existe; o app não pede nada nessas versões. */
    private fun supported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R

    private fun granted(): Boolean = !supported() || Environment.isExternalStorageManager()

    @Command
    fun status(invoke: Invoke) {
        val result = JSObject()
        result.put("supported", supported())
        result.put("granted", granted())
        invoke.resolve(result)
    }

    @Command
    fun requestAccess(invoke: Invoke) {
        if (!granted()) {
            val own = Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:" + activity.packageName),
            )
            try {
                activity.startActivity(own)
            } catch (e: Exception) {
                // Alguns aparelhos não têm a tela específica do app: abre a lista geral.
                activity.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }
        }
        invoke.resolve()
    }
}
