package ng.nifelux.colonai

import android.content.Context
import android.graphics.Rect
import android.view.MotionEvent
import android.widget.FrameLayout

/**
 * The layer over the chat WebView that holds the browser panel in the "inline" layout (v0.9.1). The panel is
 * moved with translation (scrolling never re-lays it out) and the layer clips it to the visible thread, so it never
 * draws over the chat header or the composer. Touches outside the clip are not taken: they reach the chat WebView
 * underneath (the layer is the chat container's last child, so the container offers them to the chat next).
 */
class InlineLayer(context: Context) : FrameLayout(context) {
    private val clip = Rect()
    private var clipped = false

    init {
        clipChildren = true
        isClickable = false
        isFocusable = false
    }

    /** The visible band of the thread, in this layer's px. Only changes the clip when it moved. */
    fun setClip(top: Int, bottom: Int) {
        if (clipped && clip.top == top && clip.bottom == bottom && clip.right == width) return
        clip.set(0, top, width, bottom)
        clipped = true
        clipBounds = Rect(clip)
    }

    fun clearClip() {
        if (!clipped) return
        clipped = false
        clip.setEmpty()
        clipBounds = null
    }

    /** True when the screen point is on the visible part of the panel ([child] is the panel). */
    fun hits(rawX: Float, rawY: Float, child: android.view.View): Boolean {
        if (visibility != VISIBLE || child.parent !== this || !clipped) return false
        val me = IntArray(2)
        getLocationOnScreen(me)
        val x = rawX - me[0]
        val y = rawY - me[1]
        if (y < clip.top || y >= clip.bottom) return false
        val left = child.left + child.translationX
        val top = child.top + child.translationY
        return x >= left && x < left + child.width && y >= top && y < top + child.height
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN &&
            (!clipped || ev.y < clip.top || ev.y >= clip.bottom)) return false
        return super.dispatchTouchEvent(ev)
    }
}
