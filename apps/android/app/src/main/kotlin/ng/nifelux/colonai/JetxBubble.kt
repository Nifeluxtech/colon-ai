package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
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
 * Colon JetX's floating bubble (0.38.0) over the full-screen game (layout GAME, the Colon panel hidden): a small
 * round badge with the target, the engine's estimated chance that the next round reaches it, and the verdict, e.g.
 * "1.30x / 82.3% / BET", green for BET, amber for WAIT, red for STOP. The chance is the engine's estimate
 * (GET /crash/live), always labelled an estimate, never a guarantee; 0.39.2: until the engine has 10 rounds it shows
 * "1.30x / 3/10 rounds / WAIT" instead, never the 74.6% baseline as if it were a prediction. Drag it anywhere over the game (the spot is remembered); tap it
 * for a small card with the reason, the last recorded multipliers and the kill switch, tap again to close. It
 * refreshes after every stored round ([refresh], from JetxCollector) and every 15 s while shown. The collector and
 * the screen reader keep recording underneath it.
 * 0.39.1: it starts on the right edge (JetxRules.BUBBLE_X; a spot saved under 0.38.0 is dropped once, JetxPrefs),
 * the left edge being the "what Colon sees" column (JetxSeenColumn), which gets the 20 newest rounds ([onLive]).
 * 0.39.3: a fourth line "Guess 1.89–2.34x" (JetxGuessRules; the badge is a rounded 104 x 84 dp tile so it fits)
 * and, on the card, the big-round range, the measured "after a crash under 1.20x" line and the "not a prediction"
 * label, the previous -> next bucket table (the newest round's row tinted) and the reasoning (an AI read when one
 * answered). Display only: the verdict and auto-bet never read the guess.
 */
class JetxBubble(
    private val a: JetxActivity,
    private val pane: FrameLayout,
    private val prefs: JetxPrefs,
    private val http: OkHttpClient,
    private val onKill: () -> Unit,
    private val onLive: (JetxAutobetRules.Live) -> Unit = {},
) {
    private val main = Handler(Looper.getMainLooper())
    private val dp = a.resources.displayMetrics.density
    private val bubble = TextView(a)
    private val card = LinearLayout(a)
    private val head = TextView(a)
    private val reason = TextView(a)
    private val recent = TextView(a)
    private val guess = TextView(a)
    private val table = TextView(a)
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
        bubble.layoutParams = FrameLayout.LayoutParams((W_DP * dp).toInt(), (H_DP * dp).toInt(),
            Gravity.TOP or Gravity.START)
        bubble.gravity = Gravity.CENTER
        bubble.textSize = 10f
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
        listOf(head, reason, recent, guess, table, note).forEach {
            it.setTextColor(ContextCompat.getColor(a, R.color.jetx_text))
            it.textSize = 12f
            card.addView(it)
        }
        table.typeface = Typeface.MONOSPACE
        table.textSize = 9.5f
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
        JetxApi.get(http, "/crash/live?limit=20&tz_offset=$tz") { code, body ->
            if (code == 200) JetxAutobetRules.parseLive(body)?.let { live = it; onLive(it) }
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
            cornerRadius = 28 * dp
            setColor(ContextCompat.getColor(a, color))
            setStroke((2 * dp).toInt(), Color.argb(200, 255, 255, 255))
        }
        bubble.alpha = 0.92f
        head.text = JetxAutobetRules.bubbleLine(l)
        reason.text = l.reason
        recent.text = a.getString(R.string.jetx_bubble_recent,
            if (l.recent.isEmpty()) "—" else l.recent.take(8).joinToString("  ") { JetxAutobetRules.x2(it) })
        guess.text = l.guess?.let { JetxGuessRules.detail(it) }
            ?: a.getString(R.string.jetx_bubble_guess_none)
        table.text = l.guess?.transitions?.let { tableText(it) } ?: ""
        table.visibility = if (table.text.isEmpty()) View.GONE else View.VISIBLE
        note.text = when {
            l.chance == null && l.rounds < l.minRounds -> a.getString(R.string.jetx_bubble_note_collecting, l.minRounds)
            l.chance == null -> a.getString(R.string.jetx_bubble_note_none)
            l.source == "rule" -> a.getString(R.string.jetx_bubble_note_rule)
            else -> a.getString(R.string.jetx_bubble_note)
        }
        val stopped = prefs.stopped || l.killSwitch
        kill.text = a.getString(if (stopped) R.string.jetx_bubble_stopped else R.string.jetx_bubble_kill)
        kill.isEnabled = !stopped
    }

    /** The previous -> next bucket table, the newest round's row tinted green. */
    private fun tableText(t: JetxGuessRules.Transitions): CharSequence {
        val (lines, mark) = JetxGuessRules.tableRows(t)
        val out = SpannableStringBuilder()
        lines.forEachIndexed { i, line ->
            val start = out.length
            out.append(line)
            if (i == mark) {
                out.setSpan(BackgroundColorSpan(Color.argb(60, 34, 197, 94)), start, out.length,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                out.setSpan(ForegroundColorSpan(ContextCompat.getColor(a, R.color.jetx_green)), start, out.length,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            if (i < lines.size - 1) out.append('\n')
        }
        return out
    }

    private fun place() {
        val (x, y) = JetxRules.bubbleSpot(prefs.bubbleX, prefs.bubbleY)
        bubble.x = (x * (pane.width - W_DP * dp)).coerceAtLeast(0f)
        bubble.y = (y * (pane.height - H_DP * dp)).coerceAtLeast(0f)
        placeCard()
    }

    /** The card opens beside the bubble, on whichever side has room, kept inside the pane. */
    private fun placeCard() {
        val cw = CARD_DP * dp
        val right = bubble.x + W_DP * dp + 6 * dp
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
                        v.x = (startX + dx).coerceIn(0f, maxOf(0f, pane.width - W_DP * dp))
                        v.y = (startY + dy).coerceIn(0f, maxOf(0f, pane.height - H_DP * dp))
                        if (expanded) placeCard()
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (dragging) {
                        val w = W_DP * dp
                        val h = H_DP * dp
                        prefs.bubbleX = if (pane.width > w) v.x / (pane.width - w) else 0f
                        prefs.bubbleY = if (pane.height > h) v.y / (pane.height - h) else 0f
                    } else {
                        v.performClick()
                    }
                    true
                }
                else -> false
            }
        }
    }

    /** Where the bubble (and its open card) is in the pane, for the screen reader to skip; empty while hidden. */
    fun areas(): List<RectF> {
        if (!shown) return emptyList()
        val out = mutableListOf(RectF(bubble.x, bubble.y, bubble.x + W_DP * dp, bubble.y + H_DP * dp))
        if (expanded) out += RectF(card.x, card.y, card.x + card.width, card.y + card.height)
        return out
    }

    fun close() = main.removeCallbacks(poll)

    private companion object {
        const val W_DP = 104
        const val H_DP = 84
        const val CARD_DP = 280
        const val POLL_MS = 15_000L
    }
}
