package ng.nifelux.colonai

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.webkit.WebView
import org.json.JSONObject

/**
 * 0.10.1: Saga's clicks are real taps. click():
 *   1. tools.js `point` (refuses secret fields; scrolls the element into view; says where it is and what is over it)
 *   2. the Saga pointer glides there (SagaPointer, drawn over the page, never takes a touch)
 *   3. `point` again, right before the tap: the page may have changed while the pointer moved, and a secret field
 *      is refused here too, so no tap ever lands on one
 *   4. a genuine tap: MotionEvent DOWN then UP (finger, touchscreen) dispatched to the WebView at the element's
 *      centre (SagaTap.plan); when that can't be done (off screen, covered, no view) tools.js `click` (pointer and
 *      mouse events, focus, click()) acts on the element itself
 *   5. after a short wait, tools.js `outcome` compares the page with step 1's snapshot: navigated, page_changed,
 *      element_changed, focused or none, so Saga hears when a click did nothing (SagaTap.result).
 *   6. 0.10.2: a tap that changed nothing at all is followed once by the script click (some pages only listen to
 *      click(), or the tap missed), unless the step was one the user had to approve (never twice for a payment,
 *      a purchase, a message or a form) — method "tap+script".
 * Saga's MotionEvents go through TabWebView.asSaga, so they reach the page even while it ignores the user ("AI
 * only"). scroll() (0.10.2) is a real finger swipe with the pointer, checked with act.js, falling back to scrolling
 * the page or its scrolling container by script when the swipe moved nothing.
 * [done] gets (result, error, secretKind): error "secret_field" with the kind when a secret field was refused.
 * 0.10.4: the pointer outlines the element before it clicks or types (SagaPointer.highlight, SagaTap.box), and
 * typeOut() types the text into the field piece by piece (act.js `type`) before the real fill, so it is watchable.
 */
class SagaClicks(private val tools: SagaTools) {
    private val main = Handler(Looper.getMainLooper())

    fun click(wv: WebView, probe: JSONObject, pointer: SagaPointer?, loading: () -> Boolean, halted: () -> String?,
              retry: Boolean, done: (JSONObject?, String?, String?) -> Unit) {
        val urlBefore = wv.url
        point(wv, probe, done) { first ->
            val plan = SagaTap.plan(first, wv.width, wv.height, wv.isAttachedToWindow)
            outline(wv, first, pointer)
            val before = first.optJSONObject("before")
            val covered = first.optString("covered")
            val settle: (String) -> Unit = { method ->
                settle(wv, probe, before, method, covered, urlBefore, loading) { res ->
                    // The tap changed nothing at all: once more as a script click (never for approved steps).
                    if (!SagaTap.retryWithScript(res, method, retry) || halted() != null) done(res, null, null)
                    else script(wv, probe, pointer, done) {
                        settle(wv, probe, before, "tap+script", covered, urlBefore, loading) { done(it, null, null) }
                    }
                }
            }
            val act = act@{
                // Saga may have lost control while the pointer moved (Take control, Pause, Stop): no tap then.
                halted()?.let { done(null, it, null); return@act }
                if (!plan.native) script(wv, probe, pointer, done, settle)
                else point(wv, probe, done) { again ->
                    val p = SagaTap.plan(again, wv.width, wv.height, wv.isAttachedToWindow)
                    val stop = halted()
                    if (stop != null) done(null, stop, null)
                    else if (!p.native) script(wv, probe, pointer, done, settle)
                    else {
                        pointer?.jump(wv, p.x, p.y)
                        tap(wv, p.x, p.y) { pointer?.ripple(); settle("tap") }
                    }
                }
            }
            if (plan.shown && pointer != null) pointer.moveTo(wv, plan.x, plan.y, act) else act()
        }
    }

