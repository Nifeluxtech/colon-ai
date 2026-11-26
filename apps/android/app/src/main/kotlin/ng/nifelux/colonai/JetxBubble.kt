package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import java.util.TimeZone

/**
 * Colon JetX's floating bubble (0.37.0) over the full-screen game (layout GAME, the Colon panel hidden): a small
 * round badge with the target, the engine's estimated chance that the next round reaches it, and the verdict, e.g.
 * "1.30x / 74.6% / WAIT", green for BET, amber for WAIT, red for STOP. The chance is the chosen rule's hit rate on
 * unseen rounds when the verdict is BET, else the published-odds baseline 0.97 / target (GET /crash/live), and is
 * always labelled an estimate, never a guarantee. Drag it anywhere over the game (the spot is remembered); tap it
 * for a small card with the reason, the last recorded multipliers and the kill switch, tap again to close. It
 * refreshes after every stored round ([refresh], from JetxCollector) and every 15 s while shown. The collector and
 * the screen reader keep recording underneath it.
 */
class JetxBubble(
    private val a: JetxActivity,
    private val pane: FrameLayout,
    private val prefs: JetxPrefs,
    private val http: OkHttpClient,
    private val onKill: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val dp = a.resources.displayMetrics.density
    private val bubble = TextView(a)
    private val card = LinearLayout(a)
    private val head = TextView(a)
    private val reason = TextView(a)
    private val recent = TextView(a)
    private val note = TextView(a)
    private val kill = Button(a)
    private var live: JetxAutobetRules.Live? = null
    private var shown = false
    private var expanded = false
    private val poll = object : Runnable {
        override fun run() {
            if (!shown) return
            refresh()
            main.postDelayed(this, POLL_MS)
        }
    }

    init {
        val size = (SIZE_DP * dp).toInt()
        bubble.layoutParams = FrameLayout.LayoutParams(size, size, Gravity.TOP or Gravity.START)
        bubble.gravity = Gravity.CENTER
        bubble.textSize = 10.5f
        bubble.setTypeface(bubble.typeface, Typeface.BOLD)
        bubble.setTextColor(Color.WHITE)
        bubble.elevation = 8 * dp
        bubble.text = a.getString(R.string.jetx_bubble_loading)
        bubble.visibility = View.GONE
        card.orientation = LinearLayout.VERTICAL
        card.layoutParams = FrameLayout.LayoutParams((CARD_DP * dp).toInt(), FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP or Gravity.START)
        val pad = (12 * dp).toInt()
        card.setPadding(pad, pad, pad, pad)
        card.elevation = 10 * dp
        card.background = GradientDrawable().apply {
            cornerRadius = 14 * dp
            setColor(ContextCompat.getColor(a, R.color.jetx_surface))
            setStroke((1 * dp).toInt(), ContextCompat.getColor(a, R.color.jetx_line))
        }
        listOf(head, reason, recent, note).forEach {
            it.setTextColor(ContextCompat.getColor(a, R.color.jetx_text))
            it.textSize = 12f
            card.addView(it)
        }
        head.setTypeface(head.typeface, Typeface.BOLD)
        head.textSize = 14f
        note.setTextColor(ContextCompat.getColor(a, R.color.jetx_muted))
        note.textSize = 11f
        kill.setOnClickListener { onKill(); render() }
        card.addView(kill)
        card.visibility = View.GONE
        pane.addView(card)
        pane.addView(bubble)
        wireDrag()
    }

    /** Shown in the full-screen game layout only. */
    fun show(on: Boolean) {
        if (on == shown) return
        shown = on
        bubble.visibility = if (on) View.VISIBLE else View.GONE
        if (!on) { expanded = false; card.visibility = View.GONE; main.removeCallbacks(poll); return }
        pane.post { place() }
        main.removeCallbacks(poll)
        main.post(poll)
    }

    /** New data (a round was stored, or the poll): GET /crash/live. */
    fun refresh() {
        if (!shown) return
        val tz = JetxAutobetRules.tzOffset(TimeZone.getDefault().getOffset(System.currentTimeMillis()))
        JetxApi.get(http, "/crash/live?limit=8&tz_offset=$tz") { code, body ->
            if (code == 200) JetxAutobetRules.parseLive(body)?.let { live = it }
            else if (code == -1) bubble.text = a.getString(R.string.jetx_bubble_signin)
            render()
        }
    }

    private fun render() {
        val l = live ?: return
        bubble.text = JetxAutobetRules.bubbleLines(l)
        bubble.contentDescription = a.getString(R.string.jetx_bubble_desc, JetxAutobetRules.bubbleLine(l))
        val color = when (JetxAutobetRules.tone(l.action)) {
            "green" -> R.color.jetx_green
            "amber" -> R.color.jetx_warn
            else -> R.color.jetx_bad
        }
        bubble.background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(ContextCompat.getColor(a, color))
            setStroke((2 * dp).toInt(), Color.argb(200, 255, 255, 255))
        }
        bubble.alpha = 0.92f
        head.text = JetxAutobetRules.bubbleLine(l)
        reason.text = l.reason
        recent.text = a.getString(R.string.jetx_bubble_recent,
            if (l.recent.isEmpty()) "—" else l.recent.take(8).joinToString("  ") { JetxAutobetRules.x2(it) })
        note.text = a.getString(if (l.source == "rule") R.string.jetx_bubble_note_rule else R.string.jetx_bubble_note)
        val stopped = prefs.stopped || l.killSwitch
        kill.text = a.getString(if (stopped) R.string.jetx_bubble_stopped else R.string.jetx_bubble_kill)
        kill.isEnabled = !stopped
    }

    private fun place() {
        val (x, y) = JetxRules.bubbleSpot(prefs.bubbleX, prefs.bubbleY)
        val size = SIZE_DP * dp
        bubble.x = (x * (pane.width - size)).coerceAtLeast(0f)
        bubble.y = (y * (pane.height - size)).coerceAtLeast(0f)
        placeCard()
    }

    /** The card opens beside the bubble, on whichever side has room, kept inside the pane. */
    private fun placeCard() {
        val cw = CARD_DP * dp
        val size = SIZE_DP * dp
        val right = bubble.x + size + 6 * dp
        card.x = if (right + cw <= pane.width) right else (bubble.x - cw - 6 * dp).coerceAtLeast(0f)
        card.y = bubble.y.coerceAtMost((pane.height - card.height).toFloat().coerceAtLeast(0f))
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun wireDrag() {
        val slop = ViewConfiguration.get(a).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var startX = 0f
        var startY = 0f
        var dragging = false
        bubble.setOnClickListener {
            expanded = !expanded
            card.visibility = if (expanded) View.VISIBLE else View.GONE
            if (expanded) { render(); card.post { placeCard() } }
        }
        bubble.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = v.x; startY = v.y; dragging = false; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!dragging && dx * dx + dy * dy > slop * slop) dragging = true
                    if (dragging) {
                        val size = SIZE_DP * dp
                        v.x = (startX + dx).coerceIn(0f, maxOf(0f, pane.width - size))
                        v.y = (startY + dy).coerceIn(0f, maxOf(0f, pane.height - size))
                        if (expanded) placeCard()
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (dragging) {
                        val size = SIZE_DP * dp
                        prefs.bubbleX = if (pane.width > size) v.x / (pane.width - size) else 0f
                        prefs.bubbleY = if (pane.height > size) v.y / (pane.height - size) else 0f
                    } else {
                        v.performClick()
                    }
                    true
                }
                else -> false
            }
        }
    }

    fun close() = main.removeCallbacks(poll)

    private companion object {
        const val SIZE_DP = 76
        const val CARD_DP = 240
        const val POLL_MS = 15_000L
    }
}
