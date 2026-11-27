package ng.nifelux.colonai

import android.graphics.Color
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Colon JetX (0.39.1), full-screen game only: a slim, see-through column on the left edge of the game listing the
 * multipliers Colon currently sees, newest at the top (JetxOverlayRules colours: under 2x blue-grey, under 10x
 * purple, 10x and up gold). It shows the screen reader's latest stable read live (before anything is stored),
 * followed by the stored rounds (GET /crash/live, through the bubble), lined up without doubles
 * (JetxSeqRules.merge). A dot on top says reading (green), no chips (amber) or off (grey). It sits under the
 * history strip and above the Bet panel. Tap it to fold it to a thin tab, tap the tab to open it again (remembered,
 * JetxPrefs.seenFolded). "Read" at its foot asks the pointer to open JetX's history dropdown and read it.
 */
class JetxSeenColumn(
    private val a: JetxActivity,
    private val pane: FrameLayout,
    private val prefs: JetxPrefs,
    private val reader: JetxScreenReader,
    private val domStrip: () -> Boolean,
    private val onReadHistory: () -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val dp = a.resources.displayMetrics.density
    private val box = LinearLayout(a)
    private val head = TextView(a)
    private val list = LinearLayout(a)
    private val read = TextView(a)
    private val rows = ArrayList<TextView>()
    private var stored: List<Double> = emptyList()
    private var shown = false
    private val tick = object : Runnable {
        override fun run() {
            if (!shown) return
            render()
            main.postDelayed(this, 1_000L)
        }
    }

    init {
        box.orientation = LinearLayout.VERTICAL
        box.elevation = 6 * dp
        box.background = GradientDrawable().apply {
            cornerRadii = floatArrayOf(0f, 0f, 10 * dp, 10 * dp, 10 * dp, 10 * dp, 0f, 0f)
            setColor(Color.argb(150, 5, 11, 8))
        }
        box.setPadding((4 * dp).toInt(), (4 * dp).toInt(), (4 * dp).toInt(), (4 * dp).toInt())
        head.textSize = 9f
        head.gravity = Gravity.CENTER
        head.setTextColor(Color.WHITE)
        box.addView(head, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT))
        list.orientation = LinearLayout.VERTICAL
        box.addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        repeat(JetxOverlayRules.MAX_ROWS) {
            val t = TextView(a)
            t.textSize = 10.5f
            t.gravity = Gravity.CENTER
            t.setTypeface(t.typeface, Typeface.BOLD)
            t.setPadding(0, (1 * dp).toInt(), 0, (1 * dp).toInt())
            rows += t
            list.addView(t)
        }
        read.text = a.getString(R.string.jetx_seen_read)
        read.textSize = 9f
        read.gravity = Gravity.CENTER
        read.setTextColor(Color.rgb(34, 197, 94))
        read.contentDescription = a.getString(R.string.jetx_seen_read_desc)
        read.setPadding(0, (4 * dp).toInt(), 0, (2 * dp).toInt())
        read.setOnClickListener { onReadHistory() }
        box.addView(read)
        box.setOnClickListener { prefs.seenFolded = !prefs.seenFolded; render() }
        box.visibility = View.GONE
        pane.addView(box, FrameLayout.LayoutParams((WIDTH_DP * dp).toInt(), 100, Gravity.TOP or Gravity.START))
        pane.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> if (shown) place() }
    }

    fun show(on: Boolean) {
        if (on == shown) return
        shown = on
        box.visibility = if (on) View.VISIBLE else View.GONE
        main.removeCallbacks(tick)
        if (on) { pane.post { place(); render() }; main.post(tick) }
    }

    /** The newest stored rounds (newest first), from GET /crash/live. */
    fun setStored(recent: List<Double>) {
        stored = recent
        if (shown) render()
    }

    /** How many rounds the API returned last (the pointer's "few rounds" check). */
    fun storedCount(): Int = stored.size

    private fun place() {
        val (top, bottom) = JetxOverlayRules.band(reader.stripBottom)
        val lp = box.layoutParams as FrameLayout.LayoutParams
        val h = pane.height
        if (h <= 0) return
        val folded = prefs.seenFolded
        val w = ((if (folded) FOLDED_DP else WIDTH_DP) * dp).toInt()
        val t = (top * h).toInt()
        val hh = if (folded) (56 * dp).toInt() else ((bottom - top) * h).toInt()
        if (lp.topMargin != t || lp.height != hh || lp.width != w) {
            lp.topMargin = t; lp.height = hh; lp.width = w; box.layoutParams = lp
        }
    }

    private fun render() {
        val now = System.currentTimeMillis()
        val status = JetxOverlayRules.status(prefs.collector, domStrip(), reader.lastChips, reader.lastReadAt, now)
        val dotColor = when (status) {
            JetxOverlayRules.Status.READING -> Color.rgb(34, 197, 94)
            JetxOverlayRules.Status.NO_CHIPS -> Color.rgb(245, 158, 11)
            JetxOverlayRules.Status.OFF -> Color.rgb(138, 165, 151)
        }
        val folded = prefs.seenFolded
        head.text = if (folded) "\u25cf" else "\u25cf ${status.wire}"
        head.setTextColor(dotColor)
        list.visibility = if (folded) View.GONE else View.VISIBLE
        read.visibility = if (folded) View.GONE else View.VISIBLE
        box.contentDescription = a.getString(if (folded) R.string.jetx_seen_open else R.string.jetx_seen_desc,
            status.wire)
        val live = if (JetxOverlayRules.liveFresh(reader.liveAt, now)) reader.live else null
        val values = JetxSeqRules.merge(live, stored, JetxOverlayRules.MAX_ROWS)
        rows.forEachIndexed { i, t ->
            val m = values.getOrNull(i)
            t.visibility = if (m == null) View.INVISIBLE else View.VISIBLE
            if (m != null) {
                t.text = JetxOverlayRules.label(m)
                t.setTextColor(when (JetxOverlayRules.tone(m)) {
                    JetxOverlayRules.Tone.LOW -> Color.rgb(159, 179, 200)
                    JetxOverlayRules.Tone.MID -> Color.rgb(192, 132, 252)
                    JetxOverlayRules.Tone.HIGH -> Color.rgb(250, 204, 21)
                })
            }
        }
        place()
    }

    /** Where the column is in the pane (its words are not the game's), or null while hidden. */
    fun area(): RectF? = if (!shown) null else RectF(box.left.toFloat(), box.top.toFloat(), box.right.toFloat(),
        box.bottom.toFloat())

    fun close() = main.removeCallbacks(tick)

    private companion object {
        const val WIDTH_DP = 60
        const val FOLDED_DP = 14
    }
}
