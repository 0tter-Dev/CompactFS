package dev.otterdev.compactfs

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.os.ParcelFileDescriptor
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

@InvokeArg
class ThumbArgs {
    lateinit var path: String
    var size: Int = 192
}

@InvokeArg
class PdfInfoArgs {
    lateinit var path: String
}

@InvokeArg
class PdfPageArgs {
    lateinit var path: String
    var page: Int = 0
    var width: Int = 800
}

/**
 * Miniaturas (imagem, vídeo e PDF) e páginas de PDF, feitas com as classes do próprio Android:
 * nenhuma biblioteca é adicionada ao app. Tudo em memória, nada é gravado no aparelho.
 */
@TauriPlugin
class MediaPlugin(private val activity: Activity) : Plugin(activity) {
    // Poucas threads: decodificar muitas imagens grandes ao mesmo tempo estoura a memória.
    private val pool = Executors.newFixedThreadPool(3)

    private val imageExt = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif")
    private val videoExt = setOf("mp4", "m4v", "mov", "3gp", "mkv", "webm", "avi")

    private fun ext(path: String) = path.substringAfterLast('.', "").lowercase()

    private fun background(invoke: Invoke, work: () -> Unit) {
        pool.execute {
            try {
                work()
            } catch (e: OutOfMemoryError) {
                invoke.reject("Memória insuficiente para este arquivo.", "other")
            } catch (e: Exception) {
                invoke.reject(e.message ?: "Falha inesperada.", "other")
            }
        }
    }

    private fun file(invoke: Invoke, path: String): File? {
        val f = File(path)
        if (!f.isFile) {
            invoke.reject("O arquivo não foi encontrado.", "notFound")
            return null
        }
        return f
    }

    // ---------- miniaturas ----------

    @Command
    fun thumbnail(invoke: Invoke) {
        val args = invoke.parseArgs(ThumbArgs::class.java)
        val size = args.size.coerceIn(32, 512)
        background(invoke) {
            val f = file(invoke, args.path) ?: return@background
            val e = ext(args.path)
            val bitmap = when {
                e in imageExt -> decodeImage(f, size)
                e in videoExt -> videoFrame(f, size)
                e == "pdf" -> pdfPageBitmap(f, 0, size, fitHeight = true)
                else -> null
            }
            if (bitmap == null) {
                invoke.reject("Sem miniatura para este tipo de arquivo.", "unavailable")
                return@background
            }
            val result = JSObject()
            result.put("width", bitmap.width)
            result.put("height", bitmap.height)
            result.put("rgba", Base64.encodeToString(rgbaOf(bitmap), Base64.NO_WRAP))
            invoke.resolve(result)
        }
    }

    /** Pixels RGBA com alfa direto (o Android guarda com alfa pré-multiplicado). */
    private fun rgbaOf(source: Bitmap): ByteArray {
        val bmp = if (source.config == Bitmap.Config.ARGB_8888) source else source.copy(Bitmap.Config.ARGB_8888, false)
        val buffer = ByteBuffer.allocate(bmp.width * bmp.height * 4)
        bmp.copyPixelsToBuffer(buffer)
        val px = buffer.array()
        var i = 0
        while (i < px.size) {
            val a = px[i + 3].toInt() and 0xFF
            if (a in 1..254) {
                for (c in 0..2) px[i + c] = min(255, (px[i + c].toInt() and 0xFF) * 255 / a).toByte()
            }
            i += 4
        }
        return px
    }

    private fun scaleToFit(bitmap: Bitmap, size: Int): Bitmap {
        val longest = max(bitmap.width, bitmap.height)
        if (longest <= size) return bitmap
        val scale = size.toFloat() / longest
        val w = max(1, (bitmap.width * scale).toInt())
        val h = max(1, (bitmap.height * scale).toInt())
        return Bitmap.createScaledBitmap(bitmap, w, h, true)
    }

    private fun decodeImage(f: File, size: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= size) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = BitmapFactory.decodeFile(f.path, opts) ?: return null
        return scaleToFit(rotateByExif(f, decoded), size)
    }

    private fun rotateByExif(f: File, bitmap: Bitmap): Bitmap {
        val orientation = try {
            ExifInterface(f.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (e: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val m = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true)
    }

    private fun videoFrame(f: File, size: Int): Bitmap? {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(f.path)
            val frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.getFrameAtTime(-1L)
                ?: return null
            return scaleToFit(frame, size)
        } finally {
            retriever.release()
        }
    }

    // ---------- PDF ----------

    /** Página `index` do PDF numa imagem opaca (o renderizador entrega fundo transparente). */
    private fun pdfPageBitmap(f: File, index: Int, target: Int, fitHeight: Boolean): Bitmap? {
        ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { renderer ->
                if (index < 0 || index >= renderer.pageCount) return null
                renderer.openPage(index).use { page ->
                    val scale = if (fitHeight) {
                        target.toFloat() / max(page.width, page.height)
                    } else {
                        target.toFloat() / page.width
                    }
                    val w = max(1, (page.width * scale).toInt())
                    val h = max(1, (page.height * scale).toInt())
                    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    Canvas(bitmap).drawColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    return bitmap
                }
            }
        }
    }

    @Command
    fun pdfInfo(invoke: Invoke) {
        val args = invoke.parseArgs(PdfInfoArgs::class.java)
        background(invoke) {
            val f = file(invoke, args.path) ?: return@background
            ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
                PdfRenderer(fd).use { renderer ->
                    val result = JSObject()
                    result.put("pages", renderer.pageCount)
                    if (renderer.pageCount > 0) {
                        renderer.openPage(0).use { page ->
                            result.put("width", page.width)
                            result.put("height", page.height)
                        }
                    }
                    invoke.resolve(result)
                }
            }
        }
    }

    @Command
    fun pdfPage(invoke: Invoke) {
        val args = invoke.parseArgs(PdfPageArgs::class.java)
        val width = args.width.coerceIn(200, 2000)
        background(invoke) {
            val f = file(invoke, args.path) ?: return@background
            val bitmap = pdfPageBitmap(f, args.page, width, fitHeight = false)
            if (bitmap == null) {
                invoke.reject("A página não existe neste PDF.", "notFound")
                return@background
            }
            // JPEG: a página sem transparência, com um décimo do tamanho do RGBA bruto.
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)
            val result = JSObject()
            result.put("width", bitmap.width)
            result.put("height", bitmap.height)
            result.put("jpeg", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
            invoke.resolve(result)
        }
    }
}
