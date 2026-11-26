package ng.nifelux.colonai

/**
 * Colon JetX (0.39.1): the rules behind the full-screen game's left column, "what Colon sees" (JetxSeenColumn), and
 * the right-hand bubble's new default spot (pure, unit-tested in JetxOverlayRulesTest).
 */
object JetxOverlayRules {
    /** JetX-like colours, kept simple: under 2x light blue-grey, 2x to under 10x purple, 10x and up gold. */
    enum class Tone { LOW, MID, HIGH }

    /** The column's status dot: reading (green), no chips (amber), off (grey). */
    enum class Status(val wire: String) { READING("reading"), NO_CHIPS("no chips"), OFF("off") }

    const val FRESH_MS = 5_000L
    const val MIN_CHIPS = 5
    const val MAX_ROWS = 15

    fun tone(m: Double): Tone = when {
        m < 2.0 -> Tone.LOW
        m < 10.0 -> Tone.MID
        else -> Tone.HIGH
    }

    /**
     * Reading: the collector is on and either the page's own strip is found (the DOM collector reads it, the screen
     * reader rests) or the screen reader's last read, at most [FRESH_MS] ago, found [MIN_CHIPS] or more chips.
     * Collector off: off. Anything else: no chips.
     */
    fun status(collectorOn: Boolean, domStrip: Boolean, lastChips: Int, lastReadAt: Long, now: Long): Status = when {
        !collectorOn -> Status.OFF
        domStrip -> Status.READING
        lastChips >= MIN_CHIPS && lastReadAt > 0 && now - lastReadAt in 0..FRESH_MS -> Status.READING
        else -> Status.NO_CHIPS
    }

    /** The live read is shown only while fresh; older than this the stored rounds take over. */
    fun liveFresh(readAt: Long, now: Long): Boolean = readAt > 0 && now - readAt in 0..LIVE_MS
    const val LIVE_MS = 30_000L

    /** "2.83x" (two decimals; 1,000x and up without decimals so the narrow column fits). */
    fun label(m: Double): String = if (m >= 1000) "${m.toLong()}x" else String.format(java.util.Locale.US, "%.2fx", m)

    /**
     * The column's band as shares of the game pane's height: from just under the history strip (its bottom share
     * when the screen reader found it, else [TOP_DEFAULT]) down to [BOTTOM], above JetX's Bet panel and stake
     * controls in the lower part of the game.
     */
    fun band(stripBottom: Float?): Pair<Float, Float> {
        val top = if (stripBottom == null || stripBottom.isNaN() || stripBottom !in 0f..0.5f) TOP_DEFAULT
            else stripBottom + 0.01f
        return top to maxOf(top + 0.15f, BOTTOM)
    }

    const val TOP_DEFAULT = 0.12f
    const val BOTTOM = 0.6f

    /** The saved bubble spot is from an older default scheme: dropped once so everyone gets the right edge. */
    const val BUBBLE_SCHEME = 2

    fun resetBubble(savedScheme: Int): Boolean = savedScheme < BUBBLE_SCHEME
}
