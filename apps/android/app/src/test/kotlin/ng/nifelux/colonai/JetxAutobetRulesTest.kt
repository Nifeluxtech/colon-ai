package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

/** Colon JetX auto-bet (0.37.0): when the app may ask, when it may click, and what it accepts from the game. */
class JetxAutobetRulesTest {
    private val now = 1_790_000_000_000L
    private val site = "https://games.example.bet"
    private val real = JetxAutobetRules.Decision(true, "bet", "ok", 100.0, 1.3, false, "42")
    private val demo = real.copy(demo = true)

    @Test fun onlyAiAndSharedAskAndNeverWhenStopped() {
        assertFalse(JetxAutobetRules.mayAsk(JetxRules.Mode.MANUAL, false))
        assertTrue(JetxAutobetRules.mayAsk(JetxRules.Mode.AI, false))
        assertTrue(JetxAutobetRules.mayAsk(JetxRules.Mode.SHARED, false))
        assertFalse(JetxAutobetRules.mayAsk(JetxRules.Mode.AI, true))
    }

    @Test fun aClickNeedsEveryConditionAtOnce() {
        assertTrue(JetxAutobetRules.mayClick(real, true, JetxRules.Mode.AI, false))
        assertTrue(JetxAutobetRules.mayClick(real, true, JetxRules.Mode.SHARED, false))
        assertFalse("demo is never clicked", JetxAutobetRules.mayClick(demo, true, JetxRules.Mode.AI, false))
        assertFalse("app switch off", JetxAutobetRules.mayClick(real, false, JetxRules.Mode.AI, false))
        assertFalse("manual", JetxAutobetRules.mayClick(real, true, JetxRules.Mode.MANUAL, false))
        assertFalse("stopped", JetxAutobetRules.mayClick(real, true, JetxRules.Mode.AI, true))
        assertFalse("refused", JetxAutobetRules.mayClick(real.copy(allow = false), true, JetxRules.Mode.AI, false))
        assertFalse("no bet recorded", JetxAutobetRules.mayClick(real.copy(betId = null), true, JetxRules.Mode.AI, false))
        assertFalse(JetxAutobetRules.mayClick(null, true, JetxRules.Mode.AI, false))
    }

    @Test fun decisionsAreRead() {
        val d = JetxAutobetRules.parseDecision("""{"allow":true,"code":"bet","reason":"r","stake":100,"target":1.3,
            "demo":false,"bet":{"id":"77"}}""")
        assertEquals(JetxAutobetRules.Decision(true, "bet", "r", 100.0, 1.3, false, "77"), d)
        val no = JetxAutobetRules.parseDecision("""{"allow":false,"code":"verdict_wait","reason":"WAIT","bet":null}""")
        assertFalse(no!!.allow)
        assertNull(no.betId)
        assertNull(JetxAutobetRules.parseDecision("""{"allow":true,"bet":{"id":"1; drop"}}""")?.betId)
        assertNull(JetxAutobetRules.parseDecision("nope"))
        val ask = JSONObject(JetxAutobetRules.askJson(JetxRules.Mode.SHARED, false, true, "a1", -60))
        assertEquals("shared", ask.getString("control"))
        assertTrue(ask.getBoolean("dry_run"))
        assertFalse(ask.getBoolean("real"))
        assertEquals(-60, JetxAutobetRules.tzOffset(3_600_000))
    }

    @Test fun clickRepliesAreStrict() {
        assertTrue(JetxAutobetRules.isHello("""{"ready":true}"""))
        assertFalse(JetxAutobetRules.isHello("""{"ready":true,"x":1}"""))
        val r = JetxAutobetRules.parseClickReply("""{"nonce":"42","ok":false,"reason":"no_bet_button","step":"probe"}""")
        assertEquals(JetxAutobetRules.ClickReply("42", false, "no_bet_button", false), r)
        val b = JetxAutobetRules.parseClickReply("""{"nonce":"42","ok":true,"reason":"ok","step":"bet"}""")
        assertTrue(b!!.bet && b.ok)
        assertNull(JetxAutobetRules.parseClickReply("""{"nonce":"x","ok":true,"reason":"ok"}"""))
        assertNull(JetxAutobetRules.parseClickReply("""{"nonce":"1","ok":true,"reason":"Some page text"}"""))
        assertNull(JetxAutobetRules.parseClickReply("""{"nonce":"1","ok":true,"step":"click"}"""))
        val cmd = JSONObject(JetxAutobetRules.clickJson(real))
        assertEquals("bet", cmd.getString("cmd"))
        assertEquals(1.3, cmd.getDouble("target"), 0.0)
        assertEquals("probe", JSONObject(JetxAutobetRules.probeJson("42")).getString("cmd"))
        assertEquals("click_failed", JSONObject(JetxAutobetRules.voidJson("Bad Reason!")).getString("reason"))
    }

    @Test fun manualBetsCarryStakeTargetAndTimeOnly() {
        val m = JetxAutobetRules.parseManual("""{"manual":{"stake":200,"target":1.5,"at":$now}}""", site, now)
        assertEquals(JetxAutobetRules.Manual(200.0, 1.5, now), m)
        val none = JetxAutobetRules.parseManual("""{"manual":{"stake":50,"target":null,"at":$now}}""", site, now)
        assertNull(none!!.target)
        assertNull(JetxAutobetRules.parseManual("""{"manual":{"stake":50,"at":$now}}""", "http://x.bet", now))
        assertNull(JetxAutobetRules.parseManual("""{"manual":{"stake":50,"at":$now,"user":"ada"}}""", site, now))
        assertNull(JetxAutobetRules.parseManual("""{"manual":{"stake":0,"at":$now}}""", site, now))
        assertNull(JetxAutobetRules.parseManual("""{"manual":{"stake":5,"target":0.5,"at":$now}}""", site, now))
        assertNull(JetxAutobetRules.parseManual("""{"manual":{"stake":5,"at":${now - 3_600_000}}}""", site, now))
        val body = JSONObject(JetxAutobetRules.manualJson(m!!, "m1"))
        assertEquals("manual", body.getString("source"))
        assertTrue(JetxAutobetRules.underLimit(List(9) { now }, now))
        assertFalse(JetxAutobetRules.underLimit(List(10) { now }, now))
    }

    @Test fun theBubbleSaysTargetEstimateAndVerdict() {
        val l = JetxAutobetRules.parseLive("""{"target":1.3,"estimate":{"chance":0.7462,"source":"baseline"},
            "verdict":{"action":"WAIT","reason":"No proven edge."},"recent":[{"multiplier":2.01},{"multiplier":1.1}],
            "kill_switch":false,"demo_mode":true}""")
        assertNotNull(l)
        assertEquals("1.30x · 74.6% · WAIT", JetxAutobetRules.bubbleLine(l!!))
        assertEquals("1.30x\n74.6%\nWAIT", JetxAutobetRules.bubbleLines(l))
        assertEquals(listOf(2.01, 1.1), l.recent)
        assertEquals("green", JetxAutobetRules.tone("BET"))
        assertEquals("amber", JetxAutobetRules.tone("WAIT"))
        assertEquals("red", JetxAutobetRules.tone("STOP"))
        assertEquals("—", JetxAutobetRules.pct(null))
        assertNull(JetxAutobetRules.parseLive("{}"))
    }
}
