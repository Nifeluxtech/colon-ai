package ng.nifelux.colonai

import org.json.JSONObject
import java.util.Locale

/**
 * Colon JetX 0.39.3: the guessed multiplier range shown on the bubble and its card (GET /crash/live `guess`).
 * Pure, unit-tested in JetxGuessRulesTest. Display only: nothing here is read by the verdict or by auto-bet
 * (JetxAutobet asks POST /crash/autobet, which never sees the guess).
 *  - range: the 25th to 75th percentile of the last 30 rounds ("Guess 1.89–2.34x"), a guess, not a prediction;
 *  - big: the 90th to 97th percentile and how often rounds reached it ("about 1 in 10");
 *  - after: measured over all stored rounds, how many rounds after a round in the newest round's bucket reached 2x,
 *    next to all rounds ("After a crash under 1.20x: 41 of 88 reached 2x (47%) · all rounds 48%"); may be null.
 */
object JetxGuessRules {
    data class After(
        val label: String, val samples: Int, val reached: Int, val rate: Double, val allRate: Double,
    )

    data class Guess(
        val low: Double, val high: Double, val bigLow: Double, val bigHigh: Double, val bigChance: String,
        val rounds: Int, val label: String, val after: After?,
    )

    private fun num(o: JSONObject?, k: String): Double? =
        o?.takeIf { it.has(k) && !it.isNull(k) }?.optDouble(k)?.takeIf { !it.isNaN() && !it.isInfinite() }

    /** The `guess` object of GET /crash/live, or null (absent, null, or malformed). */
    fun parse(o: JSONObject?): Guess? {
        if (o == null) return null
        val range = o.optJSONObject("range") ?: return null
        val big = o.optJSONObject("big") ?: return null
        val low = num(range, "low") ?: return null
        val high = num(range, "high") ?: return null
        val bigLow = num(big, "low") ?: return null
        val bigHigh = num(big, "high") ?: return null
        val rounds = o.optInt("rounds_used", 0)
        val label = o.optString("label").take(120).ifEmpty { "Guess from last $rounds rounds, not a prediction" }
        return Guess(low, high, bigLow, bigHigh, o.optString("big_chance").take(40), rounds, label,
            parseAfter(o.optJSONObject("after_last")))
    }

    fun parseAfter(a: JSONObject?): After? {
        if (a == null) return null
        val samples = a.optInt("samples", 0)
        val reached = a.optInt("reached_2x", -1)
        val rate = num(a, "rate") ?: return null
        val all = num(a, "all_rate") ?: return null
        val label = a.optString("bucket_label").take(40)
        if (samples <= 0 || reached < 0 || label.isEmpty()) return null
        return After(label, samples, reached, rate, all)
    }

    private fun x2(v: Double) = String.format(Locale.US, "%.2f", v)
    private fun pc0(r: Double) = String.format(Locale.US, "%d%%", Math.round(r * 100))

    /** The bubble's line: "Guess 1.89–2.34x". */
    fun line(g: Guess): String = "Guess ${x2(g.low)}–${x2(g.high)}x"

    /** "Big round 19.45–23.44x (about 1 in 10)". */
    fun bigLine(g: Guess): String =
        "Big round ${x2(g.bigLow)}–${x2(g.bigHigh)}x" + if (g.bigChance.isEmpty()) "" else " (${g.bigChance})"

    /** "After a crash under 1.20x: 41 of 88 reached 2x (47%) · all rounds 48%". */
    fun afterLine(a: After): String = "After a crash ${a.label}: ${a.reached} of ${a.samples} reached 2x " +
        "(${pc0(a.rate)}) · all rounds ${pc0(a.allRate)}"

    /** The card's lines: guess, big range, the measured line when there is one, and the label. */
    fun detail(g: Guess): String = listOfNotNull(line(g), bigLine(g), g.after?.let { afterLine(it) },
        "${g.label}. It does not change BET / WAIT / STOP.").joinToString("\n")
}
