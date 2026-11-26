package ng.nifelux.colonai

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import org.json.JSONObject

/**
 * Colon JetX's screen reader (0.37.0): the fallback round collector for games the page's DOM doesn't expose (a
 * canvas, a closed shadow root, a frame the injected script can't reach). About once a second, while the game pane
 * is on screen and the DOM collector has not found the history strip, it copies the game pane's pixels (PixelCopy
 * from the window on Android 8+, View.draw before), reads them with on-device OCR (JetxOcr) and, with
 * JetxOcrRules, finds the history strip band, then reads only that band. Each confirmed new leftmost value is a new
 * round, handed to [onRounds] (JetxCollector sends it like any collected round, source collector). Only the
 * multiplier and the time leave the phone; the bitmap is recycled at once and never stored or uploaded.
 */
class JetxScreenReader(
    private val activity: Activity,
    private val view: () -> View?,
    private val active: () -> Boolean,
    private val onRounds: (List<Double>) -> Unit,
    private val onStatus: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var running = false
    private var busy = false
    private var strip: JetxOcrRules.Strip? = null
    private var misses = 0
    private var lastRaw: List<Double>? = null
    private var prev: List<Double>? = null
    private var lastChips = 0
    private var state = "idle"
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

    /** { on, state: idle|locating|reading|paused|unavailable, last_chips, strip_found } for the collector event. */
    fun status(): JSONObject = JSONObject().put("on", running && JetxOcr.available).put("state",
        if (!JetxOcr.available) "unavailable" else state).put("last_chips", lastChips).put("strip_found", strip != null)

    private fun step() {
        if (!running) return
        main.postDelayed(tick, PERIOD_MS)
        if (busy) return
        if (!JetxOcr.available) { setState("unavailable"); return }
        val v = view()
        if (!active() || v == null || !v.isShown || v.width < 50 || v.height < 50) { setState("paused"); return }
        val s = strip
        val top = if (s == null) 0 else (s.top * v.height).toInt()
        val bottom = if (s == null) v.height else maxOf(top + 8, (s.bottom * v.height).toInt())
        busy = true
        capture(v, top, bottom) { bmp ->
            if (bmp == null) { busy = false; setState("unavailable"); return@capture }
            val h = bmp.height
            JetxOcr.recognize(bmp) { tokens ->
                bmp.recycle()
                busy = false
                if (tokens == null) { setState("unavailable"); return@recognize }
                if (s == null) located(tokens, h) else readBand(tokens)
            }
        }
    }

    private fun located(tokens: List<JetxOcrRules.Token>, height: Int) {
        val found = JetxOcrRules.locate(tokens, height)
        if (found == null) { lastChips = 0; setState("locating"); return }
        strip = found
        misses = 0
        lastChips = found.values.size
        lastRaw = found.values
        prev = null
        setState("reading")
    }

    private fun readBand(tokens: List<JetxOcrRules.Token>) {
        val cur = JetxOcrRules.read(tokens)
        if (cur == null) {
            if (++misses >= MAX_MISSES) { strip = null; prev = null; lastRaw = null; setState("locating") }
            return
        }
        misses = 0
        lastChips = cur.size
        val ok = JetxOcrRules.confirmed(lastRaw, cur)
        lastRaw = cur
        if (!ok) return
        val shift = JetxOcrRules.shift(prev, cur)
        prev = cur
        if (shift.added.isNotEmpty()) onRounds(shift.added)
        setState("reading")
    }

    private fun setState(s: String) {
        if (s == state) return
        state = s
        onStatus()
    }

    /** The pane's rows [top, bottom) as a bitmap at most MAX_WIDTH wide, or null. */
    private fun capture(v: View, top: Int, bottom: Int, done: (Bitmap?) -> Unit) {
        val scale = minOf(1f, MAX_WIDTH.toFloat() / v.width)
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
    }
}
