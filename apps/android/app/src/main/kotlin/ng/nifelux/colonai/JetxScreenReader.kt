package ng.nifelux.colonai

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import org.json.JSONObject

/**
 * Colon JetX's screen reader (0.38.0): the fallback round collector for games the page's DOM doesn't expose (a
 * canvas, a closed shadow root, a frame the injected script can't reach). About once a second, while the game pane
 * is on screen and the DOM collector has not found the history strip, it copies the game pane's pixels (PixelCopy
 * from the window on Android 8+, View.draw before), reads them with on-device OCR (JetxOcr) and, with
 * JetxOcrRules, finds the history strip band, then reads only that band. Only the multiplier and the time leave the
 * phone; the bitmap is recycled at once and never stored or uploaded.
 * 0.39.1 (it read 7 chips on the phone and never sent a round): reads are lined up with JetxSeqRules (tolerant of
 * one misread and the half-visible end chip, either direction); the first stable read, and any read that no longer
 * lines up, sends the visible strip minus what is already stored ([stored], GET /crash/live) as history; each
 * confirmed shift sends the new value(s). The strip found is kept across short losses, a stuck capture is let go
 * after [STUCK_MS], and the status adds the state, rounds handed on ([sent]) and the last error. [snapshot] lends
 * the OCR to the pointer (JetxPointerTaps), which also hands an opened history grid back through [offerHistory].
 */
