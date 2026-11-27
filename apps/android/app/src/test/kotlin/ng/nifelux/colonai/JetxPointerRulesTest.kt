package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Colon JetX 0.39.1: where the pointer taps, from OCR words (a 1000 x 1600 capture of the game pane). */
class JetxPointerRulesTest {
    private fun t(text: String, l: Int, top: Int, w: Int = 60, h: Int = 24) =
        JetxOcrRules.Token(text, l, top, l + w, top + h)
    private fun row(y: Int, vararg texts: String, x0: Int = 10): List<JetxOcrRules.Token> =
        texts.mapIndexed { i, s -> t(s, x0 + i * 70, y) }

    private val strip = row(40, "1.42x", "4.29x", "3.27x", "4.74x", "41.61x", "1.04x", "34.07x")
    private val panel = listOf(
        t("Auto", 100, 1250, 50), t("cash", 155, 1250, 50), t("out", 210, 1250, 40), t("1.30", 300, 1250),
        t("100.00", 120, 1350, 80), t("Bet", 600, 1330, 90, 50), t("100.00", 600, 1390, 90),
    )

    @Test fun chevronIsRightOfTheStripOrTheIconWord() {
        val guess = JetxPointerRules.chevron(strip, 1000)!!
        assertEquals(52f, guess.y, 1f)
        assertTrue("near the right edge", guess.x > 900 && guess.x <= 998)
        val icon = JetxPointerRules.chevron(strip + t("v", 950, 42, 20, 20), 1000)!!
        assertEquals(960f, icon.x, 0.5f)
        assertNull(JetxPointerRules.chevron(row(40, "1.42x", "4.29x"), 1000))
    }

    @Test fun gridIsReadRowByRowNewestFirst() {
        val grid = row(40, "2.83x", "1.42x", "4.29x", "3.27x") + row(80, "4.74x", "41.61x", "1.04x", "34.07x") +
            row(120, "2.20x", "1.90x", "5.00x")
        assertEquals(listOf(2.83, 1.42, 4.29, 3.27, 4.74, 41.61, 1.04, 34.07, 2.2, 1.9, 5.0),
            JetxPointerRules.grid(grid.shuffled(java.util.Random(3))))
        assertNull("one row is the strip, not the grid", JetxPointerRules.grid(strip))
    }

    @Test fun betButtonStakeAndCashoutField() {
        val bet = JetxPointerRules.betButton(strip + panel, 1600)!!
        assertEquals(645f, bet.x, 0.5f)
        assertEquals(1355f, bet.y, 0.5f)
        assertEquals(100.0, JetxPointerRules.betStake(panel, bet)!!, 0.001)
        val f = JetxPointerRules.field(panel, 1600, JetxPointerRules.CASHOUT)!!
        assertEquals(1.30, f.value!!, 0.001)
        assertEquals(330f, f.at.x, 0.5f)
        assertNull("no Bet word: a bet is on (Cash out)",
            JetxPointerRules.betButton(listOf(t("Cash", 600, 1330), t("out", 670, 1330)), 1600))
        assertNull("Bet high up is not the button", JetxPointerRules.betButton(listOf(t("Bet", 600, 100)), 1600))
        assertNull(JetxPointerRules.field(strip, 1600, JetxPointerRules.CASHOUT))
    }

    @Test fun cashoutValueUnderTheLabel() {
        val f = JetxPointerRules.field(listOf(t("Cashout", 100, 1200, 90), t("2.00", 110, 1240)), 1600,
            JetxPointerRules.CASHOUT)!!
        assertEquals(2.0, f.value!!, 0.001)
        val none = JetxPointerRules.field(listOf(t("Cashout", 100, 1200, 90)), 1600, JetxPointerRules.CASHOUT)!!
        assertNull(none.value)
    }

    @Test fun readBackAndTyping() {
        assertTrue(JetxPointerRules.verify(1.30, 1.3))
        assertFalse(JetxPointerRules.verify(1.35, 1.3))
        assertFalse(JetxPointerRules.verify(null, 1.3))
        assertEquals("1.30", JetxPointerRules.typed(1.3))
        assertEquals(listOf(8, 56, 10, 7), JetxPointerRules.keys("1.30"))
        assertNull(JetxPointerRules.keys("1,30"))
        assertEquals(1000.0, JetxPointerRules.number("1,000.00")!!, 0.001)
        assertEquals(1.3, JetxPointerRules.number("1.30x")!!, 0.001)
        assertNull(JetxPointerRules.number("Bet"))
    }

    @Test fun roundInFlightAndRateLimit() {
        val flying = strip + t("1.57x", 400, 600, 200, 80)
        assertTrue(JetxPointerRules.roundInProgress(flying, 24, 64))
        assertFalse(JetxPointerRules.roundInProgress(strip + panel, 24, 64))
        assertTrue(JetxPointerRules.mayReadHistory(0L, 5L))
        assertFalse(JetxPointerRules.mayReadHistory(1_000L, 1_000L + 119_999L))
        assertTrue(JetxPointerRules.mayReadHistory(1_000L, 1_000L + 120_000L))
        assertTrue(JetxPointerRules.wantsHistory(3))
        assertFalse(JetxPointerRules.wantsHistory(20))
        assertNotNull(JetxPointerRules.chevron(flying, 1000))
    }
}
