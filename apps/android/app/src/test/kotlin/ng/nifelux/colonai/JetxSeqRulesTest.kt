package ng.nifelux.colonai

import ng.nifelux.colonai.JetxSeqRules.Dir
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Colon JetX 0.39.1: successive strip reads -> new rounds, replayed from what the phone read (7 chips, 0 sent). */
class JetxSeqRulesTest {
    private val a = listOf(1.42, 4.29, 3.27, 4.74, 41.61, 1.04, 34.07)
    private val b = listOf(2.83, 1.42, 4.29, 3.27, 4.74, 41.61, 1.04)

    /** Feeds reads one by one like JetxScreenReader (stable pairs, catch-up on the first): what gets sent. */
    private fun replay(reads: List<List<Double>>, stored: List<Double> = emptyList()): List<Double> {
        val out = ArrayList<Double>()
        var last: List<Double>? = null
        var prev: List<Double>? = null
        var dir = Dir.UNKNOWN
        for (cur in reads) {
            val ok = JetxSeqRules.stable(last, cur, dir)
            last = cur
            if (!ok) continue
            val p = prev
            prev = cur
            if (p == null) { out += JetxSeqRules.catchUp(JetxSeqRules.newestFirst(cur, dir), stored); continue }
            val st = JetxSeqRules.step(p, cur, dir)
            if (st.resync) { out += JetxSeqRules.catchUp(JetxSeqRules.newestFirst(cur, dir), stored); continue }
            dir = st.dir
            out += st.added
        }
        return out
    }

    @Test fun theUsersReadsGiveTheNewRound() {
        val st = JetxSeqRules.step(a, b, Dir.UNKNOWN)
        assertFalse(st.resync)
        assertEquals(listOf(2.83), st.added)
        assertEquals(Dir.LEFT, st.dir)
    }

    @Test fun firstStableReadSendsTheStripAsHistoryOldestFirst() {
        assertEquals(a.reversed(), replay(listOf(a, a)))
        assertEquals("then the new round", a.reversed() + 2.83, replay(listOf(a, a, b, b)))
    }

    @Test fun historyAlreadyStoredIsNotSentAgain() {
        assertEquals(emptyList<Double>(), replay(listOf(a, a), stored = a))
        assertEquals(listOf(2.83), replay(listOf(b, b), stored = a))
        assertEquals("stored has more, older rounds", listOf(2.83), JetxSeqRules.catchUp(b, a + listOf(5.0, 1.1)))
    }

    @Test fun clippedEndChipAndOneMisreadAreTolerated() {
        // The half-visible chip under the dropdown button comes and goes, or is misread.
        val clipped = a.dropLast(1)
        val misread = a.dropLast(1) + 34.0
        // The first stable pair was the clipped read, so the half-visible 34.07 is not sent as history.
        assertEquals(clipped.reversed() + 2.83, replay(listOf(a, clipped, misread, a, b, b.dropLast(1))))
        // One misread in the middle of the next read is forgiven; the new value is still found once.
        val noisy = b.toMutableList().also { it[4] = 4.14 }
        assertEquals(listOf(2.83), JetxSeqRules.step(a, noisy, Dir.LEFT).added)
    }

    @Test fun animationReadsAreNotTaken() {
        assertFalse(JetxSeqRules.stable(a, b, Dir.LEFT))
        assertFalse(JetxSeqRules.stable(null, a, Dir.LEFT))
        assertTrue(JetxSeqRules.stable(a, a.dropLast(1), Dir.LEFT))
        // A read sliding half way (new chip not yet readable) then settling: one round.
        assertEquals(a.reversed() + 2.83, replay(listOf(a, a, a.dropLast(1), b, b)))
    }

    @Test fun severalNewRoundsAndRepeatedValues() {
        val c = listOf(1.0, 1.0) + b.dropLast(2)
        assertEquals("oldest first", listOf(1.0, 1.0), JetxSeqRules.step(b, c, Dir.LEFT).added)
        val d = listOf(2.83) + b.dropLast(1) // same value again on top
        assertEquals(listOf(2.83), JetxSeqRules.step(b, d, Dir.LEFT).added)
    }

    @Test fun newestOnTheRightIsLearnt() {
        val r1 = a.reversed()
        val r2 = b.reversed()
        val st = JetxSeqRules.step(r1, r2, Dir.UNKNOWN)
        assertEquals(listOf(2.83), st.added)
        assertEquals(Dir.RIGHT, st.dir)
    }

    @Test fun unrelatedReadsResyncWithACatchUp() {
        val other = listOf(9.1, 8.2, 7.3, 6.4, 5.5, 4.6)
        assertTrue(JetxSeqRules.step(a, other, Dir.LEFT).resync)
        assertTrue(JetxSeqRules.step(null, a, Dir.LEFT).resync)
        val tooMany = listOf(1.1, 1.2, 1.3, 1.4, 1.5, 1.6) + a.take(3)
        assertTrue("more than MAX_NEW at once", JetxSeqRules.step(a, tooMany, Dir.LEFT).resync)
        assertEquals(other.reversed(), JetxSeqRules.catchUp(other, a))
    }

    @Test fun theColumnMergesTheLiveReadWithStoredRoundsWithoutDoubles() {
        val stored = listOf(1.42, 4.29, 3.27, 4.74, 41.61, 1.04, 34.07, 2.2, 1.9)
        assertEquals(listOf(2.83) + stored, JetxSeqRules.merge(b, stored))
        assertEquals("not stored yet: live only", b, JetxSeqRules.merge(b, listOf(7.7, 8.8, 9.9)))
        assertEquals(stored.take(3), JetxSeqRules.merge(null, stored, 3))
        assertEquals(b.take(5), JetxSeqRules.merge(b, emptyList(), 5))
    }
}
