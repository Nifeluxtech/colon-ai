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
 * 0.10.4 (watchable): while Saga has the page ([stay]) it stays where it last acted instead of fading, so the user
 * sees where Saga is between steps; it fades when the task ends or the user takes over (hide). It is drawn larger
 * ([scale], the chat's scaled-down desktop card) with a soft halo, and outlines the element it is about to click or
 * type into ([highlight], from tools.js `point`'s box).
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
    private val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.colon_cyan); style = Paint.Style.FILL
    }
    private val boxLine = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.colon_cyan); style = Paint.Style.STROKE; strokeWidth = 2.5f * dp
    }
    private val boxFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ContextCompat.getColor(context, R.color.colon_cyan); style = Paint.Style.FILL
    }
    /** 0.10.4: stays on the page between steps while Saga has it (no fade after a tap or a swipe). */
    var stay = false
        set(v) { field = v; if (!v && shown > 0f && move?.isRunning != true) { removeCallbacks(hideLater)
            postDelayed(hideLater, LINGER_MS) } }
    /** 0.10.4: how large the arrow is drawn (the chat's card shows a desktop page scaled down). */
    var scale = 1f
        set(v) { field = v.coerceIn(0.5f, 3f); invalidate() }
    /** The outlined element in this view's px (left, top, right, bottom), or null. */
    private var box: FloatArray? = null
    private var boxAlpha = 0f
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

    /** 0.10.4: Saga has the page: the pointer shows (in the middle of the lower page) until its first move. */
    fun showIdle() {
        if (width <= 0 || height <= 0) { post { if (stay) showIdle() }; return }
        removeCallbacks(hideLater); fade?.cancel()
        if (px < 0 || shown < 0.05f) { px = width / 2f; py = height * 0.6f }
        shown = 1f; invalidate()
    }

    /** 0.10.4: outlines the element at ([x], [y]) of [w] × [h] in [target]'s px; it stays until the next one. */
    fun highlight(target: View, x: Float, y: Float, w: Float, h: Float) {
        if (w <= 0f || h <= 0f) { box = null; invalidate(); return }
        val (l, t) = local(target, x, y)
        box = floatArrayOf(l, t, l + w, t + h)
        boxAlpha = 1f
        invalidate()
    }

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
        removeCallbacks(hideLater)
        if (!stay) postDelayed(hideLater, LINGER_MS)
    }

    /** 0.10.2: the gesture is over: the pointer fades after a short moment (0.10.4: unless Saga keeps the page). */
    fun release() { removeCallbacks(hideLater); if (!stay) postDelayed(hideLater, 400) }

    /** Gone at once: Saga lost control, or a secret field was handed to the user. */
    fun hide() {
        removeCallbacks(hideLater); move?.cancel(); fade?.cancel(); pulse?.cancel()
        shown = 0f; rippleAt = -1f; box = null; invalidate()
    }

    private fun fadeOut() {
        fade?.cancel()
        fade = ValueAnimator.ofFloat(shown, 0f).apply {
            duration = FADE_MS
            addUpdateListener { shown = it.animatedValue as Float; invalidate() }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    if (shown <= 0.01f) { box = null; invalidate() }
                }
            })
            start()
        }
    }

    /** [target]'s point in this view's px. 0.10.3: through the shared parent when there is one (SagaTap.toSibling:
     *  no ancestor scale, so the arrow stays on the element while the card animates); window coordinates else. */
    private fun local(target: View, x: Float, y: Float): Pair<Float, Float> {
        if (target.parent != null && target.parent === parent) {
            return SagaTap.toSibling(x, y, target.left + target.translationX, target.top + target.translationY,
                left + translationX, top + translationY)
        }
        val a = IntArray(2); val b = IntArray(2)
        target.getLocationInWindow(a); getLocationInWindow(b)
        return Pair(x + a[0] - b[0], y + a[1] - b[1])
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (shown <= 0f || px < 0) return
        val alpha = (shown * 255).toInt().coerceIn(0, 255)
        box?.let { b ->
            val r = 4 * dp
            boxFill.alpha = (alpha * boxAlpha * 0.16f).toInt()
            boxLine.alpha = (alpha * boxAlpha * 0.95f).toInt()
            canvas.drawRoundRect(b[0] - 3 * dp, b[1] - 3 * dp, b[2] + 3 * dp, b[3] + 3 * dp, r, r, boxFill)
            canvas.drawRoundRect(b[0] - 3 * dp, b[1] - 3 * dp, b[2] + 3 * dp, b[3] + 3 * dp, r, r, boxLine)
        }
        if (rippleAt in 0f..1f) {
            ring.alpha = ((1f - rippleAt) * 0.7f * alpha).toInt()
            canvas.drawCircle(px, py, (6 + 24 * rippleAt) * dp * scale, ring)
        }
        // A soft halo under the tip, so the arrow stands out on any page, even a busy one shrunk into the card.
        halo.alpha = (alpha * 0.28f).toInt()
        canvas.drawCircle(px, py, 11 * dp * scale, halo)
        fill.alpha = alpha; edge.alpha = alpha; dots.alpha = alpha
        canvas.save()
        canvas.translate(px, py)
        canvas.scale(scale, scale)
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
