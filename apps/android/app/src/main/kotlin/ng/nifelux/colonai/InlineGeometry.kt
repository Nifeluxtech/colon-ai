package ng.nifelux.colonai

import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Where the in-chat browser panel goes in the "inline" layout (v0.9.1). Pure, unit-tested in InlineGeometryTest.
 * The chat page draws the Colon Browser card in its thread and reports the card's empty body box with
 * browser('anchor', {visible, x, y, width, height, viewportTop, viewportBottom, dpr}) in CSS px of the shell page
 * (docs/android-bridge.md). [place] turns that into device px inside the layer that sits over the shell WebView:
 * the panel's size and position, and the clip (the visible thread between the chat header and the composer), so
 * the panel scrolls with the thread and never covers the header or the composer.
 */
object InlineGeometry {
    /** One report from the page; [HIDDEN] when the card is off screen, collapsed or not drawn. */
    data class Anchor(
        val visible: Boolean, val x: Float, val y: Float, val width: Float, val height: Float,
        val viewportTop: Float, val viewportBottom: Float, val dpr: Float,
        /** 0.10.2: the visible page's height (CSS px) when this was measured; 0 = not sent (older pages). */
        val pageHeight: Float = 0f,
    )

    /** Device px relative to the layer. [clipTop]..[clipBottom] is the part of the layer the panel may show in. */
    data class Placement(
        val visible: Boolean, val left: Int, val top: Int, val width: Int, val height: Int,
        val clipTop: Int, val clipBottom: Int,
    )

    val HIDDEN = Anchor(false, 0f, 0f, 0f, 0f, 0f, 0f, 1f)
    val NOWHERE = Placement(false, 0, 0, 0, 0, 0, 0)

    /** CSS px beyond this are not a real box (a bad message): treated as hidden. */
    const val MAX_CSS = 20000f
    const val MIN_DPR = 0.5f
    const val MAX_DPR = 8f

    /** Reads the bridge message; anything missing, non-finite or absurd is [HIDDEN]. */
    fun anchorOf(o: JSONObject): Anchor {
        if (!o.optBoolean("visible", false)) return HIDDEN
        fun f(k: String) = o.optDouble(k, Double.NaN).toFloat()
        return anchorOf(f("x"), f("y"), f("width"), f("height"), f("viewportTop"), f("viewportBottom"), f("dpr"),
            f("pageHeight"))
    }

    fun anchorOf(x: Float, y: Float, width: Float, height: Float, vTop: Float, vBottom: Float, dpr: Float,
                 pageHeight: Float = Float.NaN): Anchor {
        val all = listOf(x, y, width, height, vTop, vBottom)
        if (all.any { !it.isFinite() || it < -MAX_CSS || it > MAX_CSS }) return HIDDEN
        if (width <= 0f || height <= 0f || vBottom <= vTop) return HIDDEN
        val d = if (dpr.isFinite() && dpr in MIN_DPR..MAX_DPR) dpr else 0f // 0: use the screen's density
        val page = if (pageHeight.isFinite() && pageHeight > 0f && pageHeight <= MAX_CSS) pageHeight else 0f
        return Anchor(true, x, y, width, height, vTop, vBottom, d, page)
    }

    /**
     * [density]: the screen's density, used when the page sent no usable dpr. [offsetX]/[offsetY]: the shell
     * WebView's position inside the layer (0 when both fill the same box). [layerWidth]/[layerHeight]: the layer's
     * size; the clip never leaves it. [shellHeight] (0.10.2): the shell WebView's height in px now. The page's
     * report can be a frame or more old (the keyboard opened, the composer grew): the gap it saw between the band's
     * bottom (the composer's top) and the page's bottom ([Anchor.pageHeight] − viewportBottom) is kept from the
     * WebView's bottom as it is now, so a shrinking chat never lets the panel slide over the composer.
     */
    fun place(a: Anchor?, density: Float, offsetX: Int, offsetY: Int, layerWidth: Int, layerHeight: Int,
              shellHeight: Int = 0): Placement {
        if (a == null || !a.visible || layerWidth <= 0 || layerHeight <= 0) return NOWHERE
        val d = if (a.dpr > 0f) a.dpr else density
        if (!(d > 0f)) return NOWHERE
        val left = (a.x * d).roundToInt() + offsetX
        val top = (a.y * d).roundToInt() + offsetY
        val width = (a.width * d).roundToInt()
        val height = (a.height * d).roundToInt()
        val clipTop = max(0, (a.viewportTop * d).roundToInt() + offsetY)
        var clipBottom = min(layerHeight, (a.viewportBottom * d).roundToInt() + offsetY)
        if (a.pageHeight > 0f && shellHeight > 0) {
            val gap = ((a.pageHeight - a.viewportBottom) * d).roundToInt().coerceAtLeast(0)
            clipBottom = min(clipBottom, offsetY + shellHeight - gap)
        }
        val shows = width > 0 && height > 0 && clipBottom > clipTop &&
            top < clipBottom && top + height > clipTop && left < layerWidth && left + width > 0
        if (!shows) return NOWHERE
        return Placement(true, left, top, width, height, clipTop, clipBottom)
    }
}
