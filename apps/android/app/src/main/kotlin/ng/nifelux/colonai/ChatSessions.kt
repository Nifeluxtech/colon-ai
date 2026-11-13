package ng.nifelux.colonai

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the panel keeps per chat, on the phone only (SharedPreferences "colon.panel.chats"): the LRU order, each
 * chat's profile name, open tabs (TabSnapshot JSON) and browser mode, and which chat the panel showed last. Each
 * chat's history is its own BrowserStore history file ("colon.panel.h.<key>").
 */
class ChatSessionStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("colon.panel.chats", Context.MODE_PRIVATE)

    var current: String?
        get() = prefs.getString("current", null)
        set(v) { prefs.edit().putString("current", v).apply() }

    fun order(): List<String> = try {
        val a = JSONArray(prefs.getString("order", "[]"))
        (0 until a.length()).map { a.getString(it) }
    } catch (_: Exception) { emptyList() }

    fun setOrder(list: List<String>) { prefs.edit().putString("order", JSONArray(list).toString()).apply() }

    private fun names(): JSONObject = try { JSONObject(prefs.getString("names", "{}") ?: "{}") }
        catch (_: Exception) { JSONObject() }

    /** The profile of [key] (created on first use; a draft's name stays with the conversation that adopts it). */
    fun profileOf(key: String): String {
        val n = names()
        n.optString(key).takeIf { it.isNotEmpty() }?.let { return it }
        val name = ChatSessionRules.profileName(key)
        prefs.edit().putString("names", n.put(key, name).toString()).apply()
        return name
    }

    fun profiles(): List<String> { val n = names(); return n.keys().asSequence().map { n.optString(it) }.toList() }

    fun tabs(key: String): String? = prefs.getString("tabs:$key", null)
    fun setTabs(key: String, json: String?) { prefs.edit().putString("tabs:$key", json).apply() }
    fun mode(key: String): String? = prefs.getString("mode:$key", null)
    fun setMode(key: String, mode: String) { prefs.edit().putString("mode:$key", mode).apply() }

    fun historyName(key: String): String = "colon.panel.h." + ChatSessionRules.profileName(key).removePrefix(
        ChatSessionRules.PREFIX)

    /** Moves everything a draft kept to the conversation that adopted it. */
    fun adopt(draft: String, key: String) {
        val n = names()
        val e = prefs.edit()
        n.optString(draft).takeIf { it.isNotEmpty() }?.let { n.remove(draft); n.put(key, it) }
        e.putString("names", n.toString())
        prefs.getString("tabs:$draft", null)?.let { e.putString("tabs:$key", it) }
        prefs.getString("mode:$draft", null)?.let { e.putString("mode:$key", it) }
        e.remove("tabs:$draft").remove("mode:$draft")
        e.putString("order", JSONArray(ChatSessionRules.adopt(order(), draft, key)).toString())
        if (current == draft) e.putString("current", key)
        e.apply()
        // The draft's history file is copied under the conversation's name.
        val from = context.getSharedPreferences(historyName(draft), Context.MODE_PRIVATE)
        val to = context.getSharedPreferences(historyName(key), Context.MODE_PRIVATE)
        from.getString("history", null)?.let { to.edit().putString("history", it).apply() }
        deleteHistory(draft)
    }

    /** Forgets a chat's browser: its profile name, tabs, mode, place in the order and history. Returns the profile
     *  name it used (for ChatProfiles.delete), or null. */
    fun forget(key: String): String? {
        val n = names()
        val name = n.optString(key).takeIf { it.isNotEmpty() }
        n.remove(key)
        prefs.edit().putString("names", n.toString()).remove("tabs:$key").remove("mode:$key")
            .putString("order", JSONArray(order().filter { it != key }).toString()).apply()
        deleteHistory(key)
        return name
    }

    private fun deleteHistory(key: String) {
        try { context.deleteSharedPreferences(historyName(key)) } catch (_: Exception) {}
    }
}

/**
 * The Android side: puts a chat tab's WebView in its chat's profile, deletes profiles, and on WebViews without
 * MULTI_PROFILE clears the shared cookie jar and the chat's site storage when the panel changes chat (keeping
 * Colon's own sign-in cookies, so the user stays signed in to Colon). Never touches the private-tab profiles.
 */
object ChatProfiles {
    fun supported(): Boolean = try {
        WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)
    } catch (_: Throwable) { false }

    /** Must run before the WebView loads anything (BrowserWeb.create). False: the shared profile is used. */
    fun apply(wv: WebView, profile: String): Boolean {
        if (!supported()) return false
        return try {
            ProfileStore.getInstance().getOrCreateProfile(profile)
            WebViewCompat.setProfile(wv, profile)
            true
        } catch (_: Throwable) { false }
    }

    /** Deletes a chat's profile (its cookies, storage, cache). Fails quietly while a WebView still uses it; such
     *  leftovers are removed by [deleteStale] on the next launch. */
    fun delete(profile: String?) {
        if (profile == null || !supported()) return
        try { ProfileStore.getInstance().deleteProfile(profile) } catch (_: Throwable) {}
    }

    fun deleteStale(kept: Collection<String>, inUse: String?) {
        if (!supported()) return
        try {
            val store = ProfileStore.getInstance()
            ChatSessionRules.staleProfiles(store.allProfileNames, kept + listOfNotNull(inUse)).forEach { name ->
                try { store.deleteProfile(name) } catch (_: Exception) {}
            }
        } catch (_: Throwable) {}
    }

    /**
     * Fallback (no MULTI_PROFILE): one cookie jar for every chat. When the panel changes chat, every cookie goes
     * except Colon's own (read first and put back, so Colon stays signed in), and the site storage of the pages
     * the old chat visited is deleted. Logins on other sites therefore don't survive a chat switch.
     */
    fun clearShared(visited: Collection<String>, done: () -> Unit = {}) {
        val cm = CookieManager.getInstance()
        val keep = UrlRules.SHELL_ORIGINS.associateWith { origin -> cm.getCookie(origin).orEmpty() }
        ChatSessionRules.originsToClear(visited).forEach { o ->
            try { WebStorage.getInstance().deleteOrigin(o) } catch (_: Exception) {}
        }
        cm.removeAllCookies {
            keep.forEach { (origin, header) ->
                header.split(';').map { it.trim() }.filter { '=' in it }.forEach { pair ->
                    cm.setCookie(origin, "$pair; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=$RESTORED_MAX_AGE")
                }
            }
            cm.flush()
            done()
        }
    }

    /** Colon's own cookies put back by [clearShared]: the server still checks the session on every request. */
    private const val RESTORED_MAX_AGE = 30 * 24 * 3600
}
