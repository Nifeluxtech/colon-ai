package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat.AccessibilityActionCompat

/**
 * 0.20.0 voice mode over other apps (needs "Display over other apps"; VoiceService owns it, so it survives Colon
 * going to the background). Two windows:
 * - the pill: a small "dynamic island" at the top centre with a wave and the state ("Listening…"). Tap expands it;
 *   hold or swipe it away to end voice mode.
 * - the expanded overlay: full screen, the screen's rounded edges glowing with a turning gradient (EdgeGlowView),
 *   the live caption, a voice wave along the footer, and Mute / Open Colon / Close. Tapping outside the footer or
 *   Close goes back to the pill.
 * Every window call is guarded: the user can revoke the permission at any time, and then nothing is shown.
 */
class VoiceOverlay(private val ctx: Context, private val actions: Actions) {
    interface Actions {
        fun end()
        fun mute(on: Boolean)
        fun openApp()
    }

    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val density = ctx.resources.displayMetrics.density
    private var phase = VoiceUiRules.Phase.LISTENING
    private var caption = ""
    private var muted = false
    private var pill: Pill? = null
    private var pillParams: WindowManager.LayoutParams? = null
    private var full: Full? = null

    private class Pill(val root: LinearLayout, val wave: VoiceWaveView, val text: TextView)
    private class Full(val root: FrameLayout, val glow: EdgeGlowView, val wave: VoiceWaveView, val label: TextView,
        val caption: TextView, val mute: TextView)

    private fun dp(v: Int) = (v * density).toInt()

    fun update(p: VoiceUiRules.Phase, text: String, isMuted: Boolean) {
        phase = p; caption = text; muted = isMuted
        pill?.let { paintPill(it) }
        full?.let { paintFull(it) }
    }

    /** Shows the pill (or keeps the expanded overlay if it is open); false when the window could not be added. */
    fun showPill(): Boolean {
        if (pill != null || full != null) return true
        val p = buildPill()
        val lp = params(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(8)
        }
        if (!add(p.root, lp)) return false
        pill = p; pillParams = lp; paintPill(p)
        return true
    }

    fun expand() {
        if (full != null) return
        val f = buildFull()
        val lp = params(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
        if (!add(f.root, lp)) return
        removePill()
        full = f; paintFull(f)
        if (animationsOn()) { f.root.alpha = 0f; f.root.animate().alpha(1f).setDuration(220).start() }
    }

    fun collapse() {
        val f = full ?: return
        full = null
        remove(f.root)
        showPill()
    }

    fun hideAll() {
        removePill()
        full?.let { remove(it.root) }; full = null
        main.removeCallbacksAndMessages(null)
    }

    val showing: Boolean get() = pill != null || full != null

    /* ---------- windows ---------- */

    private fun params(w: Int, h: Int): WindowManager.LayoutParams {
        val type = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else legacyType()
        val lp = WindowManager.LayoutParams(w, h, type, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT)
        if (Build.VERSION.SDK_INT >= 30) {
            lp.fitInsetsTypes = 0 // edge to edge: the glow runs round the whole screen, under the system bars
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        } else if (Build.VERSION.SDK_INT >= 28) {
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        lp.title = "Colon voice"
        return lp
    }

    /** Android 7: the pre-Oreo overlay type (SYSTEM_ALERT_WINDOW is granted at install there). */
    @Suppress("DEPRECATION")
    private fun legacyType() = WindowManager.LayoutParams.TYPE_PHONE

    private fun add(v: View, lp: WindowManager.LayoutParams): Boolean =
        try { wm.addView(v, lp); true } catch (_: Exception) { false } // permission revoked, or no window token

    private fun remove(v: View) { try { wm.removeView(v) } catch (_: Exception) { } }

    private fun removePill() { pill?.let { remove(it.root) }; pill = null; pillParams = null }

    /* ---------- the pill ---------- */

    private fun round(color: Int, radius: Float = 999f * density) = GradientDrawable().apply {
        cornerRadius = radius; setColor(color)
    }

    private fun buildPill(): Pill {
        val wave = VoiceWaveView(ctx).apply { bars = 5 }
        val text = TextView(ctx).apply {
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); maxLines = 1
            ellipsize = TextUtils.TruncateAt.END; maxWidth = dp(200)
        }
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = round(0xF2000000.toInt()); elevation = dp(6).toFloat()
            setPadding(dp(14), dp(8), dp(16), dp(8)); minimumHeight = dp(40)
            addView(wave, LinearLayout.LayoutParams(dp(30), dp(18)).apply { marginEnd = dp(10) })
            addView(text)
            isClickable = true; isLongClickable = true
            setOnClickListener { expand() }
            setOnLongClickListener { actions.end(); true }
        }
        ViewCompat.replaceAccessibilityAction(root, AccessibilityActionCompat.ACTION_LONG_CLICK,
            ctx.getString(R.string.voice_end)) { _, _ -> actions.end(); true }
        bindGestures(root)
        return Pill(root, wave, text)
    }

