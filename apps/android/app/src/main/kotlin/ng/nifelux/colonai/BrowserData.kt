package ng.nifelux.colonai

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewDatabase

/**
 * "Clear browsing data" (ClearDataActivity): history, cookies, cached files, site storage and the downloads list,
 * each on its own. Cookies and site storage are shared by every WebView of the app, so clearing them must not
 * sign the user out of Colon AI: Colon's own origins and its session cookies are kept.
 */
object BrowserData {
    data class Choice(val history: Boolean, val cookies: Boolean, val cache: Boolean, val siteStorage: Boolean,
                      val downloads: Boolean) {
        val any: Boolean get() = history || cookies || cache || siteStorage || downloads
    }

    private val KEEP_COOKIES = listOf("colon_sid", "colon_gid")

    /** The Colon session cookies ("name=value") in a Cookie header, the only ones put back after clearing. Pure. */
    fun keptCookies(header: String?): List<String> =
        header?.split(';')?.map { it.trim() }?.filter { c -> KEEP_COOKIES.any { c.startsWith("$it=") } }.orEmpty()

    /** Site-storage origins to delete: every origin except Colon's own pages. Pure. */
    fun originsToClear(origins: Collection<String>): List<String> =
        origins.filter { UrlRules.originOf(it) !in UrlRules.SHELL_ORIGINS }

    fun clear(context: Context, store: BrowserStore, c: Choice, done: () -> Unit) {
        if (c.history) store.clearHistory()
        if (c.downloads) store.clearDownloads() // the list only; downloaded files stay in Downloads
        if (c.cache) WebView(context).run { clearCache(true); destroy() }
        if (c.siteStorage) {
            val storage = WebStorage.getInstance()
            storage.getOrigins { map ->
                originsToClear(map?.keys?.map { it.toString() }.orEmpty()).forEach { storage.deleteOrigin(it) }
            }
            @Suppress("DEPRECATION")
            WebViewDatabase.getInstance(context).clearHttpAuthUsernamePassword()
        }
        if (c.cookies) clearCookies(done) else done()
    }

    private fun clearCookies(done: () -> Unit) {
        val cm = CookieManager.getInstance()
        val api = BuildConfig.API_URL
        val kept = keptCookies(cm.getCookie(api))
        cm.removeAllCookies {
            // Put the Colon session back (HttpOnly + Secure, as the API sets it).
            kept.forEach { cm.setCookie(api, "$it; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000") }
            cm.flush()
            done()
        }
    }
}
