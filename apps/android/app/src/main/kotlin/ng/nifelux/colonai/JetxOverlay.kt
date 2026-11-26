package ng.nifelux.colonai

import android.graphics.RectF
import android.webkit.WebView
import android.widget.FrameLayout
import okhttp3.OkHttpClient
import java.util.TimeZone

/**
 * Colon JetX's full-screen overlay (0.39.1), shown in the Game layout only (JetxRules.showsBubble), which is now
 * the layout the app opens on: the "what Colon sees" column on the left (JetxSeenColumn), the estimate bubble on
 * the right (JetxBubble) and Colon's pointer (JetxPointerTaps). The bubble's GET /crash/live feeds the column's
 * stored rounds and, while few rounds are stored, lets the pointer read JetX's history dropdown (at most every
 * 2 minutes). [stored] is the screen reader's view of the newest stored rounds for its catch-up.
 */
class JetxOverlay(
    private val a: JetxActivity,
    pane: FrameLayout,
    private val prefs: JetxPrefs,
    private val http: OkHttpClient,
    private val reader: JetxScreenReader,
    domStrip: () -> Boolean,
    game: () -> WebView?,
    onKill: () -> Unit,
) {
    private var shown = false
    private var manual = false
    val bubble = JetxBubble(a, pane, prefs, http, onKill) { live -> onLive(live) }
    val column = JetxSeenColumn(a, pane, prefs, reader, domStrip) { readNow() }
    val taps = JetxPointerTaps(a, pane, game, reader) { result -> onResult(result) }

    fun show(on: Boolean) {
        shown = on
        bubble.show(on)
        column.show(on)
    }

    fun refresh() = bubble.refresh()

    /** Colon's own overlays in the pane, which the screen reader must not read as the game's. */
    fun areas(): List<RectF> = bubble.areas() + listOfNotNull(column.area())

    /** The newest stored rounds (newest first), or null when the API can't say (signed out, offline). */
    fun stored(done: (List<Double>?) -> Unit) {
        val tz = JetxAutobetRules.tzOffset(TimeZone.getDefault().getOffset(System.currentTimeMillis()))
        JetxApi.get(http, "/crash/live?limit=20&tz_offset=$tz") { code, body ->
            done(if (code == 200) JetxAutobetRules.parseLive(body)?.recent else null)
        }
    }

    private fun onLive(live: JetxAutobetRules.Live) {
        column.setStored(live.recent)
        if (shown && prefs.collector && reader.lastChips >= JetxOcrRules.MIN_CHIPS) {
            taps.readHistory(false, live.recent.size)
        }
    }

    private fun readNow() {
        manual = true
        taps.readHistory(true, column.storedCount())
    }

    private fun onResult(result: String) {
        if (!manual || !result.startsWith("history_")) return
        manual = false
        a.toast(when {
            result == "history_wait" -> a.getString(R.string.jetx_history_wait)
            result.startsWith("history_read_") -> a.getString(R.string.jetx_history_read,
                result.removePrefix("history_read_").toIntOrNull() ?: 0)
            else -> a.getString(R.string.jetx_history_failed, result.removePrefix("history_").replace('_', ' '))
        })
    }

    fun close() {
        bubble.close()
        column.close()
        taps.close()
    }
}
