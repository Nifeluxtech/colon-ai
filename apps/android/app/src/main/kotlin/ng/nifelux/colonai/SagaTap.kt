package ng.nifelux.colonai

import org.json.JSONObject

/**
 * 0.10.1: where and how Saga clicks (pure, unit-tested in SagaTapTest). tools.js `point` scrolls the element to the
 * middle of the page and reports its centre (cx, cy) as fractions of the visible viewport (visualViewport, so pinch
 * zoom is already in it); multiplying by the WebView's size in px gives the tap point, with no density or scale
 * maths that could drift. A real tap (MotionEvent, SagaClicks) is used when the centre is on screen and nothing
 * covers the element; otherwise the script fallback (pointer and mouse events, then click()) acts on the element.
 */
object SagaTap {
    /** How the click will be made: [native] = a real tap at ([x], [y]) in the WebView's px; [why] = why not. */
    data class Plan(val native: Boolean, val x: Float, val y: Float, val shown: Boolean, val why: String?)

    /** Changes after which a second look is worth it: slow pages answer a tap a moment later. */
    private val LOOK_AGAIN = setOf("none", "focused", "unknown")
    const val EDGE_PX = 1f

    fun plan(point: JSONObject, width: Int, height: Int, attached: Boolean): Plan {
        val cx = point.optDouble("cx", Double.NaN)
        val cy = point.optDouble("cy", Double.NaN)
        val inView = point.optBoolean("in_view") && cx in 0.0..1.0 && cy in 0.0..1.0
        val hasView = attached && width > 0 && height > 0
        val x = if (inView && hasView) (cx * width).toFloat().coerceIn(EDGE_PX, width - EDGE_PX) else 0f
        val y = if (inView && hasView) (cy * height).toFloat().coerceIn(EDGE_PX, height - EDGE_PX) else 0f
        val why = when {
            !hasView -> "no_view"
            !inView -> "off_screen"
            !point.optBoolean("hit", true) -> "covered"
            else -> null
        }
        return Plan(native = why == null, x = x, y = y, shown = inView && hasView, why = why)
    }

    /** 0.10.2: a real tap that changed nothing at all (not even focus) is tried once more as a script click, unless
     *  the step needed the user's approval ([retry] false): a payment, purchase, message or form never runs twice. */
    fun retryWithScript(result: JSONObject, method: String, retry: Boolean): Boolean =
        retry && method == "tap" && result.optString("changed") == "none"

    /** 0.10.2: a finger swipe for scroll, in the WebView's px. */
    data class Swipe(val x: Float, val fromY: Float, val toY: Float)

    const val SWIPE_STEPS = 12

    /** "down" moves the page up: the finger goes from 72 % to 30 % of the height (and back for "up"), a little
     *  right of the middle. top / bottom, or no laid-out view: null (act.js scrolls by script). */
    fun swipe(direction: String, width: Int, height: Int, attached: Boolean): Swipe? {
        if (!attached || width <= 0 || height <= 0) return null
        val x = width * 0.6f
        return when (direction) {
            "down" -> Swipe(x, height * 0.72f, height * 0.30f)
            "up" -> Swipe(x, height * 0.30f, height * 0.72f)
            else -> null
        }
    }

    /** act.js scrollinfo before and after the swipe: did the page (or its scrolling container) move? */
    fun scrolled(before: JSONObject?, after: JSONObject?): Boolean =
        before != null && after != null && !after.has("error") && after.has("y") &&
            after.optInt("y") != before.optInt("y")

    /** True when a click result is worth checking once more after a longer wait. */
    fun lookAgain(changed: String?): Boolean = changed == null || changed in LOOK_AGAIN

    /**
     * What a click did, for the server: tools.js `outcome` when the page answered, else (a new page is loading, so
     * the script ran nowhere) the tab's own URL. [method] tap | script; [covered] what lay over the element.
     */
    fun result(outcome: JSONObject?, method: String, covered: String, urlBefore: String?, urlNow: String?,
               titleNow: String?, loading: Boolean): JSONObject {
        val moved = !urlNow.isNullOrEmpty() && urlNow != urlBefore
        val changed = when {
            outcome != null && outcome.optString("changed").isNotEmpty() -> outcome.optString("changed")
            moved || loading -> "navigated"
            else -> "unknown"
        }
        val out = JSONObject().put("method", method).put("changed", changed)
            .put("url", outcome?.optString("url")?.ifEmpty { null } ?: urlNow ?: "")
            .put("title", outcome?.optString("title")?.ifEmpty { null } ?: titleNow ?: "")
        if (covered.isNotBlank()) out.put("covered", covered.take(60))
        return out
    }
}
