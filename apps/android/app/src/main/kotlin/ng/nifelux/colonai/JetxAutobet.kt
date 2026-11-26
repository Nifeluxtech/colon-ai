package ng.nifelux.colonai

import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.TimeZone

/**
 * Colon JetX auto-bet (0.37.0, Crash Predictor step 5, docs/crash-predictor/HANDOFF.md).
 *
 * After each round the API stored ([onRoundsSaved]), in AI or Shared mode only, it asks POST /crash/autobet. The API
 * allows only a BET verdict with every guardrail clear and records the bet itself (demo or real), so a decision
 * that is never clicked still counts against the limits. Shared mode asks first with a dry run and shows a one-tap
 * prompt; only the confirm records the bet.
 *  - Demo (the default): nothing is clicked. The API settles the bet against the next collected round.
 *  - Real money: only when the account left demo mode on the web AND the user turned this app's real-money switch
 *    on after its warning ([setRealMoney]). Then the isolated click script (assets/jetx/autobet-click.js) is asked
 *    to probe every frame of the game pane; the first frame that has the Bet button, the auto cash-out and the stake
 *    fields is told to set them and press Bet, once. Nothing found (a canvas game): nothing is clicked and the bet
 *    is reported void (fail closed). JetxAutobetRules.mayClick is the gate, checked again right before the click.
 *  - The kill switch ([stop]) stops at once on the phone and turns the account's kill switch on (POST
 *    /crash/autobet/stop); [resume] lifts only the phone's stop (the account's is lifted in Settings).
 * The read-only watcher (assets/jetx/manual-watch.js) reports the user's own Bet taps: stake, auto cash-out target
 * and time only, sent as source manual (POST /crash/bets). Passwords, cookies and tokens are never read.
 */
