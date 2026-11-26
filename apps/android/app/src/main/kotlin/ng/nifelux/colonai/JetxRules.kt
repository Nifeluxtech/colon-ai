package ng.nifelux.colonai

import org.json.JSONObject
import java.net.URI

/**
 * Colon JetX (0.34.0, Crash Predictor step 2, docs/crash-predictor/HANDOFF.md): the pure rules behind the split
 * screen (JetxActivity). No Android types, unit-tested in JetxRulesTest.
 *
 * Top pane: the user's own betting site, where the user signs in themselves. Bottom pane: the predictor web app.
 * Nothing here reads the betting site's pages, cookies, passwords or tokens; the predictor only ever learns the
 * site's host and whether it loaded (JetxBridge).
 */
object JetxRules {
    /** The predictor web app (apps/crash) and the only origin that gets window.ColonJetX. */
    const val PREDICTOR_ORIGIN = "https://crash.apparatus.name.ng"
    const val PREDICTOR_URL = "$PREDICTOR_ORIGIN/"

    /** Who plays the game. Step 2: only Manual acts; AI and Shared are remembered and announced (banner), and
     *  nothing is ever clicked for the user until the auto-bet step (5) and its guardrails exist. */
    enum class Mode(val wire: String) {
        MANUAL("manual"), AI("ai"), SHARED("shared");

        companion object {
            fun from(s: String?): Mode? = entries.firstOrNull { it.wire == s?.trim()?.lowercase() }
        }
    }

    /** Which panes show: both (split, one above the other), both side by side (0.37.0: game left, the Colon panel
     *  right), the game alone (full screen, with the bubble) or the predictor alone. Switching never reloads a pane. */
    enum class Layout(val wire: String) {
        SPLIT("split"), SIDE("side"), GAME("game"), PREDICTOR("predictor");

        companion object {
            fun from(s: String?): Layout? = entries.firstOrNull { it.wire == s?.trim()?.lowercase() }
        }
    }

    /** The betting site pane's state, as the status dot and the predictor see it. Never says more than this. */
    enum class Site(val wire: String) {
        NONE("none"), LOADING("loading"), LOADED("loaded"), ERROR("error"), OFFLINE("offline");
    }

    /** The game pane's share of the height in split view: the divider stops short of either edge. */
    const val SPLIT_MIN = 0.2f
    const val SPLIT_MAX = 0.8f
    const val SPLIT_DEFAULT = 0.55f
    /** Side by side (0.37.0): the game takes 62% of the width, the Colon panel the rest. */
    const val SIDE_DEFAULT = 0.62f
    /** The bubble's default spot over the full-screen game (shares of the pane): the left edge, a little above the
     *  middle, clear of the bet panel at the bottom and the history strip at the top. */
    const val BUBBLE_X = 0.02f
    const val BUBBLE_Y = 0.42f

    /** The bubble's spot as shares of the pane: the saved one, kept inside the pane, or the default. */
    fun bubbleSpot(x: Float, y: Float): Pair<Float, Float> =
        if (x !in 0f..1f || y !in 0f..1f) BUBBLE_X to BUBBLE_Y else x to y

    /** The full-screen bubble shows only when the game is alone on screen (the Colon panel hidden). */
    fun showsBubble(layout: Layout): Boolean = layout == Layout.GAME

    /** The game is on screen (so the screen reader may read it) in every layout but the predictor alone. */
    fun gameVisible(layout: Layout): Boolean = layout != Layout.PREDICTOR

    fun clampSplit(f: Float): Float = if (f.isNaN()) SPLIT_DEFAULT else f.coerceIn(SPLIT_MIN, SPLIT_MAX)

    /** The divider at [y] px down a [total] px tall area of both panes -> the game pane's share. */
    fun splitAt(y: Float, total: Float): Float = if (total <= 0f) SPLIT_DEFAULT else clampSplit(y / total)

