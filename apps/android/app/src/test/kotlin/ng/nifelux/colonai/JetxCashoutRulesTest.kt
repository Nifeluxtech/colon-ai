package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Colon JetX 0.39.4: the cash-out line from GET /crash/live (display only). */
class JetxCashoutRulesTest {
    private fun live(cashout: String) = """{"target":1.3,"estimate":{"chance":0.8234,"source":"measured",
        "rounds":40,"min_rounds":10},"verdict":{"action":"BET","reason":"Estimated 82.3%."},
        "recent":[{"multiplier":2.01}],"kill_switch":false,"demo_mode":true,"cashout":$cashout}"""

    @Test fun cashOutAtTheHighestMultiplierAt75Percent() {
        val l = JetxAutobetRules.parseLive(live("""{"at":1.2,"chance":0.7812,"source":"measured",
            "min_chance":0.75,"rounds":40,"min_rounds":10,"label":"Cash out at 1.20x · 75%+"}"""))!!
        val c = l.cashout!!
        assertEquals("Cash out at 1.20x · 75%+", JetxCashoutRules.line(c))
        assertEquals("Cash out at 1.20x\n75%+", JetxCashoutRules.badgeLines(c))
        assertEquals("1.30x\n82.3%\nBET\nCash out at 1.20x\n75%+", JetxAutobetRules.bubbleLines(l))
        val d = JetxCashoutRules.detail(c)
        assertTrue(d.contains("Estimated 78.1% that the next round reaches 1.20x"))
        assertTrue(d.contains("not a guarantee"))
        assertFalse(d.contains("Guess"))
        assertFalse(d.lowercase().contains("predict"))
    }

    @Test fun notSureEnoughAndCollecting() {
        val no = JetxAutobetRules.parseLive(live("""{"at":null,"chance":0.71,"source":"measured",
            "min_chance":0.75,"rounds":40,"min_rounds":10}"""))!!.cashout!!
        assertNull(no.at)
        assertEquals("Don’t bet · not sure enough", JetxCashoutRules.line(no))
        assertTrue(JetxCashoutRules.detail(no).contains("(1.10x: 71.0%)"))
        val bad = JetxCashoutRules.parse(org.json.JSONObject("""{"at":2,"chance":null,"source":"bad_data"}"""))!!
        assertNull(bad.at)
        assertEquals(JetxCashoutRules.NOT_SURE, JetxCashoutRules.line(bad))
        val few = JetxCashoutRules.parse(org.json.JSONObject("""{"at":null,"chance":null,"source":"collecting",
            "rounds":3,"min_rounds":10}"""))!!
        assertEquals("3/10 rounds", JetxCashoutRules.line(few))
    }

    @Test fun missingOrMalformedCashoutLeavesTheBubbleAsBefore() {
        val l = JetxAutobetRules.parseLive(live("null"))!!
        assertNull(l.cashout)
        assertEquals("1.30x\n82.3%\nBET", JetxAutobetRules.bubbleLines(l))
        assertNull(JetxCashoutRules.parse(org.json.JSONObject("""{"source":"oracle","at":5}""")))
    }

    @Test fun theDecisionIgnoresTheCashout() {
        val l = JetxAutobetRules.parseLive(live("""{"at":3.5,"chance":0.8,"source":"rule","min_chance":0.75}"""))!!
        assertEquals(1.3, l.target, 0.0)
        assertEquals("BET", l.action)
        assertEquals(l.copy(cashout = null).target, l.target, 0.0)
    }
}
