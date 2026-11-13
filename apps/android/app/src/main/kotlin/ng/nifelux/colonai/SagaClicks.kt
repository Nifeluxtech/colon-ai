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
 * [done] gets (result, error, secretKind): error "secret_field" with the kind when a secret field was refused.
 */
class SagaClicks(private val tools: SagaTools) {
    private val main = Handler(Looper.getMainLooper())

    fun click(wv: WebView, probe: JSONObject, pointer: SagaPointer?, loading: () -> Boolean, halted: () -> String?,
              done: (JSONObject?, String?, String?) -> Unit) {
        val urlBefore = wv.url
        point(wv, probe, done) { first ->
            val plan = SagaTap.plan(first, wv.width, wv.height, wv.isAttachedToWindow)
            val before = first.optJSONObject("before")
            val covered = first.optString("covered")
            val settle: (String) -> Unit = { method ->
                settle(wv, probe, before, method, covered, urlBefore, loading, done)
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
            val go = { halted()?.let { done(null, it, null) } ?: then() }
            if (plan.shown && pointer != null) pointer.moveTo(wv, plan.x, plan.y) { pointer.ripple(); go() }
            else go()
        }
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
                       urlBefore: String?, loading: () -> Boolean, done: (JSONObject?, String?, String?) -> Unit) {
        val args = JSONObject().put("id", probe.optString("id")).put("before", before ?: JSONObject.NULL)
        val look: (Long, Boolean) -> Unit = { delay, last ->
            main.postDelayed({
                tools.exec(wv, "outcome", args) { o ->
                    val res = SagaTap.result(o?.takeIf { !it.has("error") }, method, covered, urlBefore, wv.url,
                        wv.title, loading())
                    if (last || !SagaTap.lookAgain(res.optString("changed"))) done(res, null, null)
                    else main.postDelayed({
                        tools.exec(wv, "outcome", args) { o2 ->
                            done(SagaTap.result(o2?.takeIf { !it.has("error") }, method, covered, urlBefore, wv.url,
                                wv.title, loading()), null, null)
                        }
                    }, SECOND_LOOK_MS)
                }
            }, delay)
        }
        look(FIRST_LOOK_MS, false)
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

    private fun send(view: View, downTime: Long, time: Long, action: Int, x: Float, y: Float) {
        val props = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val coords = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = 1f; size = 1f }
        val e = MotionEvent.obtain(downTime, time, action, 1, arrayOf(props), arrayOf(coords), 0, 0, 1f, 1f, 0, 0,
            InputDevice.SOURCE_TOUCHSCREEN, 0)
        try { view.dispatchTouchEvent(e) } catch (_: Exception) { } finally { e.recycle() }
    }

    companion object {
        const val TAP_MS = 60L
        const val FIRST_LOOK_MS = 700L
        const val SECOND_LOOK_MS = 1200L
    }
}