    /** The layout button: split -> side by side -> game full -> predictor full -> split. */
    fun nextLayout(l: Layout): Layout = when (l) {
        Layout.SPLIT -> Layout.SIDE
        Layout.SIDE -> Layout.GAME
        Layout.GAME -> Layout.PREDICTOR
        Layout.PREDICTOR -> Layout.SPLIT
    }

    /**
     * The betting site's address, cleaned the way the API cleans settings.site_url (modules/crash/settings.js):
     * http(s) only, a dotted host, at most 500 characters, "https://" added when no scheme was typed, and never a
     * login inside the address. Null when it isn't a usable web address.
     */
    fun siteUrl(input: String?): String? {
        val s = input?.trim().orEmpty()
        if (s.isEmpty() || s.length > 500 || s.any { it.isWhitespace() }) return null
        val withScheme = if (Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:").containsMatchIn(s) &&
            !Regex("^[a-zA-Z0-9.-]+:\\d+").containsMatchIn(s)) s else "https://$s"
        val u = try { URI(withScheme) } catch (_: Exception) { return null }
        val scheme = u.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = u.host?.lowercase() ?: return null
        if ('.' !in host || host.startsWith('.') || host.endsWith('.')) return null
        if (u.rawUserInfo != null) return null
        return withScheme
    }

    /** True only for the predictor's own origin (https, exact host, default port). */
    fun isPredictor(url: String?): Boolean = UrlRules.originOf(url) == PREDICTOR_ORIGIN

    /** The predictor pane keeps Colon's own pages (the app, its account screens, the API); other links go to the
     *  game pane (web pages) or another app. */
    fun predictorKeeps(url: String?): Boolean = isPredictor(url) || UrlRules.isShellUrl(url)

    /** What the predictor may learn about the betting site: its host only (a path or query can carry a token). */
    fun hostOf(url: String?): String? = UrlRules.originOf(url)?.substringAfter("://")

    /** settings.site_url from GET /crash/settings ({ settings: { site_url } }), cleaned; null when absent or bad. */
    fun siteFromSettings(json: String?): String? = try {
        val s = JSONObject(json ?: return null).optJSONObject("settings") ?: return null
        if (s.isNull("site_url")) null else siteUrl(s.optString("site_url"))
    } catch (_: Exception) {
        null
    }

    /**
     * Which site the top pane opens. The user's own edit on this phone wins until the site saved in settings
     * changes (they changed it on the web or in the predictor), then the new saved site is used.
     * [local]: the site in use on this phone; [lastSaved]: settings.site_url when last fetched; [saved]: now.
     */
    fun pickSite(local: String?, lastSaved: String?, saved: String?): String? = when {
        saved != null && saved != lastSaved -> saved
        local != null -> local
        else -> saved
    }

    /** The banner text key for a mode: none in Manual. */
    fun bannerFor(mode: Mode): String? = when (mode) {
        Mode.MANUAL -> null
        Mode.AI -> "ai"
        Mode.SHARED -> "shared"
    }

    /** Commands the predictor may send over window.ColonJetX (JetxBridge). Anything else is refused.
     *  setCollector {on} (0.35.0) turns the round collector on or off. 0.37.0: setRealMoney {on} (on shows the
     *  app's own warning first), stopAutobet (the kill switch) and resumeAutobet. Nothing here clicks the game. */
    val COMMANDS: Set<String> = setOf("ready", "status", "openSite", "setLayout", "setCollector", "setRealMoney",
        "stopAutobet", "resumeAutobet")

    /** The status the predictor reads: app, version, mode, layout and the site's host and state. */
    fun status(version: String, mode: Mode, layout: Layout, site: Site, siteUrl: String?): JSONObject =
        JSONObject()
            .put("app", "colonjetx")
            .put("version", version)
            .put("mode", mode.wire)
            .put("layout", layout.wire)
            .put("session", session(site, siteUrl))
            .put("autoClick", false) // 0.37.0: JetxActivity sets it from the auto-bet's state (bridgeStatus)

    fun session(site: Site, siteUrl: String?): JSONObject =
        JSONObject().put("status", site.wire).put("host", hostOf(siteUrl) ?: JSONObject.NULL)
}
