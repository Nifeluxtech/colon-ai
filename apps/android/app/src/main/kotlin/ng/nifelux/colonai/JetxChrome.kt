package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.content.res.ColorStateList
import android.view.MotionEvent
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * Colon JetX's native chrome (activity_jetx.xml, 0.34.0): the address bar, the betting site's status dot, the
 * mode banner, the mode and layout chips and the draggable divider. Display only; JetxActivity owns the state.
 * 0.38.0: the side-by-side layout (jetx_panes turns horizontal, game left and the Colon panel right, the divider
 * bar moves below both) and the STOP chip (the auto-bet's kill switch, shown in AI and Shared modes or while
 * stopped).
 */
class JetxChrome(private val a: JetxActivity) {
    val address: EditText = a.findViewById(R.id.jetx_address)
    val gamePane: FrameLayout = a.findViewById(R.id.jetx_game)
    val predictorPane: FrameLayout = a.findViewById(R.id.jetx_predictor)
    val modeChips: Map<JetxRules.Mode, TextView> = mapOf(
        JetxRules.Mode.MANUAL to a.findViewById(R.id.jetx_mode_manual),
        JetxRules.Mode.AI to a.findViewById(R.id.jetx_mode_ai),
        JetxRules.Mode.SHARED to a.findViewById(R.id.jetx_mode_shared))
    val layoutChip: TextView = a.findViewById(R.id.jetx_layout)
    val stopChip: TextView = a.findViewById(R.id.jetx_stop)
    private val root: LinearLayout = a.findViewById(R.id.jetx_root)
    private val panes: LinearLayout = a.findViewById(R.id.jetx_panes)
    private val divider: View = a.findViewById(R.id.jetx_divider)
    private var side = false
    val status: View = a.findViewById(R.id.jetx_status)
    private val progress: ProgressBar = a.findViewById(R.id.jetx_progress)
    private val banner: TextView = a.findViewById(R.id.jetx_banner)
    private val gameEmpty: TextView = a.findViewById(R.id.jetx_game_empty)
    private val dot: View = a.findViewById(R.id.jetx_dot)
    private val statusText: TextView = a.findViewById(R.id.jetx_status_text)

    /** The game pane's share of the height right now (split view). */
    var split = JetxRules.SPLIT_DEFAULT
        private set

    /** What the status dot says, for a tap on it (screen readers read the same). */
    val statusLabel: String get() = statusText.contentDescription?.toString().orEmpty()

