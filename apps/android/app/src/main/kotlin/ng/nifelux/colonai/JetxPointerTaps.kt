package ng.nifelux.colonai

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.webkit.WebView
import android.widget.FrameLayout

/**
 * Colon JetX's pointer (0.39.1): Colon's own animated pointer (SagaPointer, the Colon browser's arrow with the two
 * cyan dots) taps the game where its controls are pixels. Targets come from the screen reader's OCR of the game pane
 * (JetxScreenReader.snapshot, JetxPointerRules); each tap is a MotionEvent DOWN/UP dispatched to this app's own game
 * WebView, nothing else (no accessibility service, nothing outside the app). One flow at a time; the screen reader's
 * own loop rests meanwhile.
 *  - [readHistory]: opens JetX's history dropdown (the button at the right end of the strip), reads the grid, hands
 *    it to the screen reader (sent like a catch-up, minus what is stored) and closes it. Never while a round is
 *    visibly in flight, at most once per 2 minutes, on its own only while few rounds are stored.
 *  - [bet]: the auto-bet's fallback when the page's DOM has no Bet button (JetxAutobet). [gate] is the same rule
 *    as the click script's (JetxAutobetRules.mayClick: an allowed real-money decision, the app's real-money switch,
 *    AI / Shared, not stopped), checked before every tap. The auto cash-out (and the stake, when it differs) is
 *    typed only into a field found by OCR and read back; any doubt fails closed before Bet is touched.
 */
