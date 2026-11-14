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

    /**
     * 0.10.3: where a point in the WebView's own px ([x], [y]) is for a sibling view in the same parent (Saga's
     * pointer, laid over the WebView in the browser's content frame): the WebView's and the pointer's positions in
     * that parent (left/top plus translation). Up to 0.10.2 the pointer went through getLocationInWindow, which
     * includes every ancestor's scale: with the card animating to full screen (a scaled panel) the arrow landed off
     * the element. Both views live in the same scaled parent, so parent coordinates need no scale at all.
     */
    fun toSibling(x: Float, y: Float, targetX: Float, targetY: Float, siblingX: Float, siblingY: Float):
        Pair<Float, Float> = Pair(x + targetX - siblingX, y + targetY - siblingY)

    /**
     * The same tap point from CSS px, for checking [plan]'s fractions (SagaTapTest): an element centre at
     * ([cssX], [cssY]) in the layout viewport, the visual viewport at ([vvLeft], [vvTop]) of [vvWidth] × [vvHeight]
     * CSS px, shown in a [width] × [height] px WebView. In the desktop card (a 1280 CSS px layout zoomed out to fit,
     * DesktopView) the visual viewport is the whole layout width, so 1 CSS px is width / 1280 device px; in full
     * screen with pinch zoom it is the zoomed-in part. Fractions of the visual viewport cover both, with no density.
     */
    fun fromCss(cssX: Float, cssY: Float, vvLeft: Float, vvTop: Float, vvWidth: Float, vvHeight: Float, width: Int,
                height: Int): Pair<Float, Float> =
        Pair((cssX - vvLeft) / vvWidth * width, (cssY - vvTop) / vvHeight * height)

    /** 0.10.2: a real tap that changed nothing at all (not even focus) is tried once more as a script click, unless
     *  the step needed the user's approval ([retry] false): a payment, purchase, message or form never runs twice. */
    fun retryWithScript(result: JSONObject, method: String, retry: Boolean): Boolean =
        retry && method == "tap" && result.optString("changed") == "none"

    /** 0.10.4: the element's box in the WebView's px, from tools.js `point` (x, y, w, h as fractions of the visible
     *  viewport), for the pointer's outline; null when it isn't known or isn't on screen. */
    data class Box(val x: Float, val y: Float, val w: Float, val h: Float)

    fun box(point: JSONObject, width: Int, height: Int): Box? {
        val x = point.optDouble("x", Double.NaN)
        val y = point.optDouble("y", Double.NaN)
        val w = point.optDouble("w", Double.NaN)
        val h = point.optDouble("h", Double.NaN)
        if (width <= 0 || height <= 0 || listOf(x, y, w, h).any { it.isNaN() } || w <= 0 || h <= 0) return null
        if (x + w < 0 || y + h < 0 || x > 1 || y > 1) return null
        return Box((x * width).toFloat(), (y * height).toFloat(), (w * width).toFloat(), (h * height).toFloat())
    }

    /** 0.10.4: Saga types [value] out in at most [max] pieces (one character each for short text), so the user sees
     *  it appear; empty or very long text is not typed out (the fill puts it in at once). */
    fun chunks(value: String, max: Int = MAX_CHUNKS): List<String> {
        if (value.isEmpty() || value.length > MAX_TYPED || max <= 0) return emptyList()
        val size = (value.length + max - 1) / max
        return value.chunked(size.coerceAtLeast(1))
    }

    const val MAX_CHUNKS = 24
    const val MAX_TYPED = 400
    /** Time between two typed pieces. */
    const val TYPE_MS = 55L

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
