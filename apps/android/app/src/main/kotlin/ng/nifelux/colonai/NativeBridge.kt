package ng.nifelux.colonai

import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * window.ColonNative for the Colon AI web app (docs/android-bridge.md, "JavaScript bridge").
 *
 * Security: the bridge exists only in pages from UrlRules.BRIDGE_ORIGINS (chat. and browser.apparatus.name.ng),
 * main frame only. On current WebViews this is enforced by WebView itself (addWebMessageListener and
 * addDocumentStartJavaScript take the allowed origins); on very old WebViews the fallback JavascriptInterface
 * checks the page origin on every call and the shell never shows other sites (they open in Colon Browser tabs).
 * Messages are JSON: page -> app {id, cmd, args}; app -> page {id, ok, result | error} or {event, data}.
 */
class NativeBridge(private val host: MainActivity, private val webView: WebView) {
    private val main = Handler(Looper.getMainLooper())
    private var proxy: JavaScriptReplyProxy? = null
    private var legacy = false
    /** True once the current page's shim said "ready"; events wait for it. */
    var pageReady = false
        private set

    fun install() {
        val origins = UrlRules.BRIDGE_ORIGINS
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, CHANNEL, origins) { _, message, sourceOrigin, isMainFrame, reply ->
                if (isMainFrame && sourceOrigin.toString().trimEnd('/') in origins) {
                    proxy = reply
                    message.data?.let { handle(it) { out -> post(out) } }
                }
            }
        } else {
            legacy = true
            webView.addJavascriptInterface(Legacy(), LEGACY)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, shim(), origins)
        }
    }

    /** A new page started: the old page's reply channel is gone. */
    fun onPageStarted() { proxy = null; pageReady = false }

    /** Fallback injection for WebViews without document-start scripts (the shim is idempotent). */
    fun injectIfNeeded(url: String?) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) && UrlRules.isBridgeOrigin(url)) {
            webView.evaluateJavascript(shim(), null)
        }
    }

    /** Sends an event to the page (share, bridge, network, resume). Dropped when no Colon page is listening. */
    fun emit(event: String, data: Any?) {
        if (!pageReady) return
        post(JSONObject().put("event", event).put("data", data ?: JSONObject.NULL).toString())
    }

    private fun post(json: String) {
        val p = proxy
        if (p != null && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            p.postMessage(json); return
        }
        if (legacy && UrlRules.isBridgeOrigin(host.currentUrl)) {
            webView.evaluateJavascript("window.__colonNativeReceive&&window.__colonNativeReceive(" +
                JSONObject.quote(json) + ")", null)
        }
    }

    private inner class Legacy {
        @JavascriptInterface
        fun post(json: String) {
            main.post {
                if (UrlRules.isBridgeOrigin(host.currentUrl)) handle(json) { out -> this@NativeBridge.post(out) }
            }
        }
    }

    private fun handle(raw: String, reply: (String) -> Unit) {
        val msg = try { JSONObject(raw) } catch (_: Exception) { return }
        val id = msg.optString("id").takeIf { it.isNotEmpty() && it.length <= 32 }
        val args = msg.optJSONObject("args") ?: JSONObject()
        val done: (Boolean, Any?, String?) -> Unit = { ok, result, error ->
            if (id != null) {
                val out = JSONObject().put("id", id).put("ok", ok)
                if (ok) out.put("result", result ?: JSONObject.NULL) else out.put("error", error ?: "failed")
                main.post { reply(out.toString()) }
            }
        }
        try {
            dispatch(msg.optString("cmd"), args, done)
        } catch (e: Exception) {
            done(false, null, "failed")
        }
    }

    private fun dispatch(cmd: String, a: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        when (cmd) {
            "ready" -> { pageReady = true; done(true, info(), null); host.onBridgeReady() }
            "info" -> done(true, info(), null)
            "share" -> done(host.shareText(a.optString("title"), a.optString("text"), a.optString("url")), null,
                "no_app")
            "download" -> {
                val name = Downloads.enqueue(host, a.optString("url"), webView.settings.userAgentString,
                    a.optString("name").takeIf { it.isNotBlank() }?.let { "attachment; filename=\"$it\"" },
                    a.optString("mime").ifBlank { null })
                done(name != null, JSONObject().put("name", name), "bad_url")
            }
            "saveFile" -> saveFile(a, done)
            "openTab" -> {
                val url = a.optString("url")
                if (url.isNotEmpty() && !UrlRules.isWebUrl(url)) done(false, null, "bad_url")
                else { host.openBrowserTab(url.ifEmpty { null }); done(true, null, null) }
            }
            "browser" -> browser(a, done)
            "openExternal" -> {
                val url = a.optString("url")
                if (!UrlRules.isWebUrl(url)) done(false, null, "bad_url")
                else { UpdateChecker.openExternal(host, url); done(true, null, null) }
            }
            "haptic" -> {
                webView.performHapticFeedback(when (a.optString("kind")) {
                    "long" -> HapticFeedbackConstants.LONG_PRESS
                    "confirm" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM
                        else HapticFeedbackConstants.VIRTUAL_KEY
                    "reject" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT
                        else HapticFeedbackConstants.LONG_PRESS
                    else -> HapticFeedbackConstants.VIRTUAL_KEY
                })
                done(true, null, null)
            }
            "requestPermission" -> host.requestNamedPermission(a.optString("name")) { granted ->
                done(true, JSONObject().put("granted", granted), null)
            }
            "checkUpdate" -> UpdateChecker.check(host, force = true) { m, err ->
                val r = JSONObject().put("current", BuildConfig.VERSION_NAME)
                    .put("currentCode", BuildConfig.VERSION_CODE)
                if (m != null) r.put("latest", m.versionName).put("available", m.isNewerThan(BuildConfig.VERSION_CODE))
                if (m != null && a.optBoolean("prompt") && m.isNewerThan(BuildConfig.VERSION_CODE)) {
                    UpdateChecker.prompt(host, m)
                }
                if (m == null) done(false, null, err) else done(true, r, null)
            }
            "setTheme" -> { host.applyWebTheme(a.optString("theme")); done(true, null, null) }
            "setSession" -> {
                val bridge = ColonApplication.of(host).bridge
                bridge.setToken(a.optString("token").ifEmpty { null })
                bridge.refreshSession()
                done(true, null, null)
            }
            "bridgeStatus" -> done(true, JSONObject().put("status", ColonApplication.of(host).bridge.status.name
                .lowercase()), null)
            "takeShare" -> done(true, host.takeShare() ?: JSONObject.NULL, null)
            "takeAssist" -> done(true, host.takeAssist(), null)
            // OS Assistant Step 2: phone control, only what PhoneRules allows (docs/os-assistant/step-2.md).
            "phone" -> {
                val bad = PhoneRules.check(a)
                if (bad != null) done(false, null, bad)
                else PhoneActions.run(host, a).let { r ->
                    if (r.error != null) done(false, null, r.error)
                    else done(true, JSONObject().put("say", r.say).apply { r.label?.let { put("label", it) } }, null)
                }
            }
            // OS Assistant Step 3: Colon Music, only what MusicRules allows (docs/os-assistant/step-3.md).
            "music" -> {
                val bad = MusicRules.check(a)
                if (bad != null || BuildConfig.IS_BROWSER_APP) done(false, null, bad ?: "unknown_command")
                else MusicActions.run(host, a, done)
            }
            "vault" -> vault(a, done)
            // 0.20.0: voice mode's state for the pill over other apps (VoiceMode, VoiceUiRules).
            "voice_ui" -> VoiceMode.handle(host, a, done)
            // 0.20.1: the phone's own speech recognizer for voice input (NativeListen, native-listen.js).
            "listen" -> NativeListen.handle(host, a, done)
            "speak" -> NativeSpeak.handle(host, a, done)
            else -> done(false, null, "unknown_command")
        }
    }

    /**
     * The in-chat browser panel (ChatBrowserPanel): {action: open|navigate|layout|collapse|close|back|forward|
     * reload|handoff|state|anchor, url?, layout?, collapsed?, inline?}. Every action answers with the panel's state,
     * except anchor (sent up to once a frame while the thread scrolls), which answers null. inline: true says the
     * page draws the in-thread card, so the "inline" layout may be used (feature "browserInline", v0.9.1).
     * Phase 10 (feature "browserChats"): chat {conversation_id, adopt?} shows that chat's own browser, forget
     * {conversation_id} deletes a deleted chat's browser ({all: true}: every chat's), mode {mode: ai|shared} sets the chat's "AI only" / "AI + me",
     * control {op: take_control|return_to_ai|pause|resume|stop} is the user's control from the chat page.
     */
    private fun browser(a: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        val p = host.browserPanel
        val url = a.optString("url")
        if (url.isNotEmpty() && !UrlRules.isWebUrl(url)) { done(false, null, "bad_url"); return }
        if (a.optBoolean("inline", false)) p.setWebInline()
        when (a.optString("action")) {
            // Only a page that draws the card reports its box: that says it can too (v0.9.2).
            "anchor" -> {
                p.setWebInline(); p.setAnchor(InlineGeometry.anchorOf(a), InlineGeometry.bandOf(a))
                done(true, null, null); return
            }
            // 0.10.3: the chat's Saga tasks on the card ({op: start, id, goal, anchor} · {op: end, id, kind, result})
            // and its finished cards with their pictures.
            "task" -> {
                val id = a.optString("id").takeIf { it.isNotBlank() && it.length <= 40 }
                if (a.optString("op") == "end") {
                    val kind = a.optString("kind").takeIf { it in END_KINDS } ?: "error"
                    p.taskEnded(id, kind, a.optString("result"))
                } else p.taskStarted(id, a.optString("goal"), a.optString("anchor").ifBlank { null })
            }
            "cards" -> { done(true, p.cardsJson(), null); return }
            // 0.11.5: the page for the chat model (summary and numbered clickable items; feature "pageSummary").
            "page" -> { p.pageSummary { r -> done(true, r ?: JSONObject.NULL, null) }; return }
            // 0.11.2: an older card's picture, one at a time; the timeline; the page draws the card's chrome.
            "cardShot" -> { done(true, JSONObject().put("id", a.optString("id")).put("snapshot",
                p.cardShot(a.optString("id").take(40)) ?: JSONObject.NULL), null); return }
            "timeline" -> p.openTimeline()
            "chrome" -> p.setWebChrome(a.optBoolean("on", true))
            // 0.11.0: a web overlay is open over the chat (drawer, menu, sheet, dialog): the inline panel hides.
            "suspend" -> p.setSuspended(a.optBoolean("on", false))
            // 0.11.0: the user set up scheduled browsing from this app: its runs may start without "Let Saga browse?".
            "schedules" -> { ScheduleConsent.set(host, a.optBoolean("allow", false))
                done(true, JSONObject().put("allow", ScheduleConsent.allowed(host)), null); return }
            "open" -> p.open(url.ifEmpty { null }, a.optString("layout").ifEmpty { null })
            "navigate" -> if (url.isEmpty()) { done(false, null, "bad_url"); return } else p.open(url)
            "layout" -> {
                val m = PanelLayout.Mode.from(a.optString("layout")) ?: run { done(false, null, "bad_layout"); return }
                p.setMode(m)
            }
            "collapse" -> p.setCollapsed(a.optBoolean("collapsed", true))
            "close" -> p.close()
            "back" -> p.goBack()
            "forward" -> p.goForward()
            "reload" -> p.reloadPage()
            "handoff" -> { done(true, JSONObject().put("handedOff", p.handoff()), null); return }
            "state" -> Unit
            "chat" -> p.showChat(a.optString("conversation_id").ifBlank { null }, a.optBoolean("adopt", false))
            "forget" -> if (a.optBoolean("all", false)) p.forgetAllChats()
                else p.forgetChat(a.optString("conversation_id").ifBlank { null })
            "mode" -> {
                val m = a.optString("mode")
                if (m != "ai" && m != "shared") { done(false, null, "bad_mode"); return }
                p.setChatMode(m)
            }
            "control" -> if (!p.userControl(a.optString("op"), a.optString("note").ifBlank { null })) {
                done(false, null, "no_change"); return
            }
            else -> { done(false, null, "unknown_action"); return }
        }
        done(true, p.state(), null)
    }

    /**
     * 0.11.0: Colon Secured Login from the chat page: {action: form, site?} opens the native form (FLAG_SECURE) and
     * answers {site, login_saved} only (no user name, masked or not, and never the password); {action: has, site}
     * answers {site, login_saved}; {action: manage} opens Saved logins. The page never sees a stored value.
     */
    private fun vault(a: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        val site = VaultRules.site(a.optString("site"))
        when (a.optString("action")) {
            "form" -> host.openLoginForm(site, null, a.optBoolean("trust", false)) { saved, _ ->
                done(true, JSONObject().put("site", saved ?: site ?: JSONObject.NULL).put("login_saved", saved != null),
                    null)
            }
            "has" -> if (site == null) done(false, null, "bad_site")
                else done(true, JSONObject().put("site", site).put("login_saved", LoginVault(host).has(site)), null)
            "manage" -> { host.startActivity(Intent(host, VaultActivity::class.java)); done(true, null, null) }
            else -> done(false, null, "unknown_action")
        }
    }

    private fun saveFile(a: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        val b64 = a.optString("base64")
        if (b64.isEmpty() || b64.length > MAX_SAVE_B64) { done(false, null, "too_large"); return }
        val name = a.optString("name", "colon-download")
        val mime = a.optString("mime").ifBlank { null }
        Thread {
            try {
                val bytes = Base64.decode(b64.substringAfter("base64,"), Base64.DEFAULT)
                val where = Downloads.saveBytes(host, name, mime, bytes)
                main.post { host.toast(host.getString(R.string.saved_to, where)) }
                done(true, JSONObject().put("path", where), null)
            } catch (e: Exception) {
                done(false, null, "save_failed")
            }
        }.start()
    }

    private fun info(): JSONObject = JSONObject()
        .put("platform", "android")
        .put("version", BuildConfig.VERSION_NAME)
        .put("versionCode", BuildConfig.VERSION_CODE)
        .put("sdk", Build.VERSION.SDK_INT)
        .put("release", Build.VERSION.RELEASE)
        .put("model", "${Build.MANUFACTURER} ${Build.MODEL}".take(60))
        .put("lowRam", host.isLowRam())
        .put("webview", WebViewCompat.getCurrentWebViewPackage(host)?.versionName ?: "")
        .put("bridge", ColonApplication.of(host).bridge.status.name.lowercase())
        .put("online", ColonApplication.of(host).online)
        .put("signedRelease", BuildConfig.RELEASE_SIGNED)
        .put("features", org.json.JSONArray(features()))

    /** FEATURES, plus "speak" (0.20.2), and "listen" when the phone has a speech recognition service. */
    private fun features(): List<String> =
        (FEATURES + "speak").let { if (NativeListen.available(host)) it + "listen" else it }

    private fun shim(): String = SHIM.replace("%INFO%", JSONObject()
        .put("version", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
        .put("features", org.json.JSONArray(features())).toString())

    companion object {
        const val CHANNEL = "ColonNativeChannel"
        const val LEGACY = "ColonNativeLegacy"
        private const val MAX_SAVE_B64 = 34 * 1024 * 1024 // about 25 MB of file
        private val END_KINDS = setOf("done", "error", "stopped")
        val FEATURES = listOf("share", "download", "saveFile", "openTab", "openExternal", "haptic",
            "requestPermission", "checkUpdate", "setTheme", "setSession", "takeShare", "fileInput", "mic", "browserPanel",
            "browserInline", "browserChats", "browserCard",
            // 0.11.0
            "vault", "browserSuspend", "sagaSchedules", "sagaTimeline", "sagaBackground",
            // 0.11.2
            "browserChrome", "cardShot",
            // 0.11.5
            "pageSummary",
            // 0.11.6: browser('control', {op: login_form}) reopens the login form Saga waits on.
            "loginWait",
            // Colon OS Assistant, Step 1: opened as the phone's assistant (event "assist", takeAssist()).
            "assist",
            // OS Assistant Step 2: phone control (ColonNative.call('phone', { action, ... })).
            "phone",
            // OS Assistant Step 3: Colon Music ("play ...", "what song is this?"), Colon AI only.
            "music",
            // 0.20.0: voice mode's state for the floating pill (call('voice_ui', {state, caption, muted}); the pill's
            // End / Mute come back as the event "voice_action" {action: end|mute|unmute}).
            "voice_ui")

        /** Defines window.ColonNative (promise API) on top of the channel. Runs once per page, before page scripts. */
        private val SHIM = """
(function () {
  if (window.ColonNative) return;
  var ch = window.$CHANNEL, legacy = window.$LEGACY;
  if (!ch && !legacy) return;
  var seq = 0, pending = {}, subs = {}, info = %INFO%;
  function receive(raw) {
    var m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.id && pending[m.id]) {
      var p = pending[m.id]; delete pending[m.id]; clearTimeout(p[2]);
      if (m.ok) p[0](m.result); else { var err = new Error(m.error || 'failed'); err.code = m.error; p[1](err); }
      return;
    }
    if (m.event) {
      (subs[m.event] || []).slice().forEach(function (f) { try { f(m.data); } catch (e) {} });
      try { window.dispatchEvent(new CustomEvent('colonnative:' + m.event, { detail: m.data })); } catch (e) {}
    }
  }
  function post(o) { var s = JSON.stringify(o); if (ch) ch.postMessage(s); else legacy.post(s); }
  if (ch) ch.onmessage = function (e) { receive(e.data); };
  else window.__colonNativeReceive = receive;
  function call(cmd, args) {
    return new Promise(function (res, rej) {
      var id = 'n' + (++seq), wait = cmd === 'vault' ? 900000 : cmd === 'requestPermission' || cmd === 'checkUpdate' || cmd === 'music' ? 120000 : 30000;
      pending[id] = [res, rej, setTimeout(function () {
        if (pending[id]) { delete pending[id]; var e = new Error('timeout'); e.code = 'timeout'; rej(e); }
      }, wait)];
      post({ id: id, cmd: cmd, args: args || {} });
    });
  }
  window.ColonNative = Object.freeze({
    platform: 'android', version: info.version, versionCode: info.versionCode, features: info.features,
    call: call,
    on: function (ev, f) { (subs[ev] = subs[ev] || []).push(f);
      return function () { subs[ev] = (subs[ev] || []).filter(function (x) { return x !== f; }); }; },
    info: function () { return call('info'); },
    share: function (o) { return call('share', o); },
    download: function (url, name, mime) { return call('download', { url: url, name: name, mime: mime }); },
    openTab: function (url) { return call('openTab', { url: url || '' }); },
    haptic: function (kind) { return call('haptic', { kind: kind || 'tap' }); },
    requestPermission: function (name) { return call('requestPermission', { name: name }); },
    checkUpdate: function (prompt) { return call('checkUpdate', { prompt: !!prompt }); },
    setTheme: function (t) { return call('setTheme', { theme: t }); },
    setSession: function (o) { return call('setSession', o || {}); },
    takeShare: function () { return call('takeShare'); },
    takeAssist: function () { return call('takeAssist'); },
    vault: function (action, o) { var a = o || {}; a.action = action; return call('vault', a); },
    browser: function (action, o) { var a = o || {}; a.action = action; return call('browser', a); }
  });
  call('ready').then(function () {
    try { window.dispatchEvent(new Event('colonnative:ready')); } catch (e) {}
  }, function () {});
})();
""".trimIndent()
    }
}
