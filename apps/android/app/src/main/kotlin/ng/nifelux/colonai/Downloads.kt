package ng.nifelux.colonai

import android.Manifest
import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import androidx.core.content.ContextCompat
import java.io.File

/**
 * Downloads through Android's DownloadManager (progress notification, resumes on flaky data, survives the app
 * closing), plus saving bytes the web app already holds (blob: exports) into Downloads.
 */
object Downloads {
    /** Starts a download; returns the file name, or null when the URL isn't http(s). */
    fun enqueue(context: Context, url: String, userAgent: String?, contentDisposition: String?, mime: String?): String? {
        if (!UrlRules.isWebUrl(url)) return null
        val name = safeName(URLUtil.guessFileName(url, contentDisposition, mime))
        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
        mime?.takeIf { it.isNotBlank() }?.let { req.setMimeType(it) }
        userAgent?.let { req.addRequestHeader("User-Agent", it) }
        // Cookies let signed-in downloads work (for example a file attached in Colon AI).
        try { CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) } } catch (_: Exception) {}
        if (canWritePublic(context)) {
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        } else {
            req.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, name)
        }
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        dm.enqueue(req)
        return name
    }

    /** Saves bytes as a file in Downloads (Android 10+) or the app's own download folder (older). */
    fun saveBytes(context: Context, fileName: String, mime: String?, bytes: ByteArray): String {
        val name = safeName(fileName)
        val type = mime?.takeIf { it.contains('/') }
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', ""))
            ?: "application/octet-stream"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, type)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("no_storage")
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IllegalStateException("no_storage")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            return "Download/$name"
        }
        val dir = if (canWritePublic(context)) {
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        } else {
            context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        } ?: throw IllegalStateException("no_storage")
        dir.mkdirs()
        val file = uniqueFile(dir, name)
        file.writeBytes(bytes)
        return file.absolutePath
    }

    private fun canWritePublic(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED

    private fun uniqueFile(dir: File, name: String): File {
        var f = File(dir, name)
        var n = 1
        val base = name.substringBeforeLast('.')
        val ext = name.substringAfterLast('.', "").let { if (it.isEmpty()) "" else ".$it" }
        while (f.exists() && n < 1000) f = File(dir, "$base (${n++})$ext")
        return f
    }

    /** File names without path separators or control characters, at most 120 characters. */
    fun safeName(name: String?): String {
        val cleaned = (name ?: "").replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().trimStart('.')
        return cleaned.take(120).ifEmpty { "download" }
    }
}
