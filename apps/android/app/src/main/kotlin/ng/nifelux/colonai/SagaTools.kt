package ng.nifelux.colonai

import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Saga's page tools (Phase 9): runs assets/saga/tools.js on a tab's WebView with evaluateJavascript (read the page,
 * list links, inspect / click / fill an element, scroll) and takes a small screenshot natively. The script is
 * evaluated fresh for every command and returns a JSON string; nothing stays on the page's window.
 * Used only by BrowserSaga, only while Saga has AI or Shared control, never on private tabs.
 */
class SagaTools(private val a: BrowserHost) {
    private val script: String by lazy {
        a.activity.assets.open("saga/tools.js").bufferedReader().use { it.readText() }
    }
    /** 0.10.2: typing and scrolling (act.js), handed to tools.js as its third argument. */
    private val act: String by lazy {
        a.activity.assets.open("saga/act.js").bufferedReader().use { it.readText() }
    }

    /** 0.11.2: the pop-up finder (overlay.js), handed to tools.js as its fourth argument. */
    private val overlay: String by lazy {
        a.activity.assets.open("saga/overlay.js").bufferedReader().use { it.readText() }
    }

    /** Runs one tools.js command on [wv]; [done] gets the parsed result, or null when the page returned nothing. */
    fun exec(wv: WebView, cmd: String, args: JSONObject, done: (JSONObject?) -> Unit) {
        val js = "($script)(${JSONObject.quote(cmd)},$args,$act,$overlay)"
        try { wv.evaluateJavascript(js) { raw -> done(decode(raw)) } } catch (_: Exception) { done(null) }
    }

    /** 0.11.0: runs a standalone page script from assets/saga ([name].js: extract, login) with [args]. The script is
     *  one function expression returning a JSON string, evaluated fresh every time, like tools.js. */
    fun run(wv: WebView, name: String, args: JSONObject, done: (JSONObject?) -> Unit) {
        val src = scripts.getOrPut(name) { a.activity.assets.open("saga/$name.js").bufferedReader().use { it.readText() } }
        try { wv.evaluateJavascript("($src)($args)") { raw -> done(decode(raw)) } } catch (_: Exception) { done(null) }
    }
    private val scripts = HashMap<String, String>()
    private fun asset(path: String): String =
        scripts.getOrPut(path) { a.activity.assets.open(path).bufferedReader().use { it.readText() } }

    /**
     * 0.11.5: the page for the chat model (summary.js with the vendored Mozilla Readability and Turndown, all in one
     * function scope so nothing stays on window): {url, title, summary (Markdown, at most ~1,500 characters), items}.
     */
    fun read(wv: WebView, done: (JSONObject?) -> Unit) {
        val js = try {
            "(function(){\n${asset("saga/vendor/readability/Readability.js")}\n" +
                "${asset("saga/vendor/turndown/turndown.js")}\n" +
                "return (${asset("saga/summary.js")})(Readability, TurndownService, {max: 1500});\n})()"
        } catch (_: Exception) { done(null); return }
        try { wv.evaluateJavascript(js) { raw -> done(decode(raw)) } } catch (_: Exception) { done(null) }
    }

    /** Consent-O-Matic's rules (vendor/consent-o-matic/rules.json): name -> rule, parsed once. */
    private val consentRules: JSONObject by lazy {
        try { JSONObject(asset("saga/vendor/consent-o-matic/rules.json")).optJSONObject("rules") ?: JSONObject() }
        catch (_: Exception) { JSONObject() }
    }
    /** The same rules with their detectors only (the first pass on every page is small). */
    private val consentDetectors: String by lazy {
        val out = JSONObject()
        consentRules.keys().forEach { k ->
            consentRules.optJSONObject(k)?.let { out.put(k, JSONObject().put("detectors", it.opt("detectors"))) }
        }
        out.toString()
    }

