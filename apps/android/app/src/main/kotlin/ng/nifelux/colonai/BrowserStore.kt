package ng.nifelux.colonai

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * History, bookmarks and the open tabs, kept on the phone only (ROADMAP Phase 8: a user's browsing stays on their
 * device). Small JSON lists in private SharedPreferences; history is capped.
 */
class BrowserStore(context: Context) {
    data class Entry(val url: String, val title: String, val time: Long)

    private val prefs = context.getSharedPreferences("colon.browser", Context.MODE_PRIVATE)

    fun history(): List<Entry> = read("history")
    fun bookmarks(): List<Entry> = read("bookmarks")

    fun addHistory(url: String, title: String) {
        if (!UrlRules.isWebUrl(url)) return
        write("history", Lists.addHistory(history(), Entry(url, title, System.currentTimeMillis()), HISTORY_CAP))
    }

    fun removeHistory(url: String) = write("history", history().filter { it.url != url })
    fun clearHistory() = write("history", emptyList())

    fun isBookmarked(url: String): Boolean = bookmarks().any { it.url == url }

    /** Adds or removes a bookmark; returns true when the page is now bookmarked. */
    fun toggleBookmark(url: String, title: String): Boolean {
        val list = bookmarks()
        return if (list.any { it.url == url }) { write("bookmarks", list.filter { it.url != url }); false }
        else { write("bookmarks", listOf(Entry(url, title, System.currentTimeMillis())) + list); true }
    }

    fun removeBookmark(url: String) = write("bookmarks", bookmarks().filter { it.url != url })

    var tabsJson: String?
        get() = prefs.getString("tabs", null)
        set(v) { prefs.edit().putString("tabs", v).apply() }

    private fun read(key: String): List<Entry> = try {
        val arr = JSONArray(prefs.getString(key, "[]"))
        (0 until arr.length()).mapNotNull { i ->
            arr.optJSONObject(i)?.let { Entry(it.optString("u"), it.optString("t"), it.optLong("at")) }
        }.filter { it.url.isNotEmpty() }
    } catch (_: Exception) {
        emptyList()
    }

    private fun write(key: String, list: List<Entry>) {
        val arr = JSONArray()
        list.forEach { arr.put(JSONObject().put("u", it.url).put("t", it.title.take(200)).put("at", it.time)) }
        prefs.edit().putString(key, arr.toString()).apply()
    }

    /** Pure list rules, unit-tested in BrowserStoreTest. */
    object Lists {
        /** Newest first; visiting a page again moves it to the top instead of adding a duplicate. */
        fun addHistory(list: List<Entry>, e: Entry, cap: Int): List<Entry> =
            (listOf(e) + list.filter { it.url != e.url }).take(cap)
    }

    companion object {
        const val HISTORY_CAP = 300
    }
}
