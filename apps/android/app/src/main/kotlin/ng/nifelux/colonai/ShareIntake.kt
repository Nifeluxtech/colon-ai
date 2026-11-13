package ng.nifelux.colonai

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.IntentCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Turns an ACTION_SEND / ACTION_SEND_MULTIPLE intent (text, links, images) into the payload the chat reads with
 * ColonNative.takeShare(): { text, subject, files: [{ name, type, size, base64 }], skipped }.
 * Same limits as the chat's uploads: images only, 10 MB each, 5 per message. Reading happens off the main thread.
 */
object ShareIntake {
    private const val MAX_FILES = 5
    private const val MAX_BYTES = 10L * 1024 * 1024
    private val IMAGE_TYPES = setOf("image/png", "image/jpeg", "image/webp", "image/gif")

    fun read(activity: Activity, intent: Intent, done: (JSONObject?) -> Unit) {
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.take(20_000).orEmpty()
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.take(300).orEmpty()
        val uris = streams(intent)
        val resolver = activity.contentResolver
        val main = Handler(Looper.getMainLooper())
        Thread {
            val files = JSONArray()
            var skipped = 0
            for (uri in uris) {
                if (files.length() >= MAX_FILES) { skipped++; continue }
                try {
                    val type = resolver.getType(uri)?.lowercase()
                    if (type !in IMAGE_TYPES) { skipped++; continue }
                    var name = "shared-image"
                    var size = -1L
                    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
                        ?.use { c ->
                            if (c.moveToFirst()) {
                                c.getString(0)?.let { name = Downloads.safeName(it) }
                                if (!c.isNull(1)) size = c.getLong(1)
                            }
                        }
                    if (size > MAX_BYTES) { skipped++; continue }
                    val bytes = resolver.openInputStream(uri)?.use { input ->
                        val out = java.io.ByteArrayOutputStream()
                        val buf = ByteArray(64 * 1024)
                        var total = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            total += n
                            if (total > MAX_BYTES) return@use null
                            out.write(buf, 0, n)
                        }
                        out.toByteArray()
                    }
                    if (bytes == null) { skipped++; continue }
                    files.put(JSONObject().put("name", name).put("type", type).put("size", bytes.size)
                        .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)))
                } catch (_: Exception) {
                    skipped++
                }
            }
            val payload = if (text.isBlank() && subject.isBlank() && files.length() == 0) null
            else JSONObject().put("text", text).put("subject", subject).put("files", files).put("skipped", skipped)
            main.post { done(payload) }
        }.start()
    }

    private fun streams(intent: Intent): List<Uri> {
        val list = mutableListOf<Uri>()
        if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
            IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { list += it }
        } else {
            IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { list += it }
        }
        // Forwarded intents carry the URIs (and their read grants) in ClipData too.
        intent.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { list += it } }
        return list.distinct().filter { it.scheme == "content" } // never file:// (other apps' private files)
    }
}
