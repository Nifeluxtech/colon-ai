package ng.nifelux.colonai

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import okhttp3.OkHttpClient

/**
 * Colon JetX's round collector (0.35.0, Crash Predictor step 3, docs/crash-predictor/HANDOFF.md).
 *
 * The game pane gets assets/jetx/collector.js in every frame (JetX runs in the game provider's iframe) and the
 * window.ColonJetXRounds channel. The script is read-only: it watches JetX's round-history strip and posts
 * `{multiplier, seen_at, round_id?}` for each new finished round. The channel never answers, and every message is
 * checked here (JetxRoundRules.parse: https frames, those three keys, sane values, at most 20 a minute), because any
 * page in the game pane could post on it. Nothing else is read from the betting site: no cookies, passwords,
 * tokens, forms or storage.
 *
 * Rounds are batched and sent to POST /crash/rounds with the Colon session cookie, to the Colon API host only
 * (JetxApi.post). The API dedupes them and opens the collector's session; closing the app or turning the
 * collector off stops it (POST /crash/sessions). The predictor hears a 'collector' event after each change.
 * Since 0.35.1 the script also sends a diagnostic per frame (host and counts only, JetxRoundRules.parseDiag); the
 * latest per frame is kept and summed up in the event (frames_seen, strip_found, strip_items), with rounds_sent and
 * last_error, so the predictor can say whether the history strip was found; 0.35.2 adds counts of multiplier-like
 * texts, canvases and shadow hosts and up to 3 character-checked samples. The script is collector-find.js and
 * collector.js together (JetxRoundRules.script).
 * On WebViews without document-start scripts or web message listeners there is no collector (status unsupported).
 * 0.38.0: rounds read off the screen (JetxScreenReader, when the DOM strip is not found) come in through
 * [offerRounds] and go the same way; a new round is sent at once (not after 5 s) so the auto-bet and the bubble can
 * act before the next round, and [Host.onRoundsSaved] says when the API has it. The event adds `screen_reader`.
 */
class JetxCollector(private val host: Host, private val http: OkHttpClient, private val prefs: JetxPrefs) {
    interface Host {
        /** The collector's status changed: { on, status, rounds_today, last_multiplier } (JetxRoundRules.status). */
        fun onCollector(status: org.json.JSONObject)

        /** The API stored [inserted] new rounds (0.38.0: the auto-bet asks for its decision, the bubble refreshes). */
        fun onRoundsSaved(inserted: Int) {}
    }

    /** The screen reader's status for the event (0.38.0), set by JetxActivity. */
    var screenStatus: (() -> org.json.JSONObject)? = null

    private val main = Handler(Looper.getMainLooper())
    private val queue = ArrayDeque<JetxRoundRules.Round>()
    private val recent = ArrayDeque<Long>()
    private var state = JetxRoundRules.State.WAITING
    private var sending = false
    private var scheduled = false
    private var failures = 0
    private var sessionOpen = false
    private var roundsToday = 0
    private var day = JetxRoundRules.dayOf(System.currentTimeMillis())
    private var last: Double? = null
    private var roundsSent = 0
    private var lastError: String? = null
    private val diags = LinkedHashMap<String, Pair<JetxRoundRules.Diag, Long>>()
    private var lastSummary: JetxRoundRules.DiagSummary? = null
    private val flushNow = Runnable { scheduled = false; flush() }

