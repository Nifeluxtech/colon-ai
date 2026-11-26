package ng.nifelux.colonai

import kotlin.math.abs

/**
 * Colon JetX's pointer (0.39.1): where to tap on the game when its controls are pixels (a canvas or a closed
 * component), found in the screen reader's OCR words (pure, unit-tested in JetxPointerRulesTest). Coordinates are
 * the captured bitmap's pixels; JetxPointerTaps scales them to the game pane.
 *
 *  - [chevron]: the history dropdown button at the right end of the strip. It is an icon, so OCR rarely reads it:
 *    a "v"-like word right of the last chip on the strip's row wins, else the spot one row-height in from the
 *    right edge on the strip's centre line.
 *  - [grid]: the opened history, rows of chips top to bottom, each left to right, newest first.
 *  - [betButton]: the word "Bet" in the lower half (the button reads Cancel or Cash out once a bet is on).
 *  - [field]: a label ("Auto cash out", "Auto collect", "Cashout"; or "Stake") and the number beside or under it.
 *  - [roundInProgress]: a multiplier drawn far larger than the strip's chips (the plane is flying).
 *  - [verify], [keys], [mayReadHistory]: the read-back check, what to type, the 2-minute rate limit.
 */
object JetxPointerRules {
    data class Point(val x: Float, val y: Float)
    data class Field(val label: JetxOcrRules.Token, val value: Double?, val at: Point)

    const val HISTORY_GAP_MS = 120_000L
    const val FEW_ROUNDS = 20
    const val MIN_GRID_ROWS = 2
    const val BIG_SHARE = 2.2

    private val NUMBER = Regex("^([0-9]{1,7}(?:[ ,][0-9]{3})*)[.,]([0-9]{2})\\s*[xX\u00d7]?$")
    private val CHEVRON = Regex("^[vV\u2228\u02c5\u2304\u25bc\u25be>\u203a\u02c7]$")
    private val BET = Regex("^bet$", RegexOption.IGNORE_CASE)
    val CASHOUT = Regex("^(auto|cashout|cash|collect|out|auto-?cashout)$", RegexOption.IGNORE_CASE)
    val STAKE = Regex("^(stake|amount)$", RegexOption.IGNORE_CASE)

    fun cx(t: JetxOcrRules.Token) = (t.left + t.right) / 2f
    fun cy(t: JetxOcrRules.Token) = (t.top + t.bottom) / 2f

    /** A plain number word ("1.30", "100.00", "1,000.00", "1.30x"), or null. */
    fun number(text: String): Double? {
        val m = NUMBER.find(text.trim().replace('\u00a0', ' ')) ?: return null
        return "${m.groupValues[1].replace(Regex("[ ,]"), "")}.${m.groupValues[2]}".toDoubleOrNull()
    }

    /** The dropdown button for the strip found in a [width]-wide capture, or null with no strip row. */
    fun chevron(tokens: List<JetxOcrRules.Token>, width: Int): Point? {
        val row = JetxOcrRules.rows(JetxOcrRules.chips(tokens)).firstOrNull { it.size >= JetxOcrRules.MIN_CHIPS }
            ?: return null
        val h = row.maxOf { it.h }
        val y = row.sumOf { it.y } / row.size.toFloat()
        val lastRight = row.last().x + h
        val icon = tokens.filter { CHEVRON.matches(it.text.trim()) && cx(it) > row.last().x && abs(cy(it) - y) <= h }
            .minByOrNull { cx(it) }
        if (icon != null) return Point(cx(icon), cy(icon))
        if (width <= 0) return null
        return Point(maxOf(lastRight.toFloat(), width - h * 1.0f).coerceAtMost(width - 2f), y)
    }