    /**
     * 0.11.5: clears a known cookie banner before Saga reads the page, rejecting everything (consent.js running
     * Consent-O-Matic's rules), with no model call. [done] gets {cleared: true, cmp} when one was cleared, else null
     * (the 0.11.2 pop-up handling, Saga's "Reject all", stays the fallback). A rule that waits for the page is resumed
     * after the delay it asks for, at most [MAX_CONSENT_ROUNDS] times.
     */
    fun clearConsent(wv: WebView, done: (JSONObject?) -> Unit) {
        val src = try { asset("saga/consent.js") } catch (_: Exception) { done(null); return }
        fun pass(rules: String, resume: JSONObject, round: Int) {
            try {
                wv.evaluateJavascript("($src)($rules,$resume)") { raw ->
                    val r = decode(raw)
                    val cmp = r?.optString("cmp").orEmpty()
                    when {
                        r == null -> done(null)
                        r.optString("state") == "found" && round == 0 && cmp.isNotEmpty() -> {
                            val rule = consentRules.optJSONObject(cmp)
                            if (rule == null) done(null)
                            else pass(JSONObject().put(cmp, rule).toString(), JSONObject().put("cmp", cmp), 1)
                        }
                        r.optString("state") == "wait" && round < MAX_CONSENT_ROUNDS -> {
                            val resume = r.optJSONObject("resume") ?: JSONObject()
                            val name = resume.optString("cmp")
                            val rule = consentRules.optJSONObject(name)
                            if (rule == null) done(null)
                            else wv.postDelayed({ pass(JSONObject().put(name, rule).toString(), resume, round + 1) },
                                r.optLong("ms", 200L).coerceIn(50L, 1000L))
                        }
                        r.optBoolean("cleared") -> done(JSONObject().put("cleared", true).put("cmp", cmp.take(40)))
                        else -> done(null)
                    }
                }
            } catch (_: Exception) { done(null) }
        }
        pass(consentDetectors, JSONObject(), 0)
    }

    /** A JPEG of the visible page, at most 480 px wide and ~40 KB (the bridge's frames are limited to 64 KB). */
    fun screenshot(wv: WebView): JSONObject? {
        if (wv.width <= 0 || wv.height <= 0) return null
        val scale = minOf(1f, MAX_WIDTH / wv.width)
        val w = (wv.width * scale).toInt().coerceAtLeast(1)
        val h = (wv.height * scale).toInt().coerceAtLeast(1)
        return try {
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565)
            val c = Canvas(bmp)
            c.scale(scale, scale)
            c.translate(-wv.scrollX.toFloat(), -wv.scrollY.toFloat())
            wv.draw(c)
            var bytes = ByteArray(0)
            for (q in intArrayOf(60, 45, 30, 20)) {
                val out = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.JPEG, q, out)
                bytes = out.toByteArray()
                if (bytes.size <= MAX_BYTES) break
            }
            bmp.recycle()
            if (bytes.size > MAX_BYTES) null
            else JSONObject().put("mime", "image/jpeg").put("width", w).put("height", h)
                .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (_: Throwable) { null } // OutOfMemoryError on very small phones: no screenshot rather than a crash
    }

    companion object {
        private const val MAX_WIDTH = 480f
        private const val MAX_BYTES = 40_000
        /** 0.11.5: consent.js runs (one per click or wait) before a banner counts as not cleared: ~4 s at most. */
        private const val MAX_CONSENT_ROUNDS = 20

        /** evaluateJavascript hands back the JSON encoding of the returned value: a JSON string to unwrap. */
        fun decode(raw: String?): JSONObject? = try {
            if (raw == null || raw == "null") null else JSONObject(JSONArray("[$raw]").getString(0))
        } catch (_: Exception) { null }
    }
}

/**
 * When Saga must wait for the user's tap (pure, unit-tested in SagaApprovalTest). The server can add an approval
 * (command args.approval.kind), never remove one: there is no "approved" argument, and the phone's own check of the
 * real element (tools.js `inspect`) always counts. In Shared mode every step that changes the page asks first.
 */
object SagaApproval {
    /** 0.11.0: "delete" (delete, remove, cancel an order…) asks too, as on the server (policy.js). */
    val KINDS = listOf("payment", "purchase", "delete", "send_message", "form_submission", "personal_data")
    /** Commands that only read; everything else changes the page or the tabs. */
    val READ_ONLY = setOf("get_page_content", "get_links", "get_tabs", "get_page_state", "screenshot")

    /** The kind the server asked for, when it is one we know. */
    fun serverKind(args: JSONObject): String? =
        args.optJSONObject("approval")?.optString("kind")?.takeIf { it in KINDS }

    /** The stronger of the server's and the phone's decision; "shared" for any other changing step in Shared mode. */
    fun decide(server: String?, phone: String?, mode: ControlState.Mode, command: String): String? {
        val known = listOfNotNull(server, phone).filter { it in KINDS }.minByOrNull { KINDS.indexOf(it) }
        return known ?: if (mode == ControlState.Mode.SHARED && command !in READ_ONLY) "shared" else null
    }
}
