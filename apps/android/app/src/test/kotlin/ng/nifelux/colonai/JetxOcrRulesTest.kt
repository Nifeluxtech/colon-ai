package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Colon JetX's screen reader (0.38.0): reading multipliers out of OCR words, finding the strip, new rounds. */
class JetxOcrRulesTest {
    private fun row(y: Int, vararg texts: String, w: Int = 60): List<JetxOcrRules.Token> =
        texts.mapIndexed { i, t -> JetxOcrRules.Token(t, 10 + i * (w + 10), y, 10 + i * (w + 10) + w, y + 24) }

    @Test fun multiplierWordsAreRead() {
        assertEquals(listOf(2.01 to true), JetxOcrRules.values("2.01x"))
        assertEquals(listOf(2.25 to true), JetxOcrRules.values("2,25 ×"))
        assertEquals(listOf(1.79 to false), JetxOcrRules.values("1.79"))
        assertEquals(listOf(2.01 to true, 2.25 to true), JetxOcrRules.values("2.01x2.25x"))
        assertTrue(JetxOcrRules.values("1,000.00").isEmpty())
        assertTrue(JetxOcrRules.values("Balance").isEmpty())
        assertTrue(JetxOcrRules.values("0.50x").isEmpty())
        assertTrue(JetxOcrRules.values("1.234x").isEmpty())
    }

    @Test fun theStripIsTheTopRowOfFiveOrMoreMultipliers() {
        val tokens = row(40, "2.01x", "2.25x", "1.79x", "5.31x", "1.12x", "3.40x") +
            row(500, "100.00", "200.00", "500.00", "1000.00", "2000.00") + // stake buttons, no x, low on screen
            listOf(JetxOcrRules.Token("Bet", 300, 600, 360, 640))
        val s = JetxOcrRules.locate(tokens, 800)
        assertNotNull(s)
        assertEquals(listOf(2.01, 2.25, 1.79, 5.31, 1.12, 3.4), s!!.values)
        assertTrue(s.top < 40f / 800 && s.bottom > 64f / 800 && s.bottom < 0.2f)
    }

    @Test fun noStripWithoutEnoughXsOrTooLow() {
        assertNull(JetxOcrRules.locate(row(40, "2.01x", "2.25x", "1.79x", "5.31x"), 800))
        assertNull(JetxOcrRules.locate(row(40, "2.01", "2.25", "1.79", "5.31", "1.12x"), 800))
        assertNull(JetxOcrRules.locate(row(700, "2.01x", "2.25x", "1.79x", "5.31x", "1.12x"), 800))
        assertNull(JetxOcrRules.locate(emptyList(), 0))
    }

    @Test fun theBandIsReadLeftToRightEvenWhenWordsArriveShuffled() {
        val tokens = row(10, "2.01x", "2.25x", "1.79x", "5.31x", "1.12x").reversed()
        assertEquals(listOf(2.01, 2.25, 1.79, 5.31, 1.12), JetxOcrRules.read(tokens))
        assertNull(JetxOcrRules.read(row(10, "2.01x", "2.25x")))
    }

    @Test fun aNewLeftmostValueIsANewRound() {
        val prev = listOf(2.01, 2.25, 1.79, 5.31, 1.12, 3.4)
        val one = JetxOcrRules.shift(prev, listOf(1.5) + prev.dropLast(1))
        assertEquals(listOf(1.5), one.added)
        assertFalse(one.resync)
        val two = JetxOcrRules.shift(prev, listOf(7.0, 1.5) + prev.dropLast(2))
        assertEquals("oldest first", listOf(1.5, 7.0), two.added)
        assertEquals(emptyList<Double>(), JetxOcrRules.shift(prev, prev).added)
        assertEquals("clipped right end", emptyList<Double>(), JetxOcrRules.shift(prev, prev.dropLast(1)).added)
    }

    @Test fun nothingIsSentOnTheFirstLookOrWhenReadsDontLineUp() {
        val cur = listOf(2.01, 2.25, 1.79, 5.31, 1.12)
        assertTrue(JetxOcrRules.shift(null, cur).resync)
        assertTrue(JetxOcrRules.shift(null, cur).added.isEmpty())
        val other = JetxOcrRules.shift(cur, listOf(9.0, 8.0, 7.0, 6.0, 5.0))
        assertTrue(other.resync)
        assertTrue(other.added.isEmpty())
        val tooMany = JetxOcrRules.shift(cur, listOf(1.0, 1.1, 1.2, 1.3, 1.4, 1.5) + cur)
        assertTrue("more than MAX_NEW at once is a resync", tooMany.resync)
    }

    @Test fun aReadCountsOnlyWhenTheNextReadAgrees() {
        val a = listOf(2.01, 2.25, 1.79, 5.31, 1.12)
        assertTrue(JetxOcrRules.confirmed(a, a.toList()))
        assertFalse(JetxOcrRules.confirmed(null, a))
        assertFalse(JetxOcrRules.confirmed(a, null))
        assertFalse(JetxOcrRules.confirmed(a, listOf(2.0) + a.drop(1)))
    }
}
