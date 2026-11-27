package ng.nifelux.colonai

import org.json.JSONObject
import java.util.Locale

/**
 * Colon JetX 0.39.3: the guessed multiplier range shown on the bubble and its card (GET /crash/live `guess`).
 * Pure, unit-tested in JetxGuessRulesTest. Display only: nothing here is read by the verdict or by auto-bet
 * (JetxAutobet asks POST /crash/autobet, which never sees the guess).
 *  - range: the narrowest interval of the last 30 rounds at a coverage level tuned on replay so about 7 of 10 next
 *    rounds fell inside ("Guess 1.89–2.34x"; card: "Range tuned to hold about 7 of 10 rounds (held 68% of the last
 *    100)"), a guess, not a prediction;
 *  - mean, median and the share reaching 1.5x / 2x / 5x / 10x of the last 30 rounds, beside the 0.97 / m odds;
 *  - big: the 90th to 97th percentile and how often rounds reached it ("about 1 in 10");
 *  - after: measured over all stored rounds, how many rounds after a round in the newest round's bucket reached 2x,
 *    next to all rounds ("After a crash under 1.20x: 41 of 88 reached 2x (47%) · all rounds 48%"); may be null;
 *  - transitions: the 4 x 4 previous -> next bucket table (row %), shown monospaced with the newest round's row
 *    marked ([tableRows]); reasoning: one or two plain lines on how the guess was made, or [Why]: an AI model's
 *    short read of the same numbers (labelled "AI read · guess, not a prediction"), the template when none.
 */
object JetxGuessRules {
    data class After(
        val label: String, val samples: Int, val reached: Int, val rate: Double, val allRate: Double,
    )

    data class Reach(val at: Double, val share: Double, val baseline: Double)

    /** rowPct[i][j]: share of rounds after bucket i that fell in bucket j (null for an empty row). */
    data class Transitions(
        val labels: List<String>, val rowPct: List<List<Double?>>, val totals: List<Int>, val current: Int?,
    )

    data class Guess(
        val low: Double, val high: Double, val bigLow: Double, val bigHigh: Double, val bigChance: String,
        val rounds: Int, val label: String, val after: After?, val coverageTarget: Double? = null,
        val coverageMeasured: Double? = null, val samples: Int = 0, val mean: Double? = null,
        val median: Double? = null, val reach: List<Reach> = emptyList(), val transitions: Transitions? = null,
        val reasoning: String = "", val why: Why? = null,
    )

    /** guess.ai_reasoning: the AI read ([ai] true, label "AI read · guess, not a prediction") or the template. */
    data class Why(val text: String, val label: String, val ai: Boolean)

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
        val reach = o.optJSONArray("reach")
        val levels = (0 until minOf(reach?.length() ?: 0, 8)).mapNotNull { i ->
            val r = reach?.optJSONObject(i)
            val at = num(r, "at")
            val share = num(r, "share")
            val base = num(r, "baseline")
            if (at == null || share == null || base == null) null else Reach(at, share, base)
        }
        return Guess(low, high, bigLow, bigHigh, o.optString("big_chance").take(40), rounds, label,
            parseAfter(o.optJSONObject("after_last")), num(o, "coverage_target"), num(o, "coverage_measured"),
            o.optInt("samples", 0), num(o, "mean"), num(o, "median"), levels,
            parseTransitions(o.optJSONObject("transitions")), o.optString("reasoning").take(400),
            parseWhy(o.optJSONObject("ai_reasoning")))
    }

    fun parseWhy(w: JSONObject?): Why? {
        if (w == null) return null
        val text = w.optString("text").trim().take(700).takeIf { it.isNotEmpty() } ?: return null
        val ai = w.optString("source") == "ai"
        val label = w.optString("label").take(60).ifEmpty { if (ai) AI_LABEL else "How the guess was made" }
        return Why(text, label, ai)
    }

    const val AI_LABEL = "AI read · guess, not a prediction"

    /** The reasoning lines for the card: the AI read with its label when there is one, else the template text. */
    fun whyLines(g: Guess): String? = g.why?.let { "${it.label}\n${it.text}" } ?: g.reasoning.ifEmpty { null }

    fun parseTransitions(t: JSONObject?): Transitions? {
        if (t == null) return null
        val b = t.optJSONArray("buckets") ?: return null
        val rows = t.optJSONArray("row_pct") ?: return null
        val tot = t.optJSONArray("row_totals") ?: return null
        val n = b.length()
        if (n == 0 || n > 6 || rows.length() != n || tot.length() != n) return null
        val labels = (0 until n).map { b.optJSONObject(it)?.optString("label")?.take(8) ?: return null }
        val pct = (0 until n).map { i ->
            val r = rows.optJSONArray(i) ?: return null
            if (r.length() != n) return null
            (0 until n).map { j -> if (r.isNull(j)) null else r.optDouble(j).takeIf { !it.isNaN() } }
        }
        val cur = if (t.isNull("current")) null else t.optInt("current", -1).takeIf { it in 0 until n }
        return Transitions(labels, pct, (0 until n).map { tot.optInt(it, 0) }, cur)
    }

    /**
     * The table as monospaced lines: a header ("from", then the bucket labels and n) and one row per bucket,
     * the newest round's row marked "▶". Returns the lines and the index of the marked line (or -1).
     */
    fun tableRows(t: Transitions): Pair<List<String>, Int> {
        fun cell(v: String) = v.padStart(7)
        val head = "  " + "from".padEnd(7) + t.labels.joinToString("") { cell(it) } + cell("n")
        val rows = t.labels.mapIndexed { i, l ->
            (if (i == t.current) "▶ " else "  ") + l.padEnd(7) +
                t.rowPct[i].joinToString("") { cell(it?.let { p -> pc0(p) } ?: "—") } + cell(t.totals[i].toString())
        }
        return Pair(listOf(head) + rows, t.current?.let { it + 1 } ?: -1)
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

    /** "Range tuned to hold about 7 of 10 rounds (held 68% of the last 100)", or null before any replay. */
    fun tunedLine(g: Guess): String? {
        val m = g.coverageMeasured ?: return null
        val t = g.coverageTarget ?: return null
        return "Range tuned to hold about ${Math.round(t * 10)} of 10 rounds (held ${pc0(m)} of the last ${g.samples})"
    }

    /** "Last 30: mean 3.21x · median 1.92x". */
    fun statsLine(g: Guess): String? {
        val mean = g.mean ?: return null
        val median = g.median ?: return null
        return "Last ${g.rounds}: mean ${x2(mean)}x · median ${x2(median)}x"
    }

    /** "Reached 1.5x 63% (odds 65%) · 2x 47% (odds 49%) · …", or null without levels. */
    fun reachLine(g: Guess): String? = g.reach.takeIf { it.isNotEmpty() }?.joinToString(" · ", "Reached ") {
        "${level(it.at)}x ${pc0(it.share)} (odds ${pc0(it.baseline)})"
    }

    private fun level(m: Double) = if (m == Math.floor(m)) m.toLong().toString() else String.format(Locale.US, "%s", m)

    /** The card's lines: guess, tuning, big range, mean / median, reach shares, the after line, and the label. */
    fun detail(g: Guess): String = listOfNotNull(line(g), tunedLine(g), bigLine(g), statsLine(g), reachLine(g),
        g.after?.let { afterLine(it) }, whyLines(g),
        "${g.label}. It does not change BET / WAIT / STOP.").joinToString("\n")
}