    fun showSite(state: JetxRules.Site, site: String?) {
        gameEmpty.visibility = if (site == null) View.VISIBLE else View.GONE
        val (label, color) = when (state) {
            JetxRules.Site.NONE -> R.string.jetx_site_none to R.color.jetx_muted
            JetxRules.Site.LOADING -> R.string.jetx_site_loading to R.color.jetx_warn
            JetxRules.Site.LOADED -> R.string.jetx_site_loaded to R.color.jetx_green
            JetxRules.Site.ERROR -> R.string.jetx_site_error to R.color.jetx_bad
            JetxRules.Site.OFFLINE -> R.string.jetx_site_offline to R.color.jetx_bad
        }
        val text = a.getString(label)
        statusText.text = JetxRules.hostOf(site)?.takeIf { state == JetxRules.Site.LOADED } ?: text
        statusText.contentDescription = a.getString(R.string.jetx_site_status, text)
        dot.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(a, color))
    }

    fun showProgress(p: Int) {
        progress.progress = p
        progress.visibility = if (p in 1..99) View.VISIBLE else View.GONE
    }

    fun showMode(mode: JetxRules.Mode) {
        modeChips.forEach { (m, v) -> chip(v, m == mode) }
        banner.text = when (JetxRules.bannerFor(mode)) {
            "ai" -> a.getString(R.string.jetx_banner_ai)
            "shared" -> a.getString(R.string.jetx_banner_shared)
            else -> ""
        }
        banner.visibility = if (banner.text.isEmpty()) View.GONE else View.VISIBLE
    }

    /** The kill switch chip: visible in AI and Shared modes, and whenever auto-betting is stopped. */
    fun showStop(mode: JetxRules.Mode, stopped: Boolean) {
        stopChip.visibility = if (stopped || mode != JetxRules.Mode.MANUAL) View.VISIBLE else View.GONE
        stopChip.text = a.getString(if (stopped) R.string.jetx_stopped else R.string.jetx_stop)
        stopChip.contentDescription = a.getString(if (stopped) R.string.jetx_resume_desc else R.string.jetx_stop_desc)
        stopChip.setTextColor(ContextCompat.getColor(a, if (stopped) R.color.jetx_muted else R.color.jetx_bad))
    }

    /** Hides a pane in the full layouts (its WebView stays alive, so nothing reloads) and sets the split. */
    fun showLayout(layout: JetxRules.Layout, savedSplit: Float, sideSplit: Float = JetxRules.SIDE_DEFAULT) {
        arrange(layout == JetxRules.Layout.SIDE)
        gamePane.visibility = if (layout == JetxRules.Layout.PREDICTOR) View.GONE else View.VISIBLE
        predictorPane.visibility = if (layout == JetxRules.Layout.GAME) View.GONE else View.VISIBLE
        applySplit(when (layout) {
            JetxRules.Layout.SPLIT -> savedSplit
            JetxRules.Layout.SIDE -> sideSplit
            else -> 0.5f
        })
        val name = a.getString(when (layout) {
            JetxRules.Layout.SPLIT -> R.string.jetx_layout_split
            JetxRules.Layout.SIDE -> R.string.jetx_layout_side
            JetxRules.Layout.GAME -> R.string.jetx_layout_game
            JetxRules.Layout.PREDICTOR -> R.string.jetx_layout_predictor
        })
        layoutChip.text = name
        layoutChip.contentDescription = a.getString(R.string.jetx_layout_button, name)
        chip(layoutChip, layout != JetxRules.Layout.SPLIT)
    }

    /** The divider: dragging it (split view only) moves the panes' weights; [done] gets the share on release. */
    @SuppressLint("ClickableViewAccessibility")
    fun wireDivider(isSplit: () -> Boolean, done: (Float) -> Unit) {
        a.findViewById<View>(R.id.jetx_handle).setOnTouchListener { _, e ->
            if (!isSplit()) return@setOnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> true
                MotionEvent.ACTION_MOVE, MotionEvent.ACTION_UP -> {
                    val top = IntArray(2).also { gamePane.getLocationOnScreen(it) }[1]
                    val total = (gamePane.height + predictorPane.height).toFloat()
                    applySplit(JetxRules.splitAt(e.rawY - top, total))
                    if (e.actionMasked == MotionEvent.ACTION_UP) done(split)
                    true
                }
                else -> false
            }
        }
    }

    /** Side by side: panes horizontal and the divider bar under them; otherwise the divider sits between the panes.
     *  Only the divider bar moves; the panes (and their WebViews) stay where they are. */
    private fun arrange(sideBySide: Boolean) {
        if (sideBySide == side) return
        side = sideBySide
        (divider.parent as? android.view.ViewGroup)?.removeView(divider)
        panes.orientation = if (side) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        if (side) root.addView(divider) else panes.addView(divider, panes.indexOfChild(gamePane) + 1)
        for (p in listOf(gamePane, predictorPane)) {
            val lp = p.layoutParams as LinearLayout.LayoutParams
            lp.width = if (side) 0 else LinearLayout.LayoutParams.MATCH_PARENT
            lp.height = if (side) LinearLayout.LayoutParams.MATCH_PARENT else 0
            p.layoutParams = lp
        }
    }

    /** Weights: a hidden pane takes no space, so the other one fills it. */
    private fun applySplit(f: Float) {
        split = JetxRules.clampSplit(f)
        (gamePane.layoutParams as LinearLayout.LayoutParams).weight = split
        (predictorPane.layoutParams as LinearLayout.LayoutParams).weight = 1f - split
        gamePane.requestLayout()
    }

    private fun chip(v: TextView, on: Boolean) {
        v.backgroundTintList = if (on) ColorStateList.valueOf(ContextCompat.getColor(a, R.color.jetx_green_dim))
        else null
        v.setTextColor(ContextCompat.getColor(a, if (on) R.color.jetx_green else R.color.jetx_text))
        v.isSelected = on
    }
}