    /** Glides the pointer to a field before Saga types into it; [then] runs once it is there (or at once). */
    fun aim(wv: WebView, probe: JSONObject, pointer: SagaPointer?, halted: () -> String?,
            done: (JSONObject?, String?, String?) -> Unit, then: () -> Unit) {
        point(wv, probe, done) { p ->
            val plan = SagaTap.plan(p, wv.width, wv.height, wv.isAttachedToWindow)
            outline(wv, p, pointer)
            val go = { halted()?.let { done(null, it, null) } ?: then() }
            if (plan.shown && pointer != null) pointer.moveTo(wv, plan.x, plan.y) { pointer.ripple(); go() }
            else go()
        }
    }

    private fun outline(wv: WebView, p: JSONObject, pointer: SagaPointer?) {
        val b = SagaTap.box(p, wv.width, wv.height) ?: return
        pointer?.highlight(wv, b.x, b.y, b.w, b.h)
    }

    /**
     * 0.10.4: types [value] into the field the pointer is on, a piece at a time ([SagaTap.chunks], act.js `type`:
     * the browser's own editing path, refused on secret fields like fill), then runs [then] (the real fill, which
     * makes the field exact and fires change). Nothing to type out, Saga losing the page, or a piece the page didn't
     * take: [then] at once.
     */
    fun typeOut(wv: WebView, probe: JSONObject, value: String, halted: () -> String?, then: () -> Unit) {
        val pieces = SagaTap.chunks(value)
        if (pieces.isEmpty()) { then(); return }
        fun next(i: Int) {
            if (i >= pieces.size || halted() != null) { then(); return }
            val args = JSONObject().put("id", probe.optString("id")).put("text", pieces[i]).put("first", i == 0)
            tools.exec(wv, "type", args) { r ->
                if (r == null || r.has("error")) then()
                else main.postDelayed({ next(i + 1) }, SagaTap.TYPE_MS)
            }
        }
        next(0)
    }

    private fun point(wv: WebView, probe: JSONObject, done: (JSONObject?, String?, String?) -> Unit,
                      next: (JSONObject) -> Unit) {
        tools.exec(wv, "point", probe) { r ->
            when {
                r == null -> done(null, "page_error", null)
                r.optString("error") == "secret_field" ->
                    done(null, "secret_field", r.optString("kind").ifBlank { SecretFields.PASSWORD })
                r.has("error") -> done(null, r.optString("error").ifBlank { "page_error" }, null)
                else -> next(r)
            }
        }
    }

    private fun script(wv: WebView, probe: JSONObject, pointer: SagaPointer?,
                       done: (JSONObject?, String?, String?) -> Unit, settle: (String) -> Unit) {
        tools.exec(wv, "click", probe) { r ->
            when {
                r == null -> done(null, "page_error", null)
                r.optString("error") == "secret_field" ->
                    done(null, "secret_field", r.optString("kind").ifBlank { SecretFields.PASSWORD })
                r.has("error") -> done(null, r.optString("error").ifBlank { "page_error" }, null)
                else -> { pointer?.ripple(); settle("script") }
            }
        }
    }

    private fun settle(wv: WebView, probe: JSONObject, before: JSONObject?, method: String, covered: String,
                       urlBefore: String?, loading: () -> Boolean, done: (JSONObject) -> Unit) {
        val args = JSONObject().put("id", probe.optString("id")).put("before", before ?: JSONObject.NULL)
        val look: (Long, Boolean) -> Unit = { delay, last ->
            main.postDelayed({
                tools.exec(wv, "outcome", args) { o ->
                    val res = SagaTap.result(o?.takeIf { !it.has("error") }, method, covered, urlBefore, wv.url,
                        wv.title, loading())
                    if (last || !SagaTap.lookAgain(res.optString("changed"))) done(res)
                    else main.postDelayed({
                        tools.exec(wv, "outcome", args) { o2 ->
                            done(SagaTap.result(o2?.takeIf { !it.has("error") }, method, covered, urlBefore, wv.url,
                                wv.title, loading()))
                        }
                    }, SECOND_LOOK_MS)
                }
            }, delay)
        }
        look(FIRST_LOOK_MS, false)
    }

