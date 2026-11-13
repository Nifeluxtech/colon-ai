package ng.nifelux.colonai

import org.json.JSONArray
import org.json.JSONObject

/**
 * The open tabs as saved between app restarts (ROADMAP Phase 8: tabs and history survive restarts). Pure JSON
 * rules, unit-tested in TabSnapshotTest:
 * - private (incognito) tabs are never written, so nothing of them survives the app closing;
 * - only the home page and http(s) URLs are kept, titles are trimmed, at most [max] tabs;
 * - the active tab is remembered by id; when it was private (not saved) the last saved tab becomes active.
 */
object TabSnapshot {
    data class Tab(val id: String, val url: String, val title: String, val incognito: Boolean = false,
                   val desktop: Boolean = false)
    data class State(val tabs: List<Tab>, val activeId: String?)

    const val VERSION = 2

    fun encode(tabs: List<Tab>, activeId: String?): String {
        val kept = tabs.filter { !it.incognito && isRestorable(it.url) }
        val active = activeId?.takeIf { id -> kept.any { it.id == id } } ?: kept.lastOrNull()?.id
        return JSONObject()
            .put("v", VERSION)
            .put("active", active ?: JSONObject.NULL)
            .put("tabs", JSONArray().apply {
                kept.forEach { t ->
                    put(JSONObject().put("id", t.id).put("url", t.url).put("title", t.title.take(TITLE_MAX))
                        .put("desktop", t.desktop))
                }
            }).toString()
    }

    /** Reads a saved snapshot (also v0.7.x's format, which had no "v"); empty state when missing or broken. */
    fun decode(json: String?, max: Int): State {
        if (json.isNullOrBlank()) return State(emptyList(), null)
        val o = try { JSONObject(json) } catch (_: Exception) { return State(emptyList(), null) }
        val arr = o.optJSONArray("tabs") ?: return State(emptyList(), null)
        val out = mutableListOf<Tab>()
        val seen = mutableSetOf<String>()
        for (i in 0 until arr.length()) {
            if (out.size >= max) break
            val t = arr.optJSONObject(i) ?: continue
            val url = t.optString("url")
            if (!isRestorable(url) || t.optBoolean("incognito")) continue
            val id = t.optString("id").takeIf { it.isNotEmpty() && it.length <= 40 && it !in seen } ?: "r$i"
            seen += id
            out += Tab(id, url, t.optString("title").take(TITLE_MAX), false, t.optBoolean("desktop"))
        }
        val active = (if (o.isNull("active")) null else o.optString("active"))?.takeIf { id -> out.any { it.id == id } }
        return State(out, active ?: out.lastOrNull()?.id)
    }

    fun isRestorable(url: String): Boolean = url == UrlRules.HOME || UrlRules.isWebUrl(url)

    private const val TITLE_MAX = 200
}