class JetxScreenReader(
    private val activity: Activity,
    private val view: () -> View?,
    private val active: () -> Boolean,
    private val onRounds: (List<Double>) -> Unit,
    private val onStatus: () -> Unit,
    private val stored: ((List<Double>?) -> Unit) -> Unit,
    private val exclude: () -> List<RectF> = { emptyList() },
) {
    /** One full capture's OCR words; [scale] = capture px per pane px. */
    class Snap(val tokens: List<JetxOcrRules.Token>, val scale: Float, val width: Int, val height: Int)

    private val main = Handler(Looper.getMainLooper())
    private var running = false
    private var busy = false
    private var busySince = 0L
    private var strip: JetxOcrRules.Strip? = null
    private var misses = 0
    private var lastRaw: List<Double>? = null
    private var prev: List<Double>? = null
    private var dir = JetxSeqRules.Dir.UNKNOWN
    private var needCatchUp = true
    private var catching = false
    private var state = "idle"
    /** True while the pointer works the game (its own captures only). */
    var hold = false
    var lastChips = 0
        private set
    var lastReadAt = 0L
        private set
    /** The last stable read, newest first, and when; for the left column. */
    var live: List<Double>? = null
        private set
    var liveAt = 0L
        private set
    var sent = 0
        private set
    var error: String? = null
        private set
    /** The strip's bottom as a share of the pane, and its chip height in pane px, once found. */
    val stripBottom: Float? get() = strip?.bottom
    var chipPx = 0f
        private set
    private val tick = Runnable { step() }

    fun start() {
        if (running) return
        running = true
        main.postDelayed(tick, PERIOD_MS)
    }

    fun stop() {
        running = false
        main.removeCallbacks(tick)
    }

    /** { on, state, last_chips, strip_found, sent, error, dir } for the collector event. */
    fun status(): JSONObject = JSONObject().put("on", running && JetxOcr.available).put("state",
        if (!JetxOcr.available) "unavailable" else state).put("last_chips", lastChips).put("strip_found", strip != null)
        .put("sent", sent).put("error", error ?: JSONObject.NULL).put("dir", dir.name.lowercase())

    private fun step() {
        if (!running) return
        main.postDelayed(tick, PERIOD_MS)
        val now = System.currentTimeMillis()
        if (busy && now - busySince > STUCK_MS) { busy = false; error = "capture_stuck" }
        if (busy || hold) return
        if (!JetxOcr.available) { setState("unavailable"); return }
        val v = view()
        if (!active() || v == null || !v.isShown || v.width < 50 || v.height < 50) { setState("paused"); return }
        val s = strip
        val top = if (s == null) 0 else (s.top * v.height).toInt()
        val bottom = if (s == null) v.height else maxOf(top + 8, (s.bottom * v.height).toInt())
        ocr(v, top, bottom) { tokens, h, scale ->
            if (tokens == null) { setState("unavailable"); error = "ocr_failed"; return@ocr }
            if (s == null) located(tokens, h, scale) else readBand(tokens)
        }
    }

    /** Captures rows [top, bottom) of [v] and reads them: (words, capture height, scale) or null words. */
    private fun ocr(v: View, top: Int, bottom: Int, done: (List<JetxOcrRules.Token>?, Int, Float) -> Unit) {
        busy = true
        busySince = System.currentTimeMillis()
        val scale = minOf(1f, MAX_WIDTH.toFloat() / v.width)
        capture(v, top, bottom, scale) { bmp ->
            if (bmp == null) { busy = false; done(null, 0, scale); return@capture }
            val h = bmp.height
            val skip = exclude()
            JetxOcr.recognize(bmp) { tokens ->
                bmp.recycle()
                busy = false
                // Colon's own overlays (the column, the bubble) are in the pixels too: their words are dropped.
                done(tokens?.filterNot { t -> skip.any { r -> r.contains((t.left + t.right) / 2f / scale,
                    (t.top + t.bottom) / 2f / scale + top) } }, h, scale)
            }
        }
    }

    /** The pointer's look at the whole game pane (works while [hold]); null when it can't be read. */
    fun snapshot(tries: Int = 8, done: (Snap?) -> Unit) {
        val v = view()
        if (busy && tries > 0) { main.postDelayed({ snapshot(tries - 1, done) }, 200L); return }
        if (!JetxOcr.available || busy || v == null || !v.isShown || v.width < 50) { done(null); return }
        ocr(v, 0, v.height) { tokens, h, scale ->
            done(tokens?.let { Snap(it, scale, (v.width * scale).toInt(), h) })
        }
    }

    private fun located(tokens: List<JetxOcrRules.Token>, height: Int, scale: Float) {
        val found = JetxOcrRules.locate(tokens, height)
        if (found == null) { lastChips = 0; setState("locating"); return }
        strip = found
        chipPx = (found.bottom - found.top) * height / 2f / scale
        misses = 0
        lastChips = found.values.size
        lastReadAt = System.currentTimeMillis()
        lastRaw = found.values // the next band read confirms it; prev (the last stable read) is kept
        setState("reading")
    }

    private fun readBand(tokens: List<JetxOcrRules.Token>) {
        val cur = JetxOcrRules.read(tokens)
        if (cur == null) {
            if (++misses >= MAX_MISSES) { strip = null; lastRaw = null; setState("locating") }
            return
        }
        misses = 0
        lastChips = cur.size
        lastReadAt = System.currentTimeMillis()
        val ok = JetxSeqRules.stable(lastRaw, cur, dir)
        lastRaw = cur
        if (!ok) return
        live = JetxSeqRules.newestFirst(cur, dir)
        liveAt = lastReadAt
        setState("reading")
        val p = prev
        if (p == null || needCatchUp) { prev = cur; catchUp(live!!); return }
        val st = JetxSeqRules.step(p, cur, dir)
        prev = cur
        if (st.resync) { needCatchUp = true; catchUp(live!!); return }
        dir = st.dir
        hand(st.added)
    }

    /** The visible strip (newest first) minus what the API already has, sent oldest first. */
    private fun catchUp(newestFirst: List<Double>) {
        if (catching) return
        catching = true
        stored { list ->
            catching = false
            if (list == null) { error = "stored_unknown"; needCatchUp = true; onStatus(); return@stored }
            needCatchUp = false
            hand(JetxSeqRules.catchUp(newestFirst, list))
        }
    }

    /** The opened history grid (newest first, from the pointer): sent like a catch-up. */
    fun offerHistory(newestFirst: List<Double>) = catchUp(newestFirst)

    private fun hand(values: List<Double>) {
        if (values.isEmpty()) { onStatus(); return }
        sent += values.size
        error = null
        onRounds(values)
        onStatus()
    }

    private fun setState(s: String) {
        if (s == state) return
        state = s
        onStatus()
    }

    /** The pane's rows [top, bottom) as a bitmap scaled by [scale], or null. */
    private fun capture(v: View, top: Int, bottom: Int, scale: Float, done: (Bitmap?) -> Unit) {
        val w = maxOf(1, (v.width * scale).toInt())
        val h = maxOf(1, ((bottom - top) * scale).toInt())
        val bmp = try { Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888) } catch (_: Throwable) { done(null); return }
        val loc = IntArray(2).also { v.getLocationInWindow(it) }
        val src = Rect(loc[0], loc[1] + top, loc[0] + v.width, loc[1] + bottom)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                PixelCopy.request(activity.window, src, bmp, { code ->
                    if (code == PixelCopy.SUCCESS) done(bmp) else { bmp.recycle(); done(null) }
                }, main)
            } catch (_: Exception) {
                bmp.recycle(); done(null)
            }
        } else {
            try {
                val c = Canvas(bmp)
                c.scale(scale, scale)
                c.translate(0f, -top.toFloat())
                v.draw(c)
                done(bmp)
            } catch (_: Exception) {
                bmp.recycle(); done(null)
            }
        }
    }

    private companion object {
        const val PERIOD_MS = 1_000L
        const val MAX_WIDTH = 1080
        const val MAX_MISSES = 5
        const val STUCK_MS = 6_000L
    }
}
