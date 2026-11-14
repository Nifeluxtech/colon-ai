package ng.nifelux.colonai

import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Matrix
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton

/**
 * 0.10.3: the controls laid over Colon AI's in-chat browser (view_saga_card.xml; ADR 0006). In the thread: the
 * floating status pill (Saga's step with a spinner, a check and the result, "Saga needs you" with Take control,
 * an error with Retry) and the expand button; the page is locked, so a tap on it opens full screen (view only).
 * Full screen: the slim top bar with the page's title and host, back and reload (only while the user has control),
 * Take control or Give back to Saga, more, and back to the chat. It renders whatever ChatBrowserPanel hands it.
 */
class ChatCard(content: FrameLayout, private val on: Actions) {
    interface Actions {
        fun expand()
        fun collapse()
        fun takeControl()
        fun giveBack()
        fun stop()
        fun retry()
        fun back()
        fun reload()
        fun menu(anchor: View)
    }

    private val ctx = content.context
    private val root: View = LayoutInflater.from(ctx).inflate(R.layout.view_saga_card, content, false)
    private val catcher: View = root.findViewById(R.id.card_catcher)
    private val bar: LinearLayout = root.findViewById(R.id.focus_bar)
    private val title: TextView = root.findViewById(R.id.focus_title)
    private val host: TextView = root.findViewById(R.id.focus_host)
    private val back: ImageButton = root.findViewById(R.id.focus_back)
    private val reload: ImageButton = root.findViewById(R.id.focus_reload)
    private val action: MaterialButton = root.findViewById(R.id.focus_action)
    private val pill: LinearLayout = root.findViewById(R.id.card_pill)
    private val spinner: ProgressBar = root.findViewById(R.id.pill_spinner)
    private val icon: ImageView = root.findViewById(R.id.pill_icon)
    private val text: TextView = root.findViewById(R.id.pill_text)
    private val pillAction: MaterialButton = root.findViewById(R.id.pill_action)
    private val stop: ImageButton = root.findViewById(R.id.pill_stop)
    private val expand: ImageButton = root.findViewById(R.id.card_expand)
    private var pillState: ChatRun.Pill? = null
    /** 0.10.4: the page's last picture, shown over the WebView until it has painted (never a blank white card). */
    private val picture = ImageView(ctx).apply {
        scaleType = ImageView.ScaleType.MATRIX
        visibility = View.GONE
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        setBackgroundColor(ContextCompat.getColor(ctx, R.color.colon_bg))
    }
    val words = ChatRun.Words(
        working = ctx.getString(R.string.card_working), paused = ctx.getString(R.string.card_paused),
        yourTurn = ctx.getString(R.string.card_your_turn), youControl = ctx.getString(R.string.card_you_control),
        done = ctx.getString(R.string.card_done), stopped = ctx.getString(R.string.card_stopped),
        failed = ctx.getString(R.string.card_failed), appClosed = ctx.getString(R.string.card_app_closed),
        appPaused = ctx.getString(R.string.card_app_paused), reconnecting = ctx.getString(R.string.card_reconnecting),
        // Colon Browser's words ("tap Return to AI") read as this card's button.
        needsYou = { m -> ctx.getString(R.string.card_needs_you, m.replace("tap Return to AI",
            "tap ${ctx.getString(R.string.card_give_back_short)}")) })

