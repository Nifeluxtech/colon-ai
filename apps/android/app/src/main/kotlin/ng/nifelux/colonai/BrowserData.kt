package ng.nifelux.colonai

import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/**
 * "Clear browsing data". Cookies and site storage are shared by every WebView in the app, so clearing them for
 * websites must not sign the user out of Colon AI: Colon's own origins and its session cookies are kept.
 */
object BrowserData {
    private val KEEP_COOKIES = listOf("colon_sid", "colon_gid")

    fun confirmClear(a: BrowserActivity, done: () -> Unit) {
        val labels = arrayOf(a.getString(R.string.clear_history), a.getString(R.string.clear_sites),
            a.getString(R.string.clear_cache))
        val checked = booleanArrayOf(true, false, true)
        MaterialAlertDialogBuilder(a)
            .setTitle(R.string.clear_data)
            .setMultiChoiceItems(labels, checked) { _, which, isChecked -> checked[which] = isChecked }
            .setPositiveButton(R.string.clear) { _, _ ->
                if (checked[0]) a.store.clearHistory()
                if (checked[1]) clearSites()
                if (checked[2]) a.tabs.active?.webView?.clearCache(true) ?: WebView(a).run { clearCache(true); destroy() }
                a.toast(a.getString(R.string.cleared))
                done()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun clearSites() {
        val cm = CookieManager.getInstance()
        val api = BuildConfig.API_URL
        val kept = cm.getCookie(api)?.split(';')?.map { it.trim() }
            ?.filter { c -> KEEP_COOKIES.any { c.startsWith("$it=") } }.orEmpty()
        cm.removeAllCookies {
            // Put the Colon session back (HttpOnly + Secure, as the API sets it).
            kept.forEach { cm.setCookie(api, "$it; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000") }
            cm.flush()
        }
        val storage = WebStorage.getInstance()
        storage.getOrigins { map ->
            map?.keys?.map { it.toString() }?.forEach { origin ->
                if (UrlRules.originOf(origin) !in UrlRules.SHELL_ORIGINS) storage.deleteOrigin(origin)
            }
        }
    }
}
