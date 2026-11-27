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
        "label":"Guess from last 30 rounds, not a prediction","level":0.7,"coverage_target":0.7,
        "coverage_measured":0.68,"samples":100,"mean":3.214,"median":1.92,"reach":[{"at":1.5,"share":0.6333,
        "baseline":0.6467},{"at":2,"share":0.4667,"baseline":0.4851},{"at":5,"share":0.1333,"baseline":0.194},
        {"at":10,"share":0.0667,"baseline":0.097}],"transitions":{"buckets":[{"id":"lt_1.2","label":"<1.20"},
        {"id":"1.2_2","label":"1.20–2"},{"id":"2_10","label":"2–10"},{"id":"ge_10","label":"≥10"}],
        "counts":[[0,15,10,0],[15,0,0,0],[10,0,0,0],[0,0,0,0]],"row_pct":[[0,0.6,0.4,0],[1,0,0,0],[1,0,0,0],
        [null,null,null,null]],"row_totals":[25,15,10,0],"current":0,"pairs":50},
        "reasoning":"Last round 1.04x (under 1.20x).","ai_reasoning":{"text":"Mostly low rounds lately.",
        "source":"ai","label":"AI read · guess, not a prediction"},"after_last":{"bucket":"lt_1.2",
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
        assertEquals("Range tuned to hold about 7 of 10 rounds (held 68% of the last 100)",
            JetxGuessRules.tunedLine(g))
        assertEquals("Last 30: mean 3.21x · median 1.92x", JetxGuessRules.statsLine(g))
        assertEquals("Reached 1.5x 63% (odds 65%) · 2x 47% (odds 49%) · 5x 13% (odds 19%) · 10x 7% (odds 10%)",
            JetxGuessRules.reachLine(g))
        assertFalse(JetxAutobetRules.bubbleLines(l).contains("Range tuned"))
        assertTrue(JetxGuessRules.detail(g).contains("AI read · guess, not a prediction\nMostly low rounds lately."))
        assertFalse(JetxGuessRules.detail(g).contains("Last round 1.04x"))
        val (rows, mark) = JetxGuessRules.tableRows(g.transitions!!)
        assertEquals(5, rows.size)
        assertEquals(1, mark)
        assertEquals("  from     <1.20 1.20–2   2–10    ≥10      n", rows[0])
        assertEquals("▶ <1.20       0%    60%    40%     0%     25", rows[1])
        assertEquals("  ≥10          —      —      —      —      0", rows[4])
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
        val bare = JetxGuessRules.parse(org.json.JSONObject("""{"range":{"low":1.2,"high":2},"big":{"low":9,
            "high":12},"rounds_used":12}"""))!!
        assertNull(JetxGuessRules.tunedLine(bare))
        assertNull(JetxGuessRules.statsLine(bare))
        assertNull(JetxGuessRules.reachLine(bare))
        assertEquals("Guess from last 12 rounds, not a prediction", bare.label)
        assertNull(bare.transitions)
        assertNull(JetxGuessRules.whyLines(bare))
        val tmpl = JetxGuessRules.parse(org.json.JSONObject("""{"range":{"low":1.2,"high":2},"big":{"low":9,
            "high":12},"rounds_used":12,"reasoning":"Last round 1.10x.","ai_reasoning":{"text":"Last round 1.10x.",
            "source":"template","label":"How the guess was made · guess, not a prediction"}}"""))!!
        assertFalse(tmpl.why!!.ai)
        assertTrue(JetxGuessRules.whyLines(tmpl)!!.startsWith("How the guess was made"))
    }
}