class JetxPointerTaps(
    a: JetxActivity,
    pane: FrameLayout,
    private val game: () -> WebView?,
    private val reader: JetxScreenReader,
    private val onLine: (String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val pointer = SagaPointer(a)
    private var busy = false
    private var lastHistoryAt = 0L
    var lastResult: String? = null
        private set

    init {
        pane.addView(pointer, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT))
        pointer.elevation = 12 * a.resources.displayMetrics.density
    }

    /** Opens, reads and closes the history dropdown. [manual]: the column's Read (still rate-limited). */
    fun readHistory(manual: Boolean, storedRounds: Int) {
        val now = System.currentTimeMillis()
        if (busy || game() == null) return
        if (!JetxPointerRules.mayReadHistory(lastHistoryAt, now)) { if (manual) onLine("history_wait"); return }
        if (!manual && !JetxPointerRules.wantsHistory(storedRounds)) return
        lastHistoryAt = now
        begin()
        reader.snapshot { s ->
            if (s == null) return@snapshot end("history_no_read")
            val rows = JetxOcrRules.rows(JetxOcrRules.chips(s.tokens))
            val strip = rows.firstOrNull { it.size >= JetxOcrRules.MIN_CHIPS }
                ?: return@snapshot end("history_no_strip")
            val chipH = strip.maxOf { it.h }
            if (JetxPointerRules.roundInProgress(s.tokens, chipH, strip.first().y + chipH)) {
                return@snapshot end("history_round_in_flight")
            }
            val at = JetxPointerRules.chevron(s.tokens, s.width) ?: return@snapshot end("history_no_button")
            tap(at, s.scale) {
                main.postDelayed({ readGrid(at, s.scale) }, OPEN_MS)
            }
        }
    }

    private fun readGrid(at: JetxPointerRules.Point, scale: Float) {
        reader.snapshot { s ->
            val grid = s?.let { JetxPointerRules.grid(it.tokens) }
            if (grid == null) return@snapshot end("history_not_opened") // tapped once; never again blindly
            reader.offerHistory(grid)
            tap(at, scale) {
                main.postDelayed({
                    reader.snapshot { s2 ->
                        val still = s2?.let { JetxPointerRules.grid(it.tokens) } != null
                        end(if (still) "history_left_open" else "history_read_${grid.size}")
                    }
                }, OPEN_MS)
            }
        }
    }

    /**
     * Places [d] by screen taps. [done] (ok, reason, tapped): tapped false = Bet was never touched (the caller voids
     * the bet); tapped true and ok false = Bet was tapped but the button didn't change (unconfirmed, not voided).
     */
    fun bet(d: JetxAutobetRules.Decision, gate: () -> Boolean, done: (Boolean, String, Boolean) -> Unit) {
        if (busy || game() == null) { done(false, "pointer_busy", false); return }
        if (!gate()) { done(false, "stopped", false); return }
        val deadline = SystemClock.uptimeMillis() + BET_BUDGET_MS
        begin()
        val fail = { why: String -> end(why); done(false, why, false) }
        reader.snapshot { s ->
            if (s == null) return@snapshot fail("screen_no_read")
            JetxPointerRules.betButton(s.tokens, s.height) ?: return@snapshot fail("screen_no_bet_button")
            val cash = JetxPointerRules.field(s.tokens, s.height, JetxPointerRules.CASHOUT)
                ?: return@snapshot fail("screen_no_cashout")
            if (cash.value == null) return@snapshot fail("screen_cashout_unread")
            setIfNeeded(cash, d.target, JetxPointerRules.CASHOUT, s.scale, gate, fail) {
                checkStake(d, s.scale, gate, fail) { press(deadline, gate, done, fail) }
            }
        }
    }

    /** Types [want] into [f] unless it shows it already, then reads it back; any mismatch fails closed. */
    private fun setIfNeeded(f: JetxPointerRules.Field, want: Double, label: Regex, scale: Float, gate: () -> Boolean,
                            fail: (String) -> Unit, next: () -> Unit) {
        if (JetxPointerRules.verify(f.value, want)) { next(); return }
        val keys = JetxPointerRules.keys(JetxPointerRules.typed(want)) ?: return fail("screen_bad_value")
        if (!gate()) return fail("stopped")
        tap(f.at, scale) {
            main.postDelayed({
                type(keys)
                main.postDelayed({
                    reader.snapshot { s ->
                        val back = s?.let { JetxPointerRules.field(it.tokens, it.height, label)?.value }
                        if (JetxPointerRules.verify(back, want)) next() else fail("screen_not_verified")
                    }
                }, READ_BACK_MS)
            }, FOCUS_MS)
        }
    }

    /** The stake on the Bet button must be the decision's; else a Stake field is set and read back, or it fails. */
    private fun checkStake(d: JetxAutobetRules.Decision, scale: Float, gate: () -> Boolean, fail: (String) -> Unit,
                           next: () -> Unit) {
        reader.snapshot { s ->
            if (s == null) return@snapshot fail("screen_no_read")
            val bet = JetxPointerRules.betButton(s.tokens, s.height) ?: return@snapshot fail("screen_no_bet_button")
            if (JetxPointerRules.verify(JetxPointerRules.betStake(s.tokens, bet), d.stake)) return@snapshot next()
            val f = JetxPointerRules.field(s.tokens, s.height, JetxPointerRules.STAKE)
            if (f?.value == null) return@snapshot fail("screen_stake_mismatch")
            setIfNeeded(f, d.stake, JetxPointerRules.STAKE, scale, gate, fail, next)
        }
    }

    private fun press(deadline: Long, gate: () -> Boolean, done: (Boolean, String, Boolean) -> Unit,
                      fail: (String) -> Unit) {
        reader.snapshot { s ->
            if (s == null) return@snapshot fail("screen_no_read")
            val bet = JetxPointerRules.betButton(s.tokens, s.height) ?: return@snapshot fail("screen_no_bet_button")
            if (SystemClock.uptimeMillis() > deadline) return@snapshot fail("screen_too_slow")
            if (!gate()) return@snapshot fail("stopped")
            tap(bet, s.scale, before = gate) { tapped ->
                if (!tapped) return@tap fail("stopped")
                main.postDelayed({
                    reader.snapshot { s2 ->
                        val after = s2?.let { JetxPointerRules.betButton(it.tokens, it.height) }
                        val moved = after != null && s2 != null &&
                            Math.abs(after.x / s2.scale - bet.x / s.scale) > MOVED_PX
                        val changed = s2 != null && (after == null || moved)
                        end(if (changed) "screen_bet" else "screen_bet_unconfirmed")
                        done(changed, if (changed) "" else "bet_unconfirmed", true)
                    }
                }, CONFIRM_MS)
            }
        }
    }

    private fun begin() {
        busy = true
        reader.hold = true
        pointer.stay = true
        pointer.showIdle()
    }

    private fun end(result: String) {
        busy = false
        reader.hold = false
        pointer.stay = false
        pointer.release()
        lastResult = result
        onLine(result)
    }

    /** Glides to [p] (capture px / [scale] = pane px), checks [before] once more, then a real tap. */
    private fun tap(p: JetxPointerRules.Point, scale: Float, before: () -> Boolean = { true },
                    then: (Boolean) -> Unit) {
        val wv = game() ?: return then(false)
        val x = (p.x / scale).coerceIn(1f, maxOf(1f, wv.width - 1f))
        val y = (p.y / scale).coerceIn(1f, maxOf(1f, wv.height - 1f))
        pointer.moveTo(wv, x, y) {
            if (!before()) { then(false); return@moveTo }
            val down = SystemClock.uptimeMillis()
            touch(wv, down, down, MotionEvent.ACTION_DOWN, x, y)
            main.postDelayed({
                touch(wv, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y)
                pointer.ripple()
                then(true)
            }, TAP_MS)
        }
    }

    private fun touch(wv: WebView, downTime: Long, time: Long, action: Int, x: Float, y: Float) {
        val props = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val coords = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f }
        val e = MotionEvent.obtain(downTime, time, action, 1, arrayOf(props), arrayOf(coords), 0, 0, 1f, 1f, 0, 0,
            InputDevice.SOURCE_TOUCHSCREEN, 0)
        try {
            if (wv is TabWebView) wv.asSaga { wv.dispatchTouchEvent(e) } else wv.dispatchTouchEvent(e)
        } catch (_: Exception) { } finally { e.recycle() }
    }

    /** Clears the focused field (end, then backspaces) and types [keys]. */
    private fun type(keys: List<Int>) {
        val wv = game() ?: return
        val all = listOf(KeyEvent.KEYCODE_MOVE_END) + List(CLEAR_KEYS) { KeyEvent.KEYCODE_DEL } + keys
        all.forEach { k ->
            try {
                wv.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, k))
                wv.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, k))
            } catch (_: Exception) { }
        }
    }

    fun close() {
        main.removeCallbacksAndMessages(null)
        pointer.hide()
    }

    private companion object {
        const val TAP_MS = 60L
        const val OPEN_MS = 900L
        const val FOCUS_MS = 300L
        const val READ_BACK_MS = 500L
        const val CONFIRM_MS = 800L
        const val CLEAR_KEYS = 10
        const val BET_BUDGET_MS = 7_000L
        const val MOVED_PX = 40f
    }
}
