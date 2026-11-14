package ng.nifelux.colonai

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View
import android.view.animation.DecelerateInterpolator
import androidx.core.content.ContextCompat

/**
 * 0.10.1: Saga's pointer. A Colon-blue arrow with the brand's two cyan dots, drawn over the page in the browser's
 * content frame (above the WebView and the AI shield). It glides to the element before each click and fill, and
 * rides along Saga's scroll swipes (0.10.2),
 * shows a ripple where it taps, then fades. It never takes a touch (not clickable or focusable, onTouchEvent and
 * dispatchTouchEvent answer false), so in "AI + me" the user's fingers reach the page and the shield's Take control
 * button as before. It is never shown on a secret field: SagaClicks only moves it after tools.js `point` passed.
 */
class SagaPointer(context: Context) : View(context) {
    private val dp = resources.displayMetrics.density
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.colon_primary); style = Paint.Style.FILL
    }
    private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 1.6f * dp; strokeJoin = Paint.Join.ROUND
    }
    private val dots = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ContextCompat.getColor(context, R.color.colon_cyan) }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.colon_cyan); style = Paint.Style.STROKE; strokeWidth = 3 * dp
    }
    private val arrow = Path().apply {
        val s = 1.25f * dp
        moveTo(0f, 0f); lineTo(0f, 17 * s); lineTo(4.5f * s, 13 * s); lineTo(7.5f * s, 20 * s)
        lineTo(10.5f * s, 18.7f * s); lineTo(7.5f * s, 12 * s); lineTo(13 * s, 12 * s); close()
    }
    private var px = -1f
    private var py = -1f
    private var shown = 0f
    private var rippleAt = -1f
    private var move: ValueAnimator? = null
    private var fade: ValueAnimator? = null
    private var pulse: ValueAnimator? = null
    private val hideLater = Runnable { fadeOut() }

    init {
        isClickable = false
        isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent?): Boolean = false
    override fun dispatchTouchEvent(event: MotionEvent?): Boolean = false

    /** Glides to ([x], [y]) in [target]'s px (the WebView), then runs [then]. */
    fun moveTo(target: View, x: Float, y: Float, then: () -> Unit) {
        val (tx, ty) = local(target, x, y)
        removeCallbacks(hideLater); fade?.cancel(); move?.cancel()
        if (px < 0 || shown < 0.05f) { px = width / 2f; py = height * 0.85f }
        shown = 1f
        val fx = px; val fy = py
        var ran = false
        val finish = { if (!ran) { ran = true; then() } }
        move = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = MOVE_MS
            interpolator = DecelerateInterpolator(1.6f)
            addUpdateListener { px = fx + (tx - fx) * it.animatedFraction; py = fy + (ty - fy) * it.animatedFraction
                invalidate() }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) { finish() }
                override fun onAnimationCancel(animation: android.animation.Animator) { finish() }
            })
            start()
        }
    }

    /** Puts the pointer at ([x], [y]) in [target]'s px at once (the element moved while it glided). */
    fun jump(target: View, x: Float, y: Float) {
        val (tx, ty) = local(target, x, y)
        px = tx; py = ty; shown = 1f; invalidate()
    }

    /** The tap ripple, then the pointer fades after a moment. */
    fun ripple() {
        pulse?.cancel()
        pulse = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = RIPPLE_MS
            addUpdateListener { rippleAt = it.animatedFraction; invalidate() }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) { rippleAt = -1f; invalidate() }
            })
            start()
        }
        removeCallbacks(hideLater); postDelayed(hideLater, LINGER_MS)
    }

    /** 0.10.2: the gesture is over: the pointer fades after a short moment. */
    fun release() { removeCallbacks(hideLater); postDelayed(hideLater, 400) }

    /** Gone at once: Saga lost control, or a secret field was handed to the user. */
    fun hide() {
        removeCallbacks(hideLater); move?.cancel(); fade?.cancel(); pulse?.cancel()
        shown = 0f; rippleAt = -1f; invalidate()
    }

    private fun fadeOut() {
        fade?.cancel()
        fade = ValueAnimator.ofFloat(shown, 0f).apply {
            duration = FADE_MS
            addUpdateListener { shown = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    private fun local(target: View, x: Float, y: Float): Pair<Float, Float> {
        val a = IntArray(2); val b = IntArray(2)
        target.getLocationInWindow(a); getLocationInWindow(b)
        return Pair(x + a[0] - b[0], y + a[1] - b[1])
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (shown <= 0f || px < 0) return
        val alpha = (shown * 255).toInt().coerceIn(0, 255)
        if (rippleAt in 0f..1f) {
            ring.alpha = ((1f - rippleAt) * 0.7f * alpha).toInt()
            canvas.drawCircle(px, py, (6 + 24 * rippleAt) * dp, ring)
        }
        fill.alpha = alpha; edge.alpha = alpha; dots.alpha = alpha
        canvas.save()
        canvas.translate(px, py)
        canvas.drawPath(arrow, fill)
        canvas.drawPath(arrow, edge)
        // The brand's colon: two dots beside the arrow.
        canvas.drawCircle(21 * dp, 14 * dp, 2.6f * dp, dots)
        canvas.drawCircle(21 * dp, 22 * dp, 2.6f * dp, dots)
        canvas.restore()
    }

    companion object {
        const val MOVE_MS = 320L
        const val RIPPLE_MS = 450L
        const val LINGER_MS = 1200L
        const val FADE_MS = 300L
    }
}