    /** The opened history: rows of 3+ chips, top to bottom and left to right; null unless [MIN_GRID_ROWS] rows. */
    fun grid(tokens: List<JetxOcrRules.Token>): List<Double>? {
        val rows = JetxOcrRules.rows(JetxOcrRules.chips(tokens))
            .filter { r -> r.size >= 3 && r.count { it.withX } * 2 >= r.size }
        if (rows.size < MIN_GRID_ROWS) return null
        return rows.flatMap { r -> r.map { it.m } }
    }

    /** The Bet button's centre (the largest "Bet" word in the lower half of a [height]-tall capture), or null:
     *  while a bet is on, JetX's button reads Cancel or Cash out instead. */
    fun betButton(tokens: List<JetxOcrRules.Token>, height: Int): Point? {
        val low = tokens.filter { cy(it) >= height * 0.45f }
        val bet = low.filter { BET.matches(it.text.trim()) }.maxByOrNull { it.bottom - it.top } ?: return null
        return Point(cx(bet), cy(bet))
    }

    /** The stake shown on (or right under) the Bet button, e.g. "Bet" over "100.00 NGN". */
    fun betStake(tokens: List<JetxOcrRules.Token>, bet: Point): Double? {
        val h = tokens.filter { BET.matches(it.text.trim()) }.maxOfOrNull { it.bottom - it.top } ?: return null
        return tokens.filter { abs(cx(it) - bet.x) <= h * 4 && cy(it) - bet.y in 0f..h * 2.5f }
            .mapNotNull { number(it.text) }.firstOrNull()
    }

    /**
     * The field after the label matching [label] (the first such word in the lower half): the nearest number to
     * its right on the same line, else under it within 3 line heights. Null when there's no label; value null when
     * the label has no number near it.
     */
    fun field(tokens: List<JetxOcrRules.Token>, height: Int, label: Regex): Field? {
        val l = tokens.filter { cy(it) >= height * 0.45f && label.matches(it.text.trim()) }.minByOrNull { it.top }
            ?: return null
        val h = (l.bottom - l.top).coerceAtLeast(1).toFloat()
        val nums = tokens.filter { it !== l && number(it.text) != null }
        val right = nums.filter { abs(cy(it) - cy(l)) <= h * 0.8f && it.left >= l.left }.minByOrNull { it.left }
        val under = nums.filter { cy(it) - cy(l) in h * 0.5f..h * 3f && abs(cx(it) - cx(l)) <= h * 8 }
            .minByOrNull { it.top }
        val t = right ?: under ?: return Field(l, null, Point(cx(l), cy(l)))
        return Field(l, number(t.text), Point(cx(t), cy(t)))
    }

    /** A multiplier word much taller than the strip's chips ([chipH]) below the strip: a round is in flight. */
    fun roundInProgress(tokens: List<JetxOcrRules.Token>, chipH: Int, stripBottom: Int): Boolean =
        chipH > 0 && tokens.any { t ->
            t.top > stripBottom && (t.bottom - t.top) >= chipH * BIG_SHARE &&
                JetxOcrRules.values(t.text).any { it.second }
        }

    /** The field shows the value asked for (to the cent). */
    fun verify(read: Double?, want: Double): Boolean = read != null && abs(read - want) < 0.005

    /** What to type for [v]: "1.3" -> "1.30" (two decimals, no grouping). */
    fun typed(v: Double): String = String.format(java.util.Locale.US, "%.2f", v)

    /** Android key codes for [text] (digits and the dot only; anything else gives null). */
    fun keys(text: String): List<Int>? = text.map { c ->
        when (c) {
            in '0'..'9' -> 7 + (c - '0') // KEYCODE_0 = 7
            '.' -> 56 // KEYCODE_PERIOD
            else -> return null
        }
    }

    /** Opening the history is allowed at most once per [HISTORY_GAP_MS]. */
    fun mayReadHistory(lastAt: Long, now: Long): Boolean = lastAt <= 0L || now - lastAt >= HISTORY_GAP_MS

    /** On its own (no tap) only when few rounds are stored yet. */
    fun wantsHistory(storedRounds: Int): Boolean = storedRounds < FEW_ROUNDS
}
