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

    /** Runs one tools.js command on [wv]; [done] gets the parsed result, or null when the page returned nothing. */
    fun exec(wv: WebView, cmd: String, args: JSONObject, done: (JSONObject?) -> Unit) {
        val js = "($script)(${JSONObject.quote(cmd)},$args,$act)"
        try { wv.evaluateJavascript(js) { raw -> done(decode(raw)) } } catch (_: Exception) { done(null) }
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
    val KINDS = listOf("payment", "purchase", "send_message", "form_submission", "personal_data")
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
