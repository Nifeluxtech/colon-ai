package ng.nifelux.colonai

import kotlin.random.Random

/**
 * Reconnect delays for the bridge: exponential (1 s, 2 s, 4 s ... capped) with jitter so thousands of phones
 * coming back on mobile data don't reconnect in the same second. Pure and unit-tested (BackoffTest).
 */
class Backoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 60_000,
    private val random: Random = Random.Default,
) {
    var attempt = 0
        private set

    /** The next delay: a random value between half and all of base * 2^attempt (capped at maxMs). */
    fun next(): Long {
        val shift = attempt.coerceAtMost(20)
        val ceiling = (baseMs shl shift).coerceAtMost(maxMs).coerceAtLeast(baseMs)
        attempt++
        val half = ceiling / 2
        return half + (random.nextDouble() * (ceiling - half)).toLong()
    }

    fun reset() {
        attempt = 0
    }
}
