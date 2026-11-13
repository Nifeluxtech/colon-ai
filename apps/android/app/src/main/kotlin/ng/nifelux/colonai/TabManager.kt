package ng.nifelux.colonai

import android.os.Bundle
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/** One browser tab. Its WebView exists only while the tab is "live"; a discarded tab keeps its history in [saved]. */
class BrowserTab(val id: String, var url: String, var title: String) {
    var webView: WebView? = null
    var saved: Bundle? = null
    var lastUsed: Long = System.currentTimeMillis()
    var progress = 100

    val live: Boolean get() = webView != null
    fun label(): String = title.ifBlank { UrlRules.displayUrl(url).ifBlank { "New tab" } }
}

/** Which background tabs to discard. Pure, unit-tested in TabPolicyTest. */
object TabPolicy {
    data class Info(val id: String, val lastUsed: Long, val live: Boolean)

    /** Ids of live tabs to discard so at most [maxLive] stay live; the active tab is never chosen. */
    fun discards(tabs: List<Info>, activeId: String?, maxLive: Int): List<String> {
        val live = tabs.filter { it.live }
        val excess = live.size - maxLive.coerceAtLeast(1)
        if (excess <= 0) return emptyList()
        return live.filter { it.id != activeId }.sortedBy { it.lastUsed }.take(excess).map { it.id }
    }

    /** Live WebViews allowed: 1 background tab on low-RAM phones, more as the memory class grows. */
    fun maxLiveFor(lowRam: Boolean, memoryClassMb: Int): Int = when {
        lowRam || memoryClassMb < 128 -> 2
        memoryClassMb < 256 -> 3
        else -> 5
    }

    fun maxTabsFor(lowRam: Boolean): Int = if (lowRam) 10 else 30
}

/**
 * One WebView per tab, managed for small phones: only a few tabs keep a live WebView, the rest are discarded
 * (back/forward history kept) and reload when opened again. Tabs survive restarts through [toJson].
 */
class TabManager(private val host: Host, private val maxLive: Int, val maxTabs: Int) {
    interface Host {
        fun createTabWebView(tab: BrowserTab): WebView
        fun destroyTabWebView(webView: WebView)
        fun loadInto(webView: WebView, url: String)
        fun onActiveTabChanged(tab: BrowserTab?)
        fun onTabsChanged()
    }

    val tabs = mutableListOf<BrowserTab>()
    var active: BrowserTab? = null
        private set
    private var seq = 0

    /** Opens a tab; null when the tab limit is reached. */
    fun open(url: String, foreground: Boolean = true): BrowserTab? {
        if (tabs.size >= maxTabs) return null
        val tab = BrowserTab("t${System.currentTimeMillis().toString(36)}${seq++}", url, "")
        val at = active?.let { tabs.indexOf(it) + 1 } ?: tabs.size
        tabs.add(at.coerceIn(0, tabs.size), tab)
        if (foreground) switchTo(tab) else host.onTabsChanged()
        return tab
    }

    fun find(id: String?): BrowserTab? = tabs.firstOrNull { it.id == id }

    fun switchTo(tab: BrowserTab) {
        if (tab !in tabs) return
        active?.takeIf { it !== tab }?.webView?.onPause()
        active = tab
        tab.lastUsed = System.currentTimeMillis()
        ensureLive(tab).onResume()
        trim(maxLive)
        host.onActiveTabChanged(tab)
        host.onTabsChanged()
    }

    fun ensureLive(tab: BrowserTab): WebView {
        tab.webView?.let { return it }
        val wv = host.createTabWebView(tab)
        tab.webView = wv
        val state = tab.saved
        tab.saved = null
        if (state == null || wv.restoreState(state) == null) host.loadInto(wv, tab.url)
        return wv
    }

    fun close(tab: BrowserTab) {
        val index = tabs.indexOf(tab)
        if (index < 0) return
        tabs.removeAt(index)
        discard(tab, keepState = false)
        if (active === tab) {
            active = null
            val next = tabs.getOrNull(index.coerceAtMost(tabs.size - 1))
            if (next != null) switchTo(next) else host.onActiveTabChanged(null)
        }
        host.onTabsChanged()
    }

    fun closeAll() {
        tabs.toList().forEach { discard(it, keepState = false) }
        tabs.clear()
        active = null
        host.onActiveTabChanged(null)
        host.onTabsChanged()
    }

    /** Frees a tab's WebView. Its back/forward list is kept unless [keepState] is false. */
    fun discard(tab: BrowserTab, keepState: Boolean = true) {
        val wv = tab.webView ?: return
        if (keepState) tab.saved = Bundle().also { wv.saveState(it) }
        tab.webView = null
        host.destroyTabWebView(wv)
    }

    /** Discards least-recently-used background tabs beyond [limit] live WebViews. */
    fun trim(limit: Int) {
        val ids = TabPolicy.discards(tabs.map { TabPolicy.Info(it.id, it.lastUsed, it.live) }, active?.id, limit)
        ids.mapNotNull { find(it) }.forEach { discard(it) }
    }

    fun toJson(): String = JSONObject()
        .put("active", active?.id)
        .put("tabs", JSONArray().apply {
            tabs.forEach { put(JSONObject().put("id", it.id).put("url", it.url).put("title", it.title)) }
        }).toString()

    /** Restores saved tabs as discarded tabs (they load when opened); returns the tab that was active. */
    fun restore(json: String?): BrowserTab? {
        if (json.isNullOrBlank()) return null
        val o = try { JSONObject(json) } catch (_: Exception) { return null }
        val arr = o.optJSONArray("tabs") ?: return null
        for (i in 0 until arr.length().coerceAtMost(maxTabs)) {
            val t = arr.optJSONObject(i) ?: continue
            val url = t.optString("url")
            if (url != UrlRules.HOME && !UrlRules.isWebUrl(url)) continue
            tabs += BrowserTab(t.optString("id").ifEmpty { "r$i" }, url, t.optString("title"))
        }
        return find(o.optString("active")) ?: tabs.lastOrNull()
    }
}