    /** Adds the script and the channel to the game pane's WebView (each new one, as after a renderer crash). */
    fun install(webView: WebView?, script: String?) {
        if (webView == null || script == null) return
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            setState(JetxRoundRules.State.UNSUPPORTED)
            return
        }
        try {
            // "*": every frame of whatever site the user opens; parse() refuses anything that isn't a round.
            WebViewCompat.addWebMessageListener(webView, CHANNEL, setOf("*")) { _, message, origin, _, _ ->
                onMessage(message.data, origin.toString())
            }
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))
        } catch (e: Exception) {
            Log.w(TAG, "collector unavailable", e)
            setState(JetxRoundRules.State.UNSUPPORTED)
        }
    }

    fun status(): org.json.JSONObject {
        rollDay()
        val st = JetxRoundRules.status(prefs.collector, state, roundsToday, last, summary(), roundsSent, lastError)
        screenStatus?.let { st.put("screen_reader", it()) }
        return st
    }

    /** True while some frame's DOM collector sees the history strip (then the screen reader stays idle). */
    fun domStripFound(): Boolean = summary().stripFound

    /** Rounds read off the screen, oldest first (0.38.0): stamped now, the older ones 3 s apart, sent at once. */
    fun offerRounds(values: List<Double>) {
        if (!prefs.collector || values.isEmpty()) return
        val now = System.currentTimeMillis()
        values.forEachIndexed { i, m ->
            val v = JetxRoundRules.multiplier(m) ?: return@forEachIndexed
            if (queue.size >= JetxRoundRules.MAX_QUEUE) queue.removeFirst()
            queue.addLast(JetxRoundRules.Round(v, now - (values.size - 1 - i) * 3_000L, null))
            last = v
        }
        host.onCollector(status())
        schedule(0L)
    }

    /** The collector toggle (the predictor's switch). Off: pending rounds are dropped and the session stops. */
    fun setOn(on: Boolean) {
        if (on == prefs.collector) return
        prefs.collector = on
        if (!on) {
            queue.clear()
            main.removeCallbacks(flushNow)
            scheduled = false
            stopSession("collector_off")
        }
        if (state != JetxRoundRules.State.UNSUPPORTED) state = JetxRoundRules.State.WAITING
        host.onCollector(status())
    }

    /** The app is closing: send what is queued, then stop the session. */
    fun close() {
        main.removeCallbacks(flushNow)
        scheduled = false
        if (sending || queue.isEmpty()) stopSession("app_closed") else flush { stopSession("app_closed") }
    }

    private fun onMessage(raw: String?, origin: String) {
        if (!prefs.collector) return
        val now = System.currentTimeMillis()
        val round = JetxRoundRules.parse(raw, origin, now)
        if (round == null) { JetxRoundRules.parseDiag(raw, origin)?.let { onDiag(it, now) }; return }
        while (recent.isNotEmpty() && recent.first() <= now - 60_000L) recent.removeFirst()
        if (!JetxRoundRules.underLimit(recent.toList(), now)) return
        recent.addLast(now)
        if (queue.size >= JetxRoundRules.MAX_QUEUE) queue.removeFirst()
        queue.addLast(round)
        last = round.multiplier
        host.onCollector(status())
        schedule(0L) // 0.38.0: at once, so the decision for the next round can be made in time
    }

    /** Keeps each frame's latest diagnostic (at most MAX_FRAMES frames); tells the predictor when the sum changes. */
    private fun onDiag(d: JetxRoundRules.Diag, now: Long) {
        diags.remove(d.host)
        if (diags.size >= JetxRoundRules.MAX_FRAMES) diags.remove(diags.keys.first())
        diags[d.host] = d to now
        val sum = summary()
        if (sum != lastSummary) { lastSummary = sum; host.onCollector(status()) }
    }

    private fun summary(): JetxRoundRules.DiagSummary =
        JetxRoundRules.summarize(diags.values, System.currentTimeMillis())

    private fun schedule(delay: Long) {
        if (scheduled) return
        scheduled = true
        main.postDelayed(flushNow, delay)
    }

    private fun flush(then: (() -> Unit)? = null) {
        if (sending || queue.isEmpty() || !prefs.collector) { then?.invoke(); return }
        val batch = queue.take(JetxRoundRules.BATCH)
        sending = true
        JetxApi.post(http, "/crash/rounds", JetxRoundRules.batchJson(batch)) { code, body ->
            sending = false
            val outcome = if (code == -1) JetxRoundRules.Outcome.SIGNED_OUT else JetxRoundRules.outcome(code)
            lastError = if (code == -1) "signed_out" else JetxRoundRules.errorOf(code)
            when (outcome) {
                JetxRoundRules.Outcome.SENT -> {
                    drop(batch)
                    failures = 0
                    sessionOpen = true
                    rollDay()
                    val inserted = JetxRoundRules.inserted(body) ?: 0
                    roundsToday += inserted
                    roundsSent += batch.size
                    setState(JetxRoundRules.State.LIVE)
                    if (inserted > 0) host.onRoundsSaved(inserted)
                }
                JetxRoundRules.Outcome.DROP -> { drop(batch); setState(JetxRoundRules.State.ERROR) }
                JetxRoundRules.Outcome.SIGNED_OUT -> { failures++; setState(JetxRoundRules.State.SIGNED_OUT) }
                JetxRoundRules.Outcome.RETRY -> { failures++; setState(JetxRoundRules.State.ERROR) }
            }
            if (then != null) then() else if (queue.isNotEmpty()) schedule(JetxRoundRules.backoff(failures))
        }
    }

    /** Removes the rounds of [batch] from the queue (newer ones may have arrived meanwhile). */
    private fun drop(batch: List<JetxRoundRules.Round>) {
        batch.forEach { queue.remove(it) }
    }

    private fun stopSession(reason: String) {
        if (!sessionOpen) return
        sessionOpen = false
        val json = org.json.JSONObject().put("action", "stop").put("reason", reason).toString()
        JetxApi.post(http, "/crash/sessions", json) { _, _ -> }
    }

    private fun rollDay() {
        val today = JetxRoundRules.dayOf(System.currentTimeMillis())
        if (today != day) { day = today; roundsToday = 0; roundsSent = 0 }
    }

    private fun setState(s: JetxRoundRules.State) {
        state = s
        host.onCollector(status())
    }

    companion object {
        /** The object WebView puts in the game pane's frames; collector.js posts rounds on it and nothing else. */
        const val CHANNEL = "ColonJetXRounds"
        const val SCRIPT_ASSET = "jetx/collector.js"
        /** How the script finds the history strip (0.35.2); injected together with it (JetxRoundRules.script). */
        const val FIND_ASSET = "jetx/collector-find.js"
        private const val TAG = "ColonJetX"
    }
}