    init {
        content.addView(root, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT))
        (root as FrameLayout).addView(picture, 0, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT))
        picture.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> fitPicture() }
        catcher.setOnClickListener { on.expand() }
        expand.setOnClickListener { on.expand() }
        root.findViewById<View>(R.id.focus_close).setOnClickListener { on.collapse() }
        root.findViewById<View>(R.id.focus_more).setOnClickListener { on.menu(it) }
        back.setOnClickListener { on.back() }
        reload.setOnClickListener { on.reload() }
        stop.setOnClickListener { on.stop() }
    }

    /** 0.10.4: [bmp] stands in for the page until it has painted (null: the live page shows). */
    fun showPicture(bmp: Bitmap?) {
        if (bmp == null) { picture.visibility = View.GONE; picture.setImageDrawable(null); return }
        picture.setImageBitmap(bmp)
        picture.visibility = View.VISIBLE
        fitPicture()
    }

    /** The picture fills the card's width from the top, like the page it stands in for. */
    private fun fitPicture() {
        val d = picture.drawable ?: return
        val w = picture.width
        if (w <= 0 || d.intrinsicWidth <= 0) return
        val s = w.toFloat() / d.intrinsicWidth
        picture.imageMatrix = Matrix().apply { setScale(s, s) }
    }

    /**
     * [run] the chat's task; [full] full screen (else the card in the thread); [title] / [url] the page;
     * [canGoBack] the page has history. The page is the user's only in user_control. 0.10.4: [page] the browser
     * still has a web page (an ended card offers Continue); [linked] the link to the server is up.
     */
    fun render(run: ChatRun.Run, full: Boolean, pageTitle: String, url: String, canGoBack: Boolean, show: Boolean,
               page: Boolean = false, linked: Boolean = true) {
        root.visibility = if (show) View.VISIBLE else View.GONE
        val mine = ChatRun.touchesPage(run.state)
        // Locked page in the thread: a tap on it opens the full-screen view. Never over a page the user drives.
        catcher.visibility = if (!full && !mine) View.VISIBLE else View.GONE
        expand.visibility = if (full) View.GONE else View.VISIBLE
        bar.visibility = if (full) View.VISIBLE else View.GONE
        if (full) {
            val where = UrlRules.displayUrl(url)
            title.text = pageTitle.ifBlank { where }
            host.text = HandoffNote.pageOf(url) ?: where
            back.visibility = if (mine) View.VISIBLE else View.GONE
            back.isEnabled = canGoBack
            back.alpha = if (canGoBack) 1f else .38f
            reload.visibility = if (mine) View.VISIBLE else View.GONE
            val giving = mine
            action.text = ctx.getString(if (giving) R.string.card_give_back else R.string.take_control)
            action.contentDescription = action.text
            action.setOnClickListener { if (giving) on.giveBack() else on.takeControl() }
        }
        renderPill(ChatRun.pill(run, words, page, linked), full, mine)
    }

    private fun renderPill(p: ChatRun.Pill, full: Boolean, mine: Boolean) {
        // Full screen while the user drives: the top bar says it all; the pill would sit on the page they use.
        val hidden = p.icon == "none" || (full && mine)
        pill.visibility = if (hidden) View.GONE else View.VISIBLE
        if (hidden) { pillState = p; return }
        spinner.visibility = if (p.icon == "spinner") View.VISIBLE else View.GONE
        icon.visibility = if (p.icon == "spinner") View.GONE else View.VISIBLE
        icon.setImageResource(when (p.icon) {
            "check" -> R.drawable.ic_check
            "error" -> R.drawable.ic_error
            "pause" -> R.drawable.ic_pause
            else -> R.drawable.ic_hand
        })
        pill.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(ctx, when (p.icon) {
            "turn" -> R.color.colon_pill_turn
            "error" -> R.color.colon_pill_bad
            else -> R.color.colon_pill
        }))
        text.text = p.text
        val label = when {
            p.takeControl && !full -> R.string.take_control
            p.giveBack -> R.string.card_give_back_short
            p.cont -> R.string.card_continue
            p.retry -> R.string.card_retry
            else -> 0
        }
        pillAction.visibility = if (label != 0) View.VISIBLE else View.GONE
        if (label != 0) {
            pillAction.setText(label)
            pillAction.setOnClickListener {
                when (label) {
                    R.string.take_control -> on.takeControl()
                    R.string.card_give_back_short -> on.giveBack()
                    else -> on.retry()
                }
            }
        }
        stop.visibility = if (p.stop) View.VISIBLE else View.GONE
        // Screen readers hear the new line only when it changed (the pill is a polite live region).
        if (p != pillState) pill.contentDescription = p.text
        pillState = p
    }
}
