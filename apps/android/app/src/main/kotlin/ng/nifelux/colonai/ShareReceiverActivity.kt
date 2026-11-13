package ng.nifelux.colonai

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.core.content.IntentCompat

/**
 * Invisible entry point for "Share to Colon AI" and chat links opened from other apps. It forwards to the one
 * MainActivity in Colon's own task (so sharing never starts a second copy inside the sharing app) and finishes.
 * Shared files keep their read permission because their URIs travel in ClipData with FLAG_GRANT_READ_URI_PERMISSION.
 */
class ShareReceiverActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val src = intent
        val out = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        when (src?.action) {
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> {
                out.action = src.action
                out.type = src.type
                src.getCharSequenceExtra(Intent.EXTRA_TEXT)?.let { out.putExtra(Intent.EXTRA_TEXT, it) }
                src.getStringExtra(Intent.EXTRA_SUBJECT)?.let { out.putExtra(Intent.EXTRA_SUBJECT, it) }
                val uris = mutableListOf<Uri>()
                IntentCompat.getParcelableExtra(src, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris += it }
                IntentCompat.getParcelableArrayListExtra(src, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris += it }
                src.clipData?.let { c -> for (i in 0 until c.itemCount) c.getItemAt(i).uri?.let { uris += it } }
                if (uris.isNotEmpty()) {
                    val clip = ClipData.newRawUri("shared", uris[0])
                    uris.drop(1).distinct().forEach { clip.addItem(ClipData.Item(it)) }
                    out.clipData = clip
                    out.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
            }
            Intent.ACTION_VIEW -> src.dataString?.takeIf { UrlRules.isShellUrl(it) }
                ?.let { out.putExtra(MainActivity.EXTRA_OPEN_URL, it) }
        }
        try { startActivity(out) } catch (_: Exception) {}
        finish()
    }
}
