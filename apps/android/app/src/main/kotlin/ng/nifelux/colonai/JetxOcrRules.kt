package ng.nifelux.colonai

/**
 * Colon JetX's screen reader (0.38.0): the pure rules behind JetxScreenReader. No Android types, unit-tested in
 * JetxOcrRulesTest.
 *
 * On-device text recognition reads the game pane's pixels into words with boxes ([Token]). The history strip is
 * found as the topmost row (in the upper [TOP_SHARE] of the game) of at least [MIN_CHIPS] multiplier-shaped words,
 * most of them ending in x; after that only that band is read. The strip shows the newest round on the left, so a
 * new round is a new leftmost value with the old sequence shifted right ([shift]). A read counts only when the
 * next read agrees ([confirmed]): chips sliding in mid-animation are not taken. Only multipliers leave this
 * class; the pixels and any other text never do.
 */
object JetxOcrRules {
    data class Token(val text: String, val left: Int, val top: Int, val right: Int, val bottom: Int)

    /** One multiplier on screen: its value, x centre, y centre and height (pixels of the captured bitmap). */
    data class Chip(val m: Double, val x: Int, val y: Int, val h: Int, val withX: Boolean)

    /** The strip's band, as shares (0..1) of the captured height, and the values left to right. */
    data class Strip(val top: Float, val bottom: Float, val values: List<Double>)

    /** [added]: new rounds, oldest first. [resync]: the reads don't line up; start again from [cur]. */
    data class Shift(val added: List<Double>, val resync: Boolean)

    const val MIN_CHIPS = 5
    const val TOP_SHARE = 0.6f
    const val MIN_OVERLAP = 3
    const val MAX_NEW = 5
    const val X_SHARE = 0.5
    const val MAX_CHIPS = 40

    // "2.01x", "2,01 ×", "2.01X", or "2.01" when the x was lost; never part of a longer number ("1,000.00").
    private val CHIP = Regex("(?<![0-9.,])([0-9]{1,7})[.,]([0-9]{2})(?![0-9.,])\\s*([xX\u00d7])?")

    /** The multipliers in one recognised word ("2.01x2.25x" gives two), each with whether it carried an x. */
    fun values(text: String): List<Pair<Double, Boolean>> = CHIP.findAll(text).mapNotNull { m ->
        val v = "${m.groupValues[1]}.${m.groupValues[2]}".toDoubleOrNull() ?: return@mapNotNull null
        JetxRoundRules.multiplier(v)?.let { it to m.groupValues[3].isNotEmpty() }
    }.toList()

    /** Tokens -> chips; a word holding several values is split evenly across its width. */
    fun chips(tokens: List<Token>): List<Chip> = tokens.flatMap { t ->
        val vs = values(t.text)
        val w = (t.right - t.left).coerceAtLeast(1)
        vs.mapIndexed { i, (v, x) ->
            val h = (t.bottom - t.top).coerceAtLeast(1)
            Chip(v, t.left + w * (2 * i + 1) / (2 * vs.size), (t.top + t.bottom) / 2, h, x)
        }
    }.take(MAX_CHIPS * 4)

    /** Chips in rows (centres within 60% of the taller chip's height), each row left to right, top row first. */
    fun rows(chips: List<Chip>): List<List<Chip>> {
        val out = mutableListOf<MutableList<Chip>>()
        for (c in chips.sortedBy { it.y }) {
            val row = out.lastOrNull()
            val cy = row?.let { r -> r.sumOf { it.y } / r.size }
            if (row != null && cy != null && Math.abs(c.y - cy) <= maxOf(c.h, row.maxOf { it.h }) * 0.6) row += c
            else out += mutableListOf(c)
        }
        return out.map { r -> r.sortedBy { it.x } }
    }

    /** The history strip in a capture [height] pixels tall, or null when no row qualifies. */
    fun locate(tokens: List<Token>, height: Int): Strip? {
        if (height <= 0) return null
        val row = rows(chips(tokens)).firstOrNull { r ->
            r.size >= MIN_CHIPS && r.count { it.withX } >= r.size * X_SHARE && r.first().y <= height * TOP_SHARE
        } ?: return null
        val pad = row.maxOf { it.h }
        val top = (row.minOf { it.y - it.h / 2 } - pad / 2).coerceAtLeast(0)
        val bottom = (row.maxOf { it.y + it.h / 2 } + pad / 2).coerceAtMost(height)
        return Strip(top.toFloat() / height, bottom.toFloat() / height, row.map { it.m }.take(MAX_CHIPS))
    }

    /** The values in a capture of the band alone (left to right), or null when fewer than [MIN_CHIPS]. */
    fun read(tokens: List<Token>): List<Double>? {
        val row = rows(chips(tokens)).maxByOrNull { it.size } ?: return null
        return if (row.size >= MIN_CHIPS) row.map { it.m }.take(MAX_CHIPS) else null
    }

    /** A read is used only when it matches the read before it (the strip is not moving). */
    fun confirmed(lastRaw: List<Double>?, cur: List<Double>?): Boolean = cur != null && cur == lastRaw

    /**
     * [prev]: the last confirmed strip, [cur]: this one, both newest first (leftmost). New rounds are the k values
     * in front of the old sequence shifted right by k (1..[MAX_NEW]), with at least [MIN_OVERLAP] values agreeing.
     */
    fun shift(prev: List<Double>?, cur: List<Double>): Shift {
        if (prev.isNullOrEmpty()) return Shift(emptyList(), true)
        if (cur == prev) return Shift(emptyList(), false)
        for (k in 1..MAX_NEW) {
            val n = minOf(prev.size, cur.size - k)
            if (n < MIN_OVERLAP) break
            if (cur.subList(k, k + n) == prev.subList(0, n)) return Shift(cur.subList(0, k).reversed(), false)
        }
        // The strip may also have lost its rightmost chip only (clipped): same front, nothing new.
        val n = minOf(prev.size, cur.size)
        if (n >= MIN_OVERLAP && cur.subList(0, n) == prev.subList(0, n)) return Shift(emptyList(), false)
        return Shift(emptyList(), true)
    }
}
