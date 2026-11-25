package ng.nifelux.colonai

import android.content.Context

/**
 * Colon JetX's remembered choices (SharedPreferences "colon.jetx"): the control mode, the layout, the divider,
 * the betting site's address and the round collector switch (0.35.0). Only the address the user opens is kept,
 * never anything from the site itself (no cookies, passwords or tokens; the site's own sign-in lives in the WebView
 * like in any browser).
 */
class JetxPrefs(context: Context) {
    private val p = context.applicationContext.getSharedPreferences("colon.jetx", Context.MODE_PRIVATE)

    var mode: JetxRules.Mode
        get() = JetxRules.Mode.from(p.getString(K_MODE, null)) ?: JetxRules.Mode.MANUAL
        set(v) = p.edit().putString(K_MODE, v.wire).apply()

    var layout: JetxRules.Layout
        get() = JetxRules.Layout.from(p.getString(K_LAYOUT, null)) ?: JetxRules.Layout.SPLIT
        set(v) = p.edit().putString(K_LAYOUT, v.wire).apply()

    var split: Float
        get() = JetxRules.clampSplit(p.getFloat(K_SPLIT, JetxRules.SPLIT_DEFAULT))
        set(v) = p.edit().putFloat(K_SPLIT, JetxRules.clampSplit(v)).apply()

    /** The round collector (0.35.0, JetxCollector): on unless the user turned it off. It only reads finished
     *  multipliers from the game, so it is on by default (and the account starts in demo mode). */
    var collector: Boolean
        get() = p.getBoolean(K_COLLECTOR, true)
        set(v) = p.edit().putBoolean(K_COLLECTOR, v).apply()

    /** The site the top pane opens (the user's own edit, or settings.site_url). */
    var site: String?
        get() = JetxRules.siteUrl(p.getString(K_SITE, null))
        set(v) = put(K_SITE, v)

    /** settings.site_url as last fetched from the API, so a change made on the web is noticed (pickSite). */
    var savedSite: String?
        get() = JetxRules.siteUrl(p.getString(K_SAVED, null))
        set(v) = put(K_SAVED, v)

    private fun put(key: String, v: String?) {
        val e = p.edit()
        if (v == null) e.remove(key) else e.putString(key, v)
        e.apply()
    }

    private companion object {
        const val K_MODE = "mode"
        const val K_LAYOUT = "layout"
        const val K_SPLIT = "split"
        const val K_SITE = "site"
        const val K_SAVED = "saved_site"
        const val K_COLLECTOR = "collector"
    }
}
