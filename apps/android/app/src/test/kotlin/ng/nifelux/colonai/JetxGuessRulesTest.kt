package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Colon JetX 0.39.3: the guessed range and the "after a round like the last one" line (display only). */
class JetxGuessRulesTest {
    private val json = """{"target":1.3,"estimate":{"chance":0.8234,"source":"measured","rounds":40,
        "min_rounds":10},"verdict":{"action":"BET","reason":"Estimated 82.3%."},"recent":[{"multiplier":2.01}],
        "kill_switch":false,"demo_mode":true,"guess":{"range":{"low":1.89,"high":2.34},
        "big":{"low":19.45,"high":23.44},"big_chance":"about 1 in 10","big_share":0.1,"rounds_used":30,"window":30,
        "label":"Guess from last 30 rounds, not a prediction","after_last":{"bucket":"lt_1.2",
        "bucket_label":"under 1.20x","samples":88,"reached_2x":41,"rate":0.4659,"all_rounds":400,
        "all_reached_2x":192,"all_rate":0.48}}}"""

    @Test fun parsesTheGuessAndFormatsTheBubbleAndCard() {
        val l = JetxAutobetRules.parseLive(json)
        assertNotNull(l)
        val g = l!!.guess
        assertNotNull(g)
        assertEquals("Guess 1.89–2.34x", JetxGuessRules.line(g!!))
        assertEquals("Big round 19.45–23.44x (about 1 in 10)", JetxGuessRules.bigLine(g))
        assertEquals("After a crash under 1.20x: 41 of 88 reached 2x (47%) · all rounds 48%",
            JetxGuessRules.afterLine(g.after!!))
        assertTrue(JetxGuessRules.detail(g).contains("not a prediction"))
        assertEquals("1.30x\n82.3%\nBET\nGuess 1.89–2.34x", JetxAutobetRules.bubbleLines(l))
    }

    @Test fun theGuessNeverChangesTheVerdictLine() {
        val with = JetxAutobetRules.parseLive(json)!!
        val without = with.copy(guess = null)
        assertEquals(JetxAutobetRules.bubbleLine(without), JetxAutobetRules.bubbleLine(with))
        assertEquals("BET", with.action)
        assertEquals("1.30x\n82.3%\nBET", JetxAutobetRules.bubbleLines(without))
    }

    @Test fun noGuessOrAfterLineWhenTheApiHasNone() {
        val l = JetxAutobetRules.parseLive("""{"target":1.3,"estimate":{"chance":null,"rounds":3,"min_rounds":10},
            "verdict":{"action":"WAIT"},"guess":null}""")
        assertNull(l!!.guess)
        assertFalse(JetxAutobetRules.bubbleLines(l).contains("Guess"))
        val noAfter = JetxAutobetRules.parseLive(json.replace(Regex(""""after_last":\{[^}]*\}"""),
            "\"after_last\":null"))!!
        assertNotNull(noAfter.guess)
        assertNull(noAfter.guess!!.after)
        assertFalse(JetxGuessRules.detail(noAfter.guess!!).contains("After a crash"))
    }
}
