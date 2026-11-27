package ng.nifelux.colonai

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Colon JetX auto-bet (0.38.0, Crash Predictor step 5): the pure rules behind JetxAutobet and JetxBubble. No Android
 * types, unit-tested in JetxAutobetRulesTest.
 *
 * Order of every bet: a round is stored -> [mayAsk] (AI or Shared mode, not stopped) -> POST /crash/autobet (the API
 * allows only a BET verdict with every guardrail clear, and records the bet) -> Shared: the user confirms first ->
 * [mayClick] (a real-money decision, the app's own real-money switch on, still AI or Shared, not stopped): only then
 * is the click script asked to set the auto cash-out and press Bet. A demo bet is never clicked. Anything the click
 * script can't find, it leaves alone (fail closed) and the bet is reported void.
 */
object JetxAutobetRules {
    data class Decision(
        val allow: Boolean, val code: String, val reason: String, val stake: Double, val target: Double,
        val demo: Boolean, val betId: String?,
    )

    /**
     * What the side panel and the full-screen bubble show (GET /crash/live). 0.39.2: [chance] is null until the
     * engine has [minRounds] rounds ([rounds] so far); the bubble then shows "3/10 rounds", never the baseline.
     * 0.39.3: [guess] (JetxGuessRules), display only; no decision here reads it.
     */
    data class Live(
        val target: Double, val chance: Double?, val source: String, val action: String, val reason: String,
        val recent: List<Double>, val killSwitch: Boolean, val demo: Boolean, val rounds: Int = 0,
        val minRounds: Int = MIN_ROUNDS, val guess: JetxGuessRules.Guess? = null,
    )

    /** The user's own Bet press, as the read-only watcher saw it. */
    data class Manual(val stake: Double, val target: Double?, val at: Long)

    /** The click script's answer for one frame. */
    data class ClickReply(val nonce: String, val ok: Boolean, val reason: String, val bet: Boolean)

    /** Rounds the engine needs before it estimates anything (GET /crash/live estimate.min_rounds). */
    const val MIN_ROUNDS = 10
    const val CLICK_TIMEOUT_MS = 4_000L
    const val MAX_MANUAL_PER_MINUTE = 10
    private const val MAX_MESSAGE = 512
    private val REASON = Regex("^[a-z_]{1,32}$")
    private val NONCE = Regex("^[0-9]{1,20}$")

    fun mayAsk(mode: JetxRules.Mode, stopped: Boolean): Boolean = !stopped && mode != JetxRules.Mode.MANUAL

    /** The only gate in front of a click: everything must hold at once. */
    fun mayClick(d: Decision?, realMoneyOn: Boolean, mode: JetxRules.Mode, stopped: Boolean): Boolean =
        d != null && d.allow && !d.demo && d.betId != null && realMoneyOn && !stopped && mode != JetxRules.Mode.MANUAL

    /** The body of POST /crash/autobet. */
    fun askJson(mode: JetxRules.Mode, realMoneyOn: Boolean, dryRun: Boolean, ref: String, tzOffset: Int): String =
        JSONObject().put("control", mode.wire).put("real", realMoneyOn).put("dry_run", dryRun)
            .put("client_ref", ref).put("tz_offset", tzOffset).toString()

    fun parseDecision(json: String?): Decision? = try {
        val o = JSONObject(json ?: return null)
        val bet = o.optJSONObject("bet")
        Decision(o.getBoolean("allow"), o.optString("code"), o.optString("reason").take(400),
            o.optDouble("stake", 0.0), o.optDouble("target", 0.0), o.optBoolean("demo", true),
            bet?.optString("id")?.takeIf { NONCE.matches(it) })
    } catch (_: Exception) {
        null
    }

    /** The first message to the click script: are the Bet button and both fields there? It touches nothing. */
    fun probeJson(nonce: String): String = JSONObject().put("cmd", "probe").put("nonce", nonce).toString()

    /** The message to the click script: set the auto cash-out to [d].target, the stake, then press Bet. */
    fun clickJson(d: Decision): String = JSONObject().put("cmd", "bet").put("nonce", d.betId)
        .put("target", d.target).put("stake", d.stake).toString()

    /** A reply from the click script: { nonce, ok, reason, step: probe | bet }; a hello is not one (null). */
    fun parseClickReply(raw: String?): ClickReply? {
        if (raw == null || raw.length > MAX_MESSAGE) return null
        return try {
            val o = JSONObject(raw)
            val nonce = o.optString("nonce").takeIf { NONCE.matches(it) } ?: return null
            val reason = o.optString("reason", "ok").takeIf { REASON.matches(it) } ?: return null
            val step = o.optString("step", "probe").takeIf { it == "probe" || it == "bet" } ?: return null
            ClickReply(nonce, o.optBoolean("ok", false), reason, step == "bet")
        } catch (_: Exception) {
            null
        }
    }

    /** The click script's hello: `{"ready":true}` and nothing else. */
    fun isHello(raw: String?): Boolean = try {
        val o = JSONObject(raw ?: "")
        o.length() == 1 && o.optBoolean("ready", false)
    } catch (_: Exception) {
        false
    }

    /** The watcher's message: exactly { manual: { stake, target?, at } } from an https frame, sane values. */
    fun parseManual(raw: String?, origin: String?, nowMs: Long): Manual? {
        if (raw == null || raw.length > MAX_MESSAGE) return null
        if (origin == null || !origin.lowercase().startsWith("https://")) return null
        return try {
            val o = JSONObject(raw)
            if (o.length() != 1) return null
            val m = o.optJSONObject("manual") ?: return null
            if (m.keys().asSequence().any { it !in setOf("stake", "target", "at") }) return null
            val stake = (m.opt("stake") as? Number)?.toDouble() ?: return null
            if (stake.isNaN() || stake < 0.01 || stake > 1e7) return null
            val target = if (m.isNull("target")) null else JetxRoundRules.multiplier(m.opt("target")) ?: return null
            if (target != null && (target < 1.01 || target > 10_000.0)) return null
            val at = (m.opt("at") as? Number)?.toLong() ?: return null
            if (at < nowMs - 60_000L || at > nowMs + 60_000L) return null
            Manual(Math.round(stake * 100) / 100.0, target, at)
        } catch (_: Exception) {
            null
        }
    }

    /** The body of POST /crash/bets for a manual bet (source manual, real money: the user's own account). */
    fun manualJson(m: Manual, ref: String): String = JSONObject().put("source", "manual").put("mode", "real")
        .put("stake", m.stake).put("target", m.target ?: JSONObject.NULL).put("placed_at", m.at)
        .put("client_ref", ref).toString()

    /** The JS getTimezoneOffset() for the phone's offset from UTC [offsetMs] (Lagos: -60), for "today". */
    fun tzOffset(offsetMs: Int): Int = -offsetMs / 60_000

    /** The body of POST /crash/bets/:id/settle when the click did not happen. */
    fun voidJson(reason: String): String = JSONObject().put("outcome", "void")
        .put("reason", reason.takeIf { REASON.matches(it) } ?: "click_failed").toString()

    fun underLimit(recent: List<Long>, nowMs: Long, max: Int = MAX_MANUAL_PER_MINUTE): Boolean =
        recent.count { it > nowMs - 60_000L } < max

    fun parseLive(json: String?): Live? = try {
        val o = JSONObject(json ?: return null)
        val est = o.optJSONObject("estimate")
        val v = o.getJSONObject("verdict")
        val recent = o.optJSONArray("recent") ?: JSONArray()
        val chance = est?.takeIf { !it.isNull("chance") }?.optDouble("chance")?.takeIf { !it.isNaN() }
        Live(o.getDouble("target"), chance, est?.optString("source")?.takeIf { it.isNotEmpty() } ?: "collecting",
            v.optString("action", "WAIT"), v.optString("reason").take(600),
            (0 until minOf(recent.length(), 20)).mapNotNull { recent.optJSONObject(it)?.optDouble("multiplier") }
                .filter { !it.isNaN() }, o.optBoolean("kill_switch", false), o.optBoolean("demo_mode", true),
            est?.optInt("rounds", 0)?.coerceAtLeast(0) ?: 0,
            est?.optInt("min_rounds", MIN_ROUNDS)?.takeIf { it > 0 } ?: MIN_ROUNDS,
            JetxGuessRules.parse(o.optJSONObject("guess")))
    } catch (_: Exception) {
        null
    }

    /** "1.30x · 82.3% · BET", or "1.30x · 3/10 rounds · WAIT" while the engine has no estimate yet. */
    fun bubbleLine(l: Live): String =
        "${x2(l.target)} · ${middle(l)} · ${l.action}"

    /** The bubble's short lines (target, estimate or rounds collected, verdict; 0.39.3: "Guess 1.89–2.34x"). */
    fun bubbleLines(l: Live): String = "${x2(l.target)}\n${middle(l)}\n${l.action}" +
        (l.guess?.let { "\n" + JetxGuessRules.line(it) } ?: "")

    /** The engine's estimate, else "3/10 rounds": the baseline is never shown as if it were a prediction. */
    fun middle(l: Live): String = l.chance?.let { pct(it) }
        ?: if (l.rounds < l.minRounds) "${l.rounds}/${l.minRounds} rounds" else "no estimate"

    fun amount(v: Double): String = String.format(Locale.US, "%.2f", v)
    fun x2(m: Double): String = String.format(Locale.US, "%.2fx", m)
    fun pct(p: Double?): String = if (p == null) "—" else String.format(Locale.US, "%.1f%%", p * 100)

    /** Colour key for an action: BET green, WAIT amber, STOP (or anything else) red. */
    fun tone(action: String): String = when (action) {
        "BET" -> "green"
        "WAIT" -> "amber"
        else -> "red"
    }
}
