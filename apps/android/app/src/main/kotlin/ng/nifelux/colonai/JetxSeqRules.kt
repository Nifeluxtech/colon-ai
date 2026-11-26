package ng.nifelux.colonai

import kotlin.math.abs

/**
 * Colon JetX (0.39.1): how the screen reader turns successive reads of the history strip into new rounds (pure, no
 * Android types, unit-tested in JetxSeqRulesTest).
 *
 * 0.38.0 compared reads exactly (two identical reads in a row, then an exact shift), so on the phone it read 7 chips
 * and never sent a round: OCR noise on one chip or the half-visible chip under the dropdown button broke every
 * comparison, and the first read was only a baseline. Now:
 *  - reads are compared by best-overlap alignment ([fit], [good]): at least [MIN_OVERLAP] values overlapping, the
 *    two values next to the new ones must agree, and one misread among 5 or more is forgiven;
 *  - a read counts once the next read agrees with it ([stable]: same newest values, one miss allowed at the far end);
 *  - the strip may run newest-left (JetX's default) or newest-right ([Dir]); it is learnt from the first shift;
 *  - the first stable read (and any read that no longer lines up, e.g. after the screen was off) sends the visible
 *    strip as history, minus what is already stored ([catchUp] against GET /crash/live's newest rounds).
 * All lists here are newest first unless a name says otherwise; [Step.added] is oldest first (the sending order).
 */
object JetxSeqRules {
    const val EPS = 0.005
    const val MIN_OVERLAP = 3
    const val MAX_NEW = 5

    enum class Dir { UNKNOWN, LEFT, RIGHT }

    /** How [cur] lines up with [prev] when [k] new values were put in front: [n] values overlap, [hits] agree. */
    data class Fit(val k: Int, val n: Int, val hits: Int, val anchor: Boolean)

    /** [added]: new rounds, oldest first. [resync]: the reads don't line up (send a catch-up instead). */
    data class Step(val added: List<Double>, val dir: Dir, val resync: Boolean)

    fun same(a: Double, b: Double): Boolean = abs(a - b) < EPS

    /** prev[i] against cur[k + i]; the anchor is the first two overlapped pairs (next to the new values). */
    fun fit(prev: List<Double>, cur: List<Double>, k: Int): Fit {
        val n = minOf(prev.size, cur.size - k).coerceAtLeast(0)
        var hits = 0
        for (i in 0 until n) if (same(prev[i], cur[k + i])) hits++
        val anchor = n >= 2 && same(prev[0], cur[k]) && same(prev[1], cur[k + 1])
        return Fit(k, n, hits, anchor)
    }

    /** Enough overlap, the anchor agrees, and at most one miss when 5 or more overlap (none below that). */
    fun good(f: Fit): Boolean = f.n >= MIN_OVERLAP && f.anchor && f.hits >= f.n - (if (f.n >= 5) 1 else 0)

    /** The strip as newest first, whichever way it runs on screen. */
    fun newestFirst(read: List<Double>, dir: Dir): List<Double> = if (dir == Dir.RIGHT) read.reversed() else read

    /** Two reads in a row agree (the strip is not mid-animation): same length give or take the clipped end chip,
     *  the newest end identical and at most one other value different. Direction unknown: the left end. */
    fun stable(last: List<Double>?, cur: List<Double>?, dir: Dir): Boolean {
        if (last == null || cur == null || last.isEmpty() || cur.isEmpty()) return false
        if (abs(last.size - cur.size) > 1) return false
        val f = fit(newestFirst(last, dir), newestFirst(cur, dir), 0)
        return f.n >= MIN_OVERLAP && f.anchor && f.hits >= f.n - 1
    }

    /**
     * [prev]: the last stable read, [cur]: this one (both as read, left to right). No new round when they line up
     * as they are (k = 0, the clipped end chip may come and go). Else the smallest k in 1..[MAX_NEW] that lines up
     * with k new values on the newest side; with the direction unknown, newest-left is tried first (all of it).
     */
    fun step(prev: List<Double>?, cur: List<Double>, dir: Dir): Step {
        if (prev.isNullOrEmpty() || cur.isEmpty()) return Step(emptyList(), dir, true)
        val dirs = when (dir) { Dir.UNKNOWN -> listOf(Dir.LEFT, Dir.RIGHT); else -> listOf(dir) }
        for (d in dirs) { // one direction fully before the other: a clipped end looks like the other's k = 0
            val p = newestFirst(prev, d)
            val c = newestFirst(cur, d)
            if (good(fit(p, c, 0))) return Step(emptyList(), dir, false)
            for (k in 1..MAX_NEW) if (good(fit(p, c, k))) return Step(c.take(k).reversed(), d, false)
        }
        return Step(emptyList(), dir, true)
    }

    /**
     * The values of [strip] (newest first) not yet among [stored] (newest first, GET /crash/live), oldest first:
     * the strip's front up to where the stored rounds line up with it. Nothing lines up (a fresh account, a long
     * gap): the whole strip. The API's own dedupe still drops a value stored in the last 2 s.
     */
    fun catchUp(strip: List<Double>, stored: List<Double>): List<Double> {
        if (strip.isEmpty()) return emptyList()
        if (stored.isNotEmpty()) for (k in 0..strip.size - MIN_OVERLAP) {
            if (good(fit(stored, strip, k))) return strip.take(k).reversed()
        }
        // A short strip tail can still match the newest stored values one to one (k = size - n).
        if (stored.isNotEmpty() && strip.size < MIN_OVERLAP) {
            if (strip.indices.all { same(strip[it], stored[it]) }) return emptyList()
        }
        return strip.reversed()
    }

    /**
     * What the left column lists, newest first, at most [max]: the live read ([live], newest first) and then the
     * stored rounds older than its oldest value. They line up like [catchUp]; when they don't, the live read alone
     * (no doubles). No live read: the stored rounds.
     */
    fun merge(live: List<Double>?, stored: List<Double>, max: Int = 15): List<Double> {
        if (live.isNullOrEmpty()) return stored.take(max)
        if (stored.isEmpty()) return live.take(max)
        for (k in 0..live.size - MIN_OVERLAP) {
            if (good(fit(stored, live, k))) return (live + stored.drop(live.size - k)).take(max)
        }
        return live.take(max)
    }
}