    /** Tap → performClick (expand); hold → performLongClick (end); swipe sideways or up → end. */
    @SuppressLint("ClickableViewAccessibility") // taps and holds go through performClick / performLongClick
    private fun bindGestures(v: View) {
        var x0 = 0f; var y0 = 0f; var t0 = 0L; var held = false
        val hold = Runnable { held = true; v.performLongClick() }
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    x0 = e.rawX; y0 = e.rawY; t0 = SystemClock.uptimeMillis(); held = false
                    main.postDelayed(hold, VoiceUiRules.LONG_PRESS_MS)
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - x0; val dy = e.rawY - y0; val dist = kotlin.math.hypot(dx, dy)
                    if (dist > VoiceUiRules.TAP_SLOP_DP * density) main.removeCallbacks(hold)
                    movePill(dx, minOf(0f, dy))
                    v.alpha = 1f - (dist / (VoiceUiRules.SWIPE_DP * density * 3)).coerceIn(0f, .6f)
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    main.removeCallbacks(hold)
                    val g = if (e.actionMasked == MotionEvent.ACTION_CANCEL || held) VoiceUiRules.Gesture.NONE
                        else VoiceUiRules.gesture(e.rawX - x0, e.rawY - y0, SystemClock.uptimeMillis() - t0, density)
                    movePill(0f, 0f); v.alpha = 1f
                    when (g) {
                        VoiceUiRules.Gesture.TAP -> v.performClick()
                        VoiceUiRules.Gesture.LONG_PRESS -> v.performLongClick()
                        VoiceUiRules.Gesture.SWIPE_END -> actions.end()
                        VoiceUiRules.Gesture.NONE -> Unit
                    }
                }
            }
            true
        }
    }

    /** Follows the finger (the pill window is only as big as the pill, so the window itself moves). */
    private fun movePill(dx: Float, dy: Float) {
        val p = pill ?: return
        val lp = pillParams ?: return
        lp.x = dx.toInt(); lp.y = dp(8) + dy.toInt()
        try { wm.updateViewLayout(p.root, lp) } catch (_: Exception) { }
    }

    private fun paintPill(p: Pill) {
        val label = ctx.getString(VoiceUiRules.labelRes(phase))
        p.text.text = label
        p.wave.setPhase(phase)
        p.root.contentDescription = ctx.getString(R.string.voice_pill_desc, label)
    }

    /* ---------- the expanded overlay ---------- */

    private fun button(text: String, color: Int, onClick: () -> Unit) = TextView(ctx).apply {
        this.text = text; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        gravity = Gravity.CENTER; minHeight = dp(48); minWidth = dp(48); setPadding(dp(18), 0, dp(18), 0)
        background = round(color); isClickable = true; isFocusable = true
        setOnClickListener { onClick() }
    }

    private fun buildFull(): Full {
        val glow = EdgeGlowView(ctx)
        val label = TextView(ctx).apply {
            setTextColor(0xCCFFFFFF.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); gravity = Gravity.CENTER
        }
        val caption = TextView(ctx).apply {
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f); gravity = Gravity.CENTER
            maxLines = 4; ellipsize = TextUtils.TruncateAt.START; setLineSpacing(0f, 1.15f)
        }
        val wave = VoiceWaveView(ctx).apply { bars = 32 }
        val mute = button(ctx.getString(R.string.voice_mute), 0x33FFFFFF) { actions.mute(!muted) }
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            val gap = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(6); marginEnd = dp(6) }
            addView(mute, gap)
            addView(button(ctx.getString(R.string.voice_open), 0xFF4169E1.toInt()) { actions.openApp() }, gap)
            addView(button(ctx.getString(R.string.voice_collapse), 0x33FFFFFF) { collapse() }.apply {
                contentDescription = ctx.getString(R.string.voice_collapse) }, gap)
        }
        val panel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            isClickable = true // touches on the footer never reach the scrim (which collapses)
            setPadding(dp(24), dp(24), dp(24), dp(24))
            addView(label, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(caption, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8); bottomMargin = dp(16) })
            addView(wave, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)))
            addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(16) })
        }
        val root = FrameLayout(ctx).apply {
            setBackgroundColor(0x99000000.toInt())
            isClickable = true
            setOnClickListener { collapse() }
            addView(glow, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT))
            addView(panel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        }
        // Keep the footer above the navigation bar (gesture handle or buttons).
        ViewCompat.setOnApplyWindowInsetsListener(panel) { v, insets ->
            val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            v.setPadding(dp(24), dp(24), dp(24), dp(24) + nav.bottom)
            insets
        }
        return Full(root, glow, wave, label, caption, mute)
    }

    private fun paintFull(f: Full) {
        f.label.text = ctx.getString(VoiceUiRules.labelRes(phase))
        f.caption.text = caption
        f.caption.visibility = if (caption.isEmpty()) View.INVISIBLE else View.VISIBLE
        f.wave.setPhase(phase); f.glow.setPhase(phase)
        f.mute.text = ctx.getString(if (muted) R.string.voice_unmute else R.string.voice_mute)
    }
}
