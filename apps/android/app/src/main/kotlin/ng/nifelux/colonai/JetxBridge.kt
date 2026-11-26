package ng.nifelux.colonai

import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * window.ColonJetX: the stub bridge between Colon JetX's two panes (0.34.0, Crash Predictor step 2).
 *
 * Only the predictor pane gets it, and only on https://crash.apparatus.name.ng, main frame (WebView enforces the
 * origin: addWebMessageListener and addDocumentStartJavaScript take it). On WebViews without those features there
 * is no bridge at all (no JavascriptInterface fallback): the predictor still works as a plain web app.
 * Shim: assets/jetx/bridge.js. Messages are JSON: page -> app {id, cmd, args}; app -> page {id, ok, result | error}
 * or {event, data}.
 *
 * Commands (JetxRules.COMMANDS): ready and status -> the status (mode, layout, the betting site's host and state,
 * the collector); openSite {url?} -> opens that site (or the saved one) in the game pane; setLayout {layout};
 * setCollector {on} (0.35.0) -> the collector's status.
 * Events: session {status, host}, mode {mode}, layout {layout}, collector {on, status, rounds_today,
 * last_multiplier} (0.35.0; 0.35.1 adds frames_seen, strip_found, strip_items, rounds_sent, last_error; 0.35.2
 * mult_texts, canvases, shadow_hosts, closed_hint and sample, up to 3 strings of [0-9.,xX× ] only).
 * 0.38.0: commands setRealMoney {on} (on: the app shows its own warning; answers { real_money } once the user chose),
 * stopAutobet (the kill switch) and resumeAutobet, both answering the auto-bet status; event autobet {mode,
 * real_money, stopped, frames, line}; status gains autobet, and the layout may be side.
 * The only game data the predictor gets is the collector's counts and last multiplier (JetxCollector); never the
 * betting site's cookies, passwords or tokens.
 */
class JetxBridge(private val host: Host, private val webView: WebView?) {
    interface Host {
        fun bridgeStatus(): JSONObject
        /** Opens [url] (already cleaned) or, when null, the saved site. Returns the opened URL or null (none). */
        fun bridgeOpenSite(url: String?): String?
        fun bridgeSetLayout(layout: JetxRules.Layout)
        /** Turns the round collector on or off (0.35.0); returns its status. */
        fun bridgeSetCollector(on: Boolean): JSONObject
        /** The app's real-money switch (0.38.0): [done] gets the new state after the warning (or at once for off). */
        fun bridgeSetRealMoney(on: Boolean, done: (Boolean) -> Unit)
        /** The kill switch (0.38.0) on or lifted on this phone; returns the auto-bet status. */
        fun bridgeStopAutobet(stop: Boolean): JSONObject
    }

    private var proxy: JavaScriptReplyProxy? = null
    private var ready = false
    var installed = false
        private set

    fun install(shim: String?) {
        val origins = setOf(JetxRules.PREDICTOR_ORIGIN)
        val webView = webView ?: return
        if (shim == null || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        try {
            WebViewCompat.addWebMessageListener(webView, CHANNEL, origins) { _, message, origin, mainFrame, reply ->
                if (mainFrame && JetxRules.isPredictor(origin.toString())) {
                    proxy = reply
                    message.data?.let { handle(it) }
                }
            }
            WebViewCompat.addDocumentStartJavaScript(webView, shim, origins)
            installed = true
        } catch (e: Exception) {
            Log.w("ColonJetX", "bridge unavailable", e)
        }
    }

    /** A new page started in the predictor pane: the old page's reply channel is gone. */
    fun onPageStarted() { proxy = null; ready = false }

    /** Sends an event to the predictor; dropped until its page said "ready". */
    fun emit(event: String, data: JSONObject) {
        if (!ready) return
        post(JSONObject().put("event", event).put("data", data))
    }

    private fun handle(raw: String) {
        val msg = try { JSONObject(raw) } catch (_: Exception) { return }
        val id = msg.opt("id") ?: JSONObject.NULL
        val cmd = msg.optString("cmd")
        val args = msg.optJSONObject("args") ?: JSONObject()
        if (cmd !in JetxRules.COMMANDS) { reply(id, null, "unknown_command"); return }
        when (cmd) {
            "ready" -> { ready = true; reply(id, host.bridgeStatus(), null) }
            "status" -> reply(id, host.bridgeStatus(), null)
            "openSite" -> {
                val asked = args.optString("url").takeIf { it.isNotBlank() }
                val clean = asked?.let { JetxRules.siteUrl(it) }
                if (asked != null && clean == null) { reply(id, null, "bad_url"); return }
                val opened = host.bridgeOpenSite(clean)
                if (opened == null) reply(id, null, "no_site")
                else reply(id, JSONObject().put("opened", true).put("host", JetxRules.hostOf(opened)), null)
            }
            "setLayout" -> {
                val l = JetxRules.Layout.from(args.optString("layout"))
                if (l == null) reply(id, null, "bad_layout")
                else { host.bridgeSetLayout(l); reply(id, JSONObject().put("layout", l.wire), null) }
            }
            "setCollector" -> {
                val on = args.opt("on")
                if (on !is Boolean) reply(id, null, "bad_value") else reply(id, host.bridgeSetCollector(on), null)
            }
            "setRealMoney" -> {
                val on = args.opt("on")
                if (on !is Boolean) reply(id, null, "bad_value")
                else host.bridgeSetRealMoney(on) { now -> reply(id, JSONObject().put("real_money", now), null) }
            }
            "stopAutobet" -> reply(id, host.bridgeStopAutobet(true), null)
            "resumeAutobet" -> reply(id, host.bridgeStopAutobet(false), null)
        }
    }

    private fun reply(id: Any, result: JSONObject?, error: String?) {
        val out = JSONObject().put("id", id).put("ok", error == null)
        if (error == null) out.put("result", result ?: JSONObject.NULL) else out.put("error", error)
        post(out)
    }

    private fun post(json: JSONObject) {
        val p = proxy ?: return
        try { p.postMessage(json.toString()) } catch (e: Exception) { Log.w("ColonJetX", "post failed", e) }
    }

    companion object {
        /** The object WebView puts in the predictor page; the shim wraps it as window.ColonJetX. */
        const val CHANNEL = "ColonJetXNative"
        const val SHIM_ASSET = "jetx/bridge.js"
    }
}
