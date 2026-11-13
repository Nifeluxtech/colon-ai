package ng.nifelux.colonai

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/**
 * Links meant for other apps (mailto:, tel:, whatsapp:, intent://, market://...). intent:// URLs are opened the
 * safe way Chrome does: only BROWSABLE activities, no explicit component or selector chosen by the page.
 */
object External {
    private val BLOCKED = setOf("javascript", "file", "content", "data", "about", "chrome", "blob", "colon")

    /** Opens the link in another app. Returns a web fallback URL to load instead, when the intent named one. */
    fun open(context: Context, url: String): String? {
        val scheme = url.substringBefore(':').lowercase()
        if (scheme in BLOCKED || scheme.isEmpty()) return null
        val intent = if (scheme == "intent") {
            try { Intent.parseUri(url, Intent.URI_INTENT_SCHEME) } catch (_: Exception) { return null }
        } else Intent(Intent.ACTION_VIEW, Uri.parse(url))
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.component = null
        intent.selector = null
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            null
        } catch (_: ActivityNotFoundException) {
            val fallback = intent.getStringExtra("browser_fallback_url")
            if (UrlRules.isWebUrl(fallback)) fallback
            else {
                Toast.makeText(context, R.string.no_app_to_open, Toast.LENGTH_SHORT).show()
                null
            }
        } catch (_: SecurityException) {
            null
        }
    }
}
