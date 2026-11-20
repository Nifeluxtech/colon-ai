package ng.nifelux.colonai

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.SweepGradient
import android.os.Build
import android.os.SystemClock
import android.util.AttributeSet
import android.view.RoundedCorner
import android.view.View
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

/** 0.20.0: true when the user has animations on (Developer options / Accessibility "Remove animations" turn it off). */
internal fun animationsOn(): Boolean = Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled()

/**
 * The voice wave: rounded bars whose height follows a few mixed sine waves. Small on the pill, a wide band along
 * the footer of the expanded overlay. Animates only while attached and visible; flat bars when animations are off.
 */
class VoiceWaveView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    /** How many bars to draw. */
    var bars = 5
        set(v) { field = v; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND }
    private var phase = VoiceUiRules.Phase.LISTENING
    private val start = SystemClock.uptimeMillis()

    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

    fun setPhase(p: VoiceUiRules.Phase) {
        phase = p; paint.color = VoiceUiRules.accent(p); invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (bars <= 0 || width == 0) return
        val gap = width.toFloat() / bars
        val stroke = (gap * 0.55f).coerceAtMost(height * 0.5f)
        paint.strokeWidth = stroke
        val energy = VoiceUiRules.waveEnergy(phase)
        val live = animationsOn() && energy > 0f
        val t = (SystemClock.uptimeMillis() - start) / 1000.0
        val mid = height / 2f
        val minH = stroke * 0.5f
        for (i in 0 until bars) {
            val x = gap * (i + 0.5f)
            val wave = if (!live) 0.25 else {
                val a = sin(t * 5.1 + i * 0.9) * 0.5 + sin(t * 2.3 + i * 0.37) * 0.3 + sin(t * 8.7 + i * 1.7) * 0.2
                abs(a) * energy
            }
            val h = (minH + (height - stroke - minH) * wave.toFloat()) / 2f
            canvas.drawLine(x, mid - h, x, mid + h, paint)
        }
        if (live && isShown) postInvalidateOnAnimation()
    }
}

/**
 * The Siri-style glow around the screen's rounded edges: a thick, blurred-looking stroke with a sweep gradient
 * that turns slowly. The corner radius follows the display (API 31+ RoundedCorner) or falls back to 24 dp.
 */
class EdgeGlowView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val core = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val rect = RectF()
    private val matrix = Matrix()
    private var colors = VoiceUiRules.glow(VoiceUiRules.Phase.LISTENING)
    private val start = SystemClock.uptimeMillis()
    private val density = resources.displayMetrics.density
    private var cornerPx = VoiceUiRules.cornerRadiusPx(null, density)

    init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }

    fun setPhase(p: VoiceUiRules.Phase) { colors = VoiceUiRules.glow(p); makeShader(); invalidate() }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); cornerPx = radius() }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh); cornerPx = radius(); makeShader()
    }

    private fun makeShader() {
        if (width == 0 || height == 0) return
        val g = SweepGradient(width / 2f, height / 2f, colors, null)
        glow.shader = g; core.shader = g
    }

    private fun radius(): Float {
        var display: Int? = null
        if (Build.VERSION.SDK_INT >= 31) {
            val i = rootWindowInsets
            display = listOfNotNull(i?.getRoundedCorner(RoundedCorner.POSITION_TOP_LEFT)?.radius,
                i?.getRoundedCorner(RoundedCorner.POSITION_TOP_RIGHT)?.radius,
                i?.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_LEFT)?.radius,
                i?.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_RIGHT)?.radius).maxOrNull()
        }
        return VoiceUiRules.cornerRadiusPx(display, density)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width == 0 || height == 0) return
        val on = animationsOn()
        val t = (SystemClock.uptimeMillis() - start) / 1000.0
        matrix.setRotate(if (on) ((t * 40) % 360).toFloat() else 0f, width / 2f, height / 2f)
        glow.shader?.setLocalMatrix(matrix)
        val pulse = if (on) (0.75 + 0.25 * sin(t * 2 * PI / 1.6)).toFloat() else 1f
        val r = cornerPx
        glow.strokeWidth = 18 * density * pulse; glow.alpha = 110
        core.strokeWidth = 5 * density; core.alpha = 255
        val inset = glow.strokeWidth / 2f
        rect.set(inset, inset, width - inset, height - inset)
        canvas.drawRoundRect(rect, r, r, glow)
        val ci = core.strokeWidth / 2f
        rect.set(ci, ci, width - ci, height - ci)
        canvas.drawRoundRect(rect, r, r, core)
        if (on && isShown) postInvalidateOnAnimation()
    }
}
