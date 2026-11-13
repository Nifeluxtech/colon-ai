package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import androidx.appcompat.widget.AppCompatTextView
import androidx.core.content.ContextCompat

/**
 * 0.10.2: what Saga is doing or asking, as a pill at the top of the page in "AI + me" ("Clicking Sign in", "Need
 * your OTP: type it here, then tap Return to AI"). It slides in, stays a moment (longer when Saga asks the user for
 * something) and fades by itself; a new line replaces the old one. It never takes a touch, so the page under it
 * stays usable, and screen readers announce it (polite live region). BrowserSaga shows it for each command's `say`,
 * each hand-off to the user and the server's `notice` frames; NoticeRules decides when and for how long.
 */
@SuppressLint("ViewConstructor")
class SagaNotice(context: Context) : AppCompatTextView(context) {
    private val dp = resources.displayMetrics.density
    private val hideLater = Runnable { dismiss() }

    init {
        isClickable = false
        isFocusable = false
        maxLines = 2
        ellipsize = TextUtils.TruncateAt.END
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setTextColor(ContextCompat.getColor(context, android.R.color.white))
        val pad = (14 * dp).toInt()
        setPadding(pad, (8 * dp).toInt(), pad, (8 * dp).toInt())
        background = GradientDrawable().apply {
            cornerRadius = 999 * dp
            setColor(ContextCompat.getColor(context, R.color.colon_primary))
            alpha = 236
        }
        elevation = 6 * dp
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        alpha = 0f
        visibility = View.GONE
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent?): Boolean = false
    override fun dispatchTouchEvent(event: MotionEvent?): Boolean = false

    /** Where it sits in the page's frame: top centre, clear of the page's edges. */
    fun placement(): FrameLayout.LayoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
        val side = (16 * dp).toInt()
        setMargins(side, (10 * dp).toInt(), side, 0)
    }

    /** Shows [text] for NoticeRules.durationMs([kind]), replacing whatever was shown. */
    fun show(text: String, kind: String) {
        removeCallbacks(hideLater)
        this.text = text
        // Cancelled first: a fade-out still running would otherwise hide the new line when it ends.
        animate().cancel()
        visibility = View.VISIBLE
        if (alpha < 1f) {
            translationY = -8 * dp
            animate().alpha(1f).translationY(0f).setDuration(FADE_MS).start()
        }
        postDelayed(hideLater, NoticeRules.durationMs(kind))
    }

    /** Fades out now (Saga lost control, or the line's time is up). */
    fun dismiss() {
        removeCallbacks(hideLater)
        if (visibility != View.VISIBLE) return
        animate().cancel()
        animate().alpha(0f).setDuration(FADE_MS).withEndAction { visibility = View.GONE }.start()
    }

    companion object {
        const val FADE_MS = 180L
    }
}

/** When Saga's notices show and for how long (pure, unit-tested in SagaTouchTest). */
object NoticeRules {
    const val STEP_MS = 2600L
    const val DONE_MS = 4000L
    const val ASK_MS = 7000L

    fun durationMs(kind: String): Long = when (kind) {
        "ask" -> ASK_MS
        "done" -> DONE_MS
        else -> STEP_MS
    }

    /** Only in "AI + me": the running task's mode, the mode Return to AI goes back to, or the chat's own mode. In
     *  "AI only" the control bar already says what Saga is doing. */
    fun shows(mode: ControlState.Mode, resumable: ControlState.Mode?, chatShared: Boolean): Boolean =
        mode == ControlState.Mode.SHARED || resumable == ControlState.Mode.SHARED ||
            (chatShared && mode == ControlState.Mode.MANUAL)

    /** The pill's text: Saga's own words, one line (BridgeProtocol.line). */
    fun text(say: String?): String? = BridgeProtocol.line(say, BridgeProtocol.MAX_SAY)
}