    /**
     * 0.10.2: Saga scrolls like a finger: the pointer goes to the page, swipes (SagaTap.swipe) and lets go; act.js
     * `scrollinfo` before and after says whether the page (or its scrolling container) moved. top / bottom, a swipe
     * that moved nothing, or no laid-out view: act.js scrolls by script. [done] gets ({ y, max, target, moved,
     * method }, null) or (null, error).
     */
    fun scroll(wv: WebView, args: JSONObject, pointer: SagaPointer?, halted: () -> String?,
               done: (JSONObject?, String?) -> Unit) {
        val byScript = {
            tools.exec(wv, "scroll", args) { r ->
                pointer?.release()
                when {
                    r == null -> done(null, "page_error")
                    r.has("error") -> done(null, r.optString("error").ifBlank { "page_error" })
                    else -> done(r.put("method", "script"), null)
                }
            }
        }
        tools.exec(wv, "scrollinfo", args) { before ->
            val plan = SagaTap.swipe(args.optString("direction", "down"), wv.width, wv.height, wv.isAttachedToWindow)
            if (before == null || before.has("error") || plan == null) { byScript(); return@exec }
            val go = go@{
                halted()?.let { pointer?.release(); done(null, it); return@go }
                swipe(wv, plan, pointer) {
                    main.postDelayed({
                        tools.exec(wv, "scrollinfo", args) { after ->
                            if (SagaTap.scrolled(before, after)) {
                                pointer?.release()
                                done(after!!.put("moved", true).put("method", "swipe"), null)
                            } else byScript()
                        }
                    }, SWIPE_SETTLE_MS)
                }
            }
            if (pointer != null) pointer.moveTo(wv, plan.x, plan.fromY, go) else go()
        }
    }

    /** A finger swipe: DOWN, [SagaTap.SWIPE_STEPS] MOVEs a frame apart, a short hold (so it doesn't fling far), UP.
     *  The pointer rides along. */
    private fun swipe(wv: WebView, plan: SagaTap.Swipe, pointer: SagaPointer?, after: () -> Unit) {
        val down = SystemClock.uptimeMillis()
        send(wv, down, down, MotionEvent.ACTION_DOWN, plan.x, plan.fromY)
        for (i in 1..SagaTap.SWIPE_STEPS) {
            main.postDelayed({
                val y = plan.fromY + (plan.toY - plan.fromY) * i / SagaTap.SWIPE_STEPS
                pointer?.jump(wv, plan.x, y)
                send(wv, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_MOVE, plan.x, y)
            }, i * FRAME_MS)
        }
        main.postDelayed({
            send(wv, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_MOVE, plan.x, plan.toY)
            send(wv, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, plan.x, plan.toY)
            after()
        }, SagaTap.SWIPE_STEPS * FRAME_MS + HOLD_MS)
    }

    /** A finger tap at ([x], [y]) in the WebView's px: DOWN now, UP [TAP_MS] later, like a real touch. */
    private fun tap(view: View, x: Float, y: Float, after: () -> Unit) {
        val down = SystemClock.uptimeMillis()
        send(view, down, down, MotionEvent.ACTION_DOWN, x, y)
        main.postDelayed({
            send(view, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y)
            after()
        }, TAP_MS)
    }

    /** Saga's own touch: through TabWebView.asSaga, so a page locked against the user ("AI only") still gets it. */
    private fun send(view: View, downTime: Long, time: Long, action: Int, x: Float, y: Float) {
        val props = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val coords = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f }
        val e = MotionEvent.obtain(downTime, time, action, 1, arrayOf(props), arrayOf(coords), 0, 0, 1f, 1f, 0, 0,
            InputDevice.SOURCE_TOUCHSCREEN, 0)
        try {
            if (view is TabWebView) view.asSaga { view.dispatchTouchEvent(e) } else view.dispatchTouchEvent(e)
        } catch (_: Exception) { } finally { e.recycle() }
    }

    companion object {
        const val TAP_MS = 60L
        const val FIRST_LOOK_MS = 700L
        const val SECOND_LOOK_MS = 1200L
        const val FRAME_MS = 16L
        const val HOLD_MS = 120L
        const val SWIPE_SETTLE_MS = 350L
    }
}
