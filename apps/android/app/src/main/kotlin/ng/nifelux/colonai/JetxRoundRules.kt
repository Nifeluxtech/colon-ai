package ng.nifelux.colonai

import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone

/**
 * Colon JetX's round collector (0.35.0, Crash Predictor step 3): the pure rules behind JetxCollector. No Android
 * types, unit-tested in JetxRoundRulesTest.
 *
 * The game pane's injected script (assets/jetx/collector.js) sends `{multiplier, seen_at, round_id?}` for each new
 * finished JetX round. Any page in the game pane could post on that channel, so every message is treated as
 * untrusted: it must be small, come from an https frame, carry only those three keys with sane values, and the
 * page may not send more than [MAX_PER_MINUTE] rounds a minute. Nothing else from the page is ever accepted.
 */
object JetxRoundRules {
    data class Round(val multiplier: Double, val seenAt: Long, val roundId: String?)

    /** What the collector is doing, as the predictor's 'collector' event says it. */
    enum class State(val wire: String) {
        OFF("off"), WAITING("waiting"), LIVE("live"), SIGNED_OUT("signed_out"), ERROR("error"),
        UNSUPPORTED("unsupported");
    }

    const val MAX_MESSAGE = 512
    const val MAX_PER_MINUTE = 20
    const val BATCH = 50
    const val MAX_QUEUE = 500
    const val FLUSH_MS = 5_000L
    const val MAX_BACKOFF_MS = 5 * 60_000L
    private const val PAST_MS = 10 * 60_000L
    private const val FUTURE_MS = 60_000L
    private val KEYS = setOf("multiplier", "seen_at", "round_id")
    private val ID = Regex("^[A-Za-z0-9_.:-]{1,64}$")

    /** One message from the game pane -> a round, or null when anything about it is off. */
    fun parse(raw: String?, origin: String?, nowMs: Long): Round? {
        if (raw == null || raw.length > MAX_MESSAGE) return null
        if (origin == null || !origin.lowercase().startsWith("https://")) return null
        val o = try { JSONObject(raw) } catch (_: Exception) { return null }
        val keys = o.keys().asSequence().toList()
        if (keys.any { it !in KEYS }) return null
        val m = multiplier(o.opt("multiplier")) ?: return null
        val seen = (o.opt("seen_at") as? Number)?.toLong() ?: return null
        if (seen < nowMs - PAST_MS || seen > nowMs + FUTURE_MS) return null
        val id = if (o.isNull("round_id")) null else o.optString("round_id").trim().takeIf { ID.matches(it) }
        if (!o.isNull("round_id") && id == null) return null
        return Round(m, seen, id)
    }

    /** 1.00x to 1,000,000x with at most two decimals (the API's rule, modules/crash/rounds.js). */
    fun multiplier(v: Any?): Double? {
        val d = (v as? Number)?.toDouble() ?: return null
        if (d.isNaN() || d < 1.0 || d > 1_000_000.0) return null
        val cents = Math.round(d * 100)
        if (Math.abs(cents - d * 100) > 1e-6) return null
        return cents / 100.0
    }

    /** True when one more round may be taken: fewer than [MAX_PER_MINUTE] in the minute before [nowMs]. */
    fun underLimit(recent: List<Long>, nowMs: Long): Boolean = recent.count { it > nowMs - 60_000L } < MAX_PER_MINUTE

    /** The body of POST /crash/rounds. */
    fun batchJson(rounds: List<Round>): String {
        val list = JSONArray()
        rounds.forEach { r ->
            val o = JSONObject().put("multiplier", r.multiplier).put("seen_at", r.seenAt)
            r.roundId?.let { o.put("round_id", it) }
            list.put(o)
        }
        return JSONObject().put("source", "collector").put("rounds", list).toString()
    }

    /** "inserted" from the API's answer; null when the answer isn't one. */
    fun inserted(json: String?): Int? = try {
        val o = JSONObject(json ?: return null)
        if (o.has("inserted")) o.getInt("inserted") else null
    } catch (_: Exception) {
        null
    }

    /** Wait before the next try after [failures] failed sends in a row: 5 s, 10 s, 20 s ... up to 5 minutes. */
    fun backoff(failures: Int): Long =
        if (failures <= 0) FLUSH_MS else minOf(MAX_BACKOFF_MS, FLUSH_MS shl minOf(failures, 10))

    /** What to do with a batch after the API answered [code]: sent (2xx), dropped (a bad batch), or kept to retry. */
    enum class Outcome { SENT, DROP, RETRY, SIGNED_OUT }

    fun outcome(code: Int): Outcome = when {
        code in 200..299 -> Outcome.SENT
        code == 401 || code == 403 -> Outcome.SIGNED_OUT
        code == 408 || code == 429 || code >= 500 || code <= 0 -> Outcome.RETRY
        else -> Outcome.DROP // 400, 413, 422: the batch itself is wrong, so sending it again can't help
    }

    /** The local day of [ms], so "rounds today" starts again at midnight on the phone. */
    fun dayOf(ms: Long, tz: TimeZone = TimeZone.getDefault()): Long =
        (ms + tz.getOffset(ms)).floorDiv(86_400_000L)

    /** The 'collector' event: { on, status, rounds_today, last_multiplier }. */
    fun status(on: Boolean, state: State, roundsToday: Int, last: Double?): JSONObject = JSONObject()
        .put("on", on)
        .put("status", if (on) state.wire else State.OFF.wire)
        .put("rounds_today", roundsToday)
        .put("last_multiplier", last ?: JSONObject.NULL)
}
