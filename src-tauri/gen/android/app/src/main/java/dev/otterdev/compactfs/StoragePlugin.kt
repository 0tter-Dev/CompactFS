package dev.otterdev.compactfs

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class OpenArgs {
    lateinit var path: String
}

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

    /**
     * Abre o arquivo no app padrão. O núcleo já recusou os tipos bloqueados (programas, instaladores,
     * scripts); aqui só se monta a intenção `VIEW` com um endereço `content://` do FileProvider.
     */
    @Command
    fun openFile(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        val file = File(args.path)
        if (!file.isFile) {
            invoke.reject("O arquivo não foi encontrado.", "notFound")
            return
        }
        activity.runOnUiThread {
            try {
                val uri = FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", file)
                val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"
                val view = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, mime)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.startActivity(view)
                invoke.resolve()
            } catch (e: ActivityNotFoundException) {
                invoke.reject("Nenhum app instalado abre este tipo de arquivo.", "noApp")
            } catch (e: IllegalArgumentException) {
                invoke.reject("Não foi possível entregar este arquivo a outro app.", "other")
            }
        }
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