class JetxAutobet(
    private val a: JetxActivity,
    private val http: OkHttpClient,
    private val prefs: JetxPrefs,
    private val onStatus: (JSONObject) -> Unit,
) {
    private class Click(val nonce: String, val decision: JetxAutobetRules.Decision) {
        var sent = false
        var reason: String? = null
    }

    private val main = Handler(Looper.getMainLooper())
    private val frames = ArrayList<JavaScriptReplyProxy>()
    private val manualTimes = ArrayList<Long>()
    private var asking = false
    private var click: Click? = null
    private var line = ""
    private var dialog: AlertDialog? = null

    /** The click script, the manual watcher and their two channels go into the game pane's WebView. */
    fun install(webView: WebView?, clickScript: String?, watchScript: String?) {
        if (webView == null) return
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        try {
            frames.clear()
            if (clickScript != null) {
                WebViewCompat.addWebMessageListener(webView, BET_CHANNEL, setOf("*")) { _, msg, origin, _, reply ->
                    onBetMessage(msg.data, origin.toString(), reply)
                }
                WebViewCompat.addDocumentStartJavaScript(webView, clickScript, setOf("*"))
            }
            if (watchScript != null) {
                WebViewCompat.addWebMessageListener(webView, MANUAL_CHANNEL, setOf("*")) { _, msg, origin, _, _ ->
                    onManual(msg.data, origin.toString())
                }
                WebViewCompat.addDocumentStartJavaScript(webView, watchScript, setOf("*"))
            }
        } catch (e: Exception) {
            Log.w(TAG, "auto-bet scripts unavailable", e)
        }
    }

    fun status(): JSONObject = JSONObject()
        .put("mode", prefs.mode.wire)
        .put("real_money", prefs.realMoney)
        .put("stopped", prefs.stopped)
        .put("frames", frames.size)
        .put("line", line)

    /** A round was stored: ask for the next round's decision (AI or Shared only). */
    fun onRoundsSaved() {
        if (!JetxAutobetRules.mayAsk(prefs.mode, prefs.stopped) || asking || click != null) return
        val shared = prefs.mode == JetxRules.Mode.SHARED
        asking = true
        ask(dryRun = shared) { d ->
            when {
                d == null -> done(a.getString(R.string.jetx_auto_no_answer))
                !d.allow -> done(a.getString(R.string.jetx_auto_refused, d.reason))
                shared -> confirm(d)
                else -> placed(d)
            }
        }
    }

    private fun ask(dryRun: Boolean, then: (JetxAutobetRules.Decision?) -> Unit) {
        val now = System.currentTimeMillis()
        val ref = "a$now${(Math.random() * 1000).toInt()}"
        val body = JetxAutobetRules.askJson(prefs.mode, prefs.realMoney, dryRun, ref,
            JetxAutobetRules.tzOffset(TimeZone.getDefault().getOffset(now)))
        JetxApi.post(http, "/crash/autobet", body) { code, text ->
            then(if (code == 200) JetxAutobetRules.parseDecision(text) else null)
        }
    }

    /** Shared mode: one tap to bet, or skip; the prompt closes itself before the round starts. */
    private fun confirm(d: JetxAutobetRules.Decision) {
        if (a.isFinishing || a.isDestroyed) { done(""); return }
        val kind = a.getString(if (d.demo) R.string.jetx_auto_demo else R.string.jetx_auto_real)
        val msg = a.getString(R.string.jetx_auto_confirm, kind, JetxAutobetRules.x2(d.target),
            JetxAutobetRules.amount(d.stake), d.reason)
        var answered = false
        dialog = AlertDialog.Builder(a)
            .setTitle(R.string.jetx_auto_confirm_title)
            .setMessage(msg)
            .setPositiveButton(R.string.jetx_auto_bet) { _, _ ->
                answered = true
                if (!JetxAutobetRules.mayAsk(prefs.mode, prefs.stopped)) { done(""); return@setPositiveButton }
                ask(dryRun = false) { d2 ->
                    if (d2 == null || !d2.allow) done(a.getString(R.string.jetx_auto_refused, d2?.reason ?: "—"))
                    else placed(d2)
                }
            }
            .setNegativeButton(R.string.jetx_auto_skip) { _, _ ->
                answered = true
                done(a.getString(R.string.jetx_auto_skipped))
            }
            .setOnDismissListener { if (!answered) done(a.getString(R.string.jetx_auto_skipped)) }
            .show()
        main.postDelayed({ dialog?.takeIf { it.isShowing && !answered }?.dismiss() }, CONFIRM_MS)
    }

    /** The API recorded the bet. Demo: that's all. Real: the click, only if every rule still allows it. */
    private fun placed(d: JetxAutobetRules.Decision) {
        if (d.demo) { done(a.getString(R.string.jetx_auto_demo_bet,
            JetxAutobetRules.amount(d.stake), JetxAutobetRules.x2(d.target))); return }
        if (!JetxAutobetRules.mayClick(d, prefs.realMoney, prefs.mode, prefs.stopped)) {
            d.betId?.let { void(it, "not_allowed") }
            done(a.getString(R.string.jetx_auto_not_clicked))
            return
        }
        val c = Click(d.betId ?: return, d)
        click = c
        val probe = JetxAutobetRules.probeJson(c.nonce)
        frames.toList().forEach { f -> try { f.postMessage(probe) } catch (_: Exception) { frames.remove(f) } }
        main.postDelayed({
            if (click === c && !c.sent) { click = null; void(c.nonce, c.reason ?: "no_bet_button") }
        }, PROBE_MS)
        asking = false
    }

    private fun onBetMessage(raw: String?, origin: String, reply: JavaScriptReplyProxy) {
        if (!origin.lowercase().startsWith("https://")) return
        if (JetxAutobetRules.isHello(raw)) {
            if (frames.size >= MAX_FRAMES) frames.removeAt(0)
            frames += reply
            return
        }
        val r = JetxAutobetRules.parseClickReply(raw) ?: return
        val c = click ?: return
        if (r.nonce != c.nonce) return
        if (!r.bet) {
            if (c.sent) return
            if (!r.ok) { if (c.reason == null || c.reason == "no_bet_button") c.reason = r.reason; return }
            if (!JetxAutobetRules.mayClick(c.decision, prefs.realMoney, prefs.mode, prefs.stopped)) {
                click = null; void(c.nonce, "stopped"); return
            }
            c.sent = true
            try { reply.postMessage(JetxAutobetRules.clickJson(c.decision)) } catch (_: Exception) { }
            main.postDelayed({
                if (click === c) { click = null; report(a.getString(R.string.jetx_auto_no_reply)) }
            }, JetxAutobetRules.CLICK_TIMEOUT_MS)
            return
        }
        click = null
        if (r.ok) report(a.getString(R.string.jetx_auto_real_bet, JetxAutobetRules.amount(c.decision.stake),
            JetxAutobetRules.x2(c.decision.target)))
        else void(c.nonce, r.reason)
    }

    /** The click didn't happen: the recorded bet is void (stake back), with a short reason. */
    private fun void(betId: String, reason: String) {
        JetxApi.post(http, "/crash/bets/$betId/settle", JetxAutobetRules.voidJson(reason)) { _, _ -> }
        report(a.getString(R.string.jetx_auto_failed, reason))
    }

    private fun onManual(raw: String?, origin: String) {
        val now = System.currentTimeMillis()
        val m = JetxAutobetRules.parseManual(raw, origin, now) ?: return
        manualTimes.removeAll { it <= now - 60_000L }
        if (!JetxAutobetRules.underLimit(manualTimes, now)) return
        manualTimes += now
        JetxApi.post(http, "/crash/bets", JetxAutobetRules.manualJson(m, "m${m.at}")) { code, _ ->
            if (code == 200) report(a.getString(R.string.jetx_auto_manual, JetxAutobetRules.amount(m.stake)))
        }
    }

    /** The kill switch: stops on the phone at once and turns the account's kill switch on. */
    fun stop() {
        prefs.stopped = true
        click = null
        dialog?.dismiss()
        JetxApi.post(http, "/crash/autobet/stop", "{}") { _, _ -> }
        report(a.getString(R.string.jetx_auto_stopped))
    }

    fun resume() {
        prefs.stopped = false
        report(a.getString(R.string.jetx_auto_resumed))
    }

    /** The app's own real-money switch: on only after the warning (no guaranteed predictions, ~3% average loss per
     *  bet, auto-clicking may breach the operator's terms). [done] gets the switch's new state. */
    fun setRealMoney(on: Boolean, done: (Boolean) -> Unit) {
        if (!on) { prefs.realMoney = false; report(""); done(false); return }
        if (a.isFinishing || a.isDestroyed) { done(prefs.realMoney); return }
        var answered = false
        AlertDialog.Builder(a)
            .setTitle(R.string.jetx_real_title)
            .setMessage(R.string.jetx_real_warning)
            .setPositiveButton(R.string.jetx_real_accept) { _, _ ->
                answered = true; prefs.realMoney = true; report(""); done(true)
            }
            .setNegativeButton(android.R.string.cancel) { _, _ -> answered = true; done(false) }
            .setOnDismissListener { if (!answered) done(false) }
            .show()
    }

    private fun done(text: String) {
        asking = false
        report(text)
    }

    private fun report(text: String) {
        if (text.isNotEmpty()) line = text.take(300)
        onStatus(status())
    }

    fun close() {
        dialog?.dismiss()
        main.removeCallbacksAndMessages(null)
    }

    companion object {
        /** The click script's channel: hello and probe / bet replies in, probe / bet commands out. */
        const val BET_CHANNEL = "ColonJetXBet"
        /** The manual watcher's channel: { manual: { stake, target, at } } in, never answered. */
        const val MANUAL_CHANNEL = "ColonJetXManual"
        const val FIND_ASSET = "jetx/bet-find.js"
        const val CLICK_ASSET = "jetx/autobet-click.js"
        const val WATCH_ASSET = "jetx/manual-watch.js"
        private const val PROBE_MS = 1_500L
        private const val CONFIRM_MS = 8_000L
        private const val MAX_FRAMES = 20
        private const val TAG = "ColonJetX"

        /** bet-find.js and one of the two scripts in one function (no page globals), or null. */
        fun script(find: String?, main: String?): String? =
            if (find == null || main == null) null else "(function () {\n$find\n$main\n})();\n"
    }
}
