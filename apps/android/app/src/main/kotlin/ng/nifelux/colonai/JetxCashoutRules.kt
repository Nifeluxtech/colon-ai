package ng.nifelux.colonai

import org.json.JSONObject
import java.util.Locale

/**
 * Colon JetX 0.39.4: the cash-out line on the bubble and its card (GET /crash/live `cashout`), in place of 0.39.3's
 * guessed range. The server's analysis engine estimates, for candidate multipliers 1.05x..10x, the chance that the
 * next round reaches each (measured rounds eased toward 0.97 / m, or a rule's hit rate on rounds it had not seen);
 * [Cashout.at] is the highest one from 1.10x at [Cashout.minChance] (75%) or more: "Cash out at 1.20x · 75%+".
 * Otherwise "Don't bet · not sure enough", and "3/10 rounds" until there are 10. Pure, tested in
 * JetxCashoutRulesTest. Display only: auto-bet uses the user's own target and never reads it.
 */
object JetxCashoutRules {
    data class Cashout(
        val at: Double?, val chance: Double?, val source: String, val minChance: Double, val rounds: Int,
        val minRounds: Int,
    )

    const val NOT_SURE = "Don’t bet · not sure enough"

    private fun num(o: JSONObject, k: String): Double? =
        o.takeIf { it.has(k) && !it.isNull(k) }?.optDouble(k)?.takeIf { !it.isNaN() && !it.isInfinite() }

    /** The `cashout` object of GET /crash/live, or null (absent, null or malformed). */
    fun parse(o: JSONObject?): Cashout? {
        if (o == null) return null
        val source = o.optString("source").takeIf { it in SOURCES } ?: return null
        val min = num(o, "min_chance")?.takeIf { it > 0 && it <= 1 } ?: 0.75
        val at = num(o, "at")?.takeIf { it >= 1.0 && source != "collecting" && source != "bad_data" }
        return Cashout(at, num(o, "chance")?.takeIf { it in 0.0..1.0 }, source, min,
            o.optInt("rounds", 0).coerceAtLeast(0), o.optInt("min_rounds", 10).takeIf { it > 0 } ?: 10)
    }

    /** "Cash out at 1.20x · 75%+", "Don't bet · not sure enough" or "3/10 rounds". */
    fun line(c: Cashout): String = when {
        c.source == "collecting" -> "${minOf(c.rounds, c.minRounds)}/${c.minRounds} rounds"
        c.at != null -> String.format(Locale.US, "Cash out at %.2fx · %d%%+", c.at, pct0(c.minChance))
        else -> NOT_SURE
    }

    /** The badge's lines: the line split at " · " so it fits the tile ("Cash out at 1.20x" / "75%+"). */
    fun badgeLines(c: Cashout): String = line(c).replace(" · ", "\n")

    /** The card's text: the line, where the estimate came from, and that it is not a guarantee. */
    fun detail(c: Cashout): String {
        val head = line(c)
        val why = when {
            c.source == "collecting" -> "A cash-out appears after ${c.minRounds} recorded rounds."
            c.source == "bad_data" -> "The recorded rounds do not fit the published odds, so Colon gives no cash-out."
            c.at != null -> "Estimated ${pct(c.chance)} that the next round reaches " +
                String.format(Locale.US, "%.2fx", c.at) + " (${from(c.source)})."
            else -> "No cash-out from 1.10x has an estimated ${pct0(c.minChance)}% or more" +
                (c.chance?.let { " (1.10x: ${pct(it)})" } ?: "") + "."
        }
        return "$head\n$why Each round is independent: an estimate, not a guarantee. Auto-bet keeps your target."
    }

    private fun from(source: String) = if (source == "rule") "a rule's hit rate on rounds it had not seen"
    else "your recorded rounds eased toward the published odds"

    private fun pct0(p: Double): Int = Math.round(p * 100).toInt()
    private fun pct(p: Double?): String = if (p == null) "—" else String.format(Locale.US, "%.1f%%", p * 100)

    private val SOURCES = setOf("measured", "rule", "baseline", "collecting", "bad_data")
}
