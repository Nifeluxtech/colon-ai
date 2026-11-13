package ng.nifelux.colonai

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * <input type="file"> for WebViews: opens the system picker with the page's accepted types (images, PDFs, ...)
 * and hands the chosen files back. Create it in onCreate (it registers an activity result launcher).
 */
class FileChooser(activity: ComponentActivity) {
    private var pending: ValueCallback<Array<Uri>>? = null

    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val cb = pending ?: return@registerForActivityResult
        pending = null
        cb.onReceiveValue(if (r.resultCode == Activity.RESULT_OK) uris(r.data) else null)
    }

    /** WebChromeClient.onShowFileChooser: true when the picker opened (the page then waits for the callback). */
    fun show(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        pending?.onReceiveValue(null) // a second chooser cancels the first, as Chrome does
        pending = callback
        val mimes = params.acceptTypes.flatMap { it.split(',') }.map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .map { if (it.startsWith('.')) mimeForExtension(it) else it }
            .distinct()
            .let { if ("*/*" in it) emptyList() else it } // an unknown type means "any file"
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (mimes.size == 1) mimes[0] else "*/*"
            if (mimes.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
        }
        return try {
            launcher.launch(intent)
            true
        } catch (_: ActivityNotFoundException) {
            pending = null
            callback.onReceiveValue(null)
            false
        }
    }

    private fun uris(data: Intent?): Array<Uri>? {
        if (data == null) return null
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) return Array(clip.itemCount) { clip.getItemAt(it).uri }
        return data.data?.let { arrayOf(it) }
    }

    private fun mimeForExtension(ext: String): String = when (ext) {
        ".pdf" -> "application/pdf"
        ".png" -> "image/png"
        ".jpg", ".jpeg" -> "image/jpeg"
        ".webp" -> "image/webp"
        ".gif" -> "image/gif"
        ".txt", ".md", ".csv" -> "text/*"
        ".zip" -> "application/zip"
        else -> "*/*"
    }
}
