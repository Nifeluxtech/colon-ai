package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

/** Colon JetX (0.35.0, Crash Predictor step 3; diagnostics 0.35.1): the collector's checks on what the game sends. */
class JetxRoundRulesTest {
    private val now = 1_790_000_000_000L
    private val site = "https://games.example.bet"

    @Test fun aRoundFromAnHttpsFrameIsTaken() {
        val r = JetxRoundRules.parse("""{"multiplier":1.53,"seen_at":$now}""", site, now)
        assertNotNull(r)
        assertEquals(1.53, r!!.multiplier, 0.0)
        assertEquals(now, r.seenAt)
        assertNull(r.roundId)
        val withId = JetxRoundRules.parse("""{"multiplier":2,"seen_at":$now,"round_id":"R-881"}""", site, now)
        assertEquals("R-881", withId!!.roundId)
    }

    @Test fun anythingElseIsRefused() {
        val ok = """{"multiplier":1.5,"seen_at":$now}"""
        assertNull(JetxRoundRules.parse(ok, "http://games.example.bet", now))
        assertNull(JetxRoundRules.parse(ok, null, now))
        assertNull(JetxRoundRules.parse("""{"multiplier":1.5,"seen_at":$now,"cookie":"sid=1"}""", site, now))
        assertNull(JetxRoundRules.parse("""{"multiplier":"1.5x","seen_at":$now}""", site, now))
        assertNull(JetxRoundRules.parse("""{"multiplier":0.99,"seen_at":$now}""", site, now))
        assertNull(JetxRoundRules.parse("""{"multiplier":1.234,"seen_at":$now}""", site, now))
        assertNull(JetxRoundRules.parse("""{"multiplier":1.5,"seen_at":${now - 3_600_000}}""", site, now))
        assertNull(JetxRoundRules.parse("""{"multiplier":1.5,"seen_at":$now,"round_id":"<b>"}""", site, now))
        assertNull(JetxRoundRules.parse("not json", site, now))
        assertNull(JetxRoundRules.parse("x".repeat(600), site, now))
        assertNull(JetxRoundRules.parse(null, site, now))
    }

    @Test fun multipliersHaveAtMostTwoDecimals() {
        assertEquals(1.0, JetxRoundRules.multiplier(1)!!, 0.0)
        assertEquals(12.5, JetxRoundRules.multiplier(12.5)!!, 0.0)
        assertEquals(1_000_000.0, JetxRoundRules.multiplier(1_000_000)!!, 0.0)
        assertNull(JetxRoundRules.multiplier(1_000_000.01))
        assertNull(JetxRoundRules.multiplier(Double.NaN))
        assertNull(JetxRoundRules.multiplier("2"))
    }

    @Test fun thePageMayNotFloodTheChannel() {
        val recent = List(JetxRoundRules.MAX_PER_MINUTE) { now - it * 1000L }
        assertFalse(JetxRoundRules.underLimit(recent, now))
        assertTrue(JetxRoundRules.underLimit(recent, now + 60_000L))
        assertTrue(JetxRoundRules.underLimit(emptyList(), now))
    }

    @Test fun theBatchCarriesOnlyTheRounds() {
        val json = JSONObject(JetxRoundRules.batchJson(listOf(JetxRoundRules.Round(1.5, now, null),
            JetxRoundRules.Round(3.0, now + 1, "r9"))))
        assertEquals("collector", json.getString("source"))
        val rounds = json.getJSONArray("rounds")
        assertEquals(2, rounds.length())
        assertEquals(setOf("multiplier", "seen_at"), rounds.getJSONObject(0).keys().asSequence().toSet())
        assertEquals("r9", rounds.getJSONObject(1).getString("round_id"))
        assertEquals(3, JetxRoundRules.inserted("""{"inserted":3,"duplicates":0,"rejected":0}"""))
        assertNull(JetxRoundRules.inserted("oops"))
    }

    @Test fun answersDecideWhatHappensToABatch() {
        assertEquals(JetxRoundRules.Outcome.SENT, JetxRoundRules.outcome(200))
        assertEquals(JetxRoundRules.Outcome.SIGNED_OUT, JetxRoundRules.outcome(401))
        assertEquals(JetxRoundRules.Outcome.RETRY, JetxRoundRules.outcome(429))
        assertEquals(JetxRoundRules.Outcome.RETRY, JetxRoundRules.outcome(503))
        assertEquals(JetxRoundRules.Outcome.RETRY, JetxRoundRules.outcome(0))
        assertEquals(JetxRoundRules.Outcome.DROP, JetxRoundRules.outcome(422))
        assertEquals(JetxRoundRules.FLUSH_MS, JetxRoundRules.backoff(0))
        assertEquals(10_000L, JetxRoundRules.backoff(1))
        assertEquals(JetxRoundRules.MAX_BACKOFF_MS, JetxRoundRules.backoff(30))
    }

    @Test fun roundsTodayFollowThePhonesDay() {
        val lagos = TimeZone.getTimeZone("Africa/Lagos")
        val lateNight = 1_790_031_540_000L // 22:59 UTC = 23:59 in Lagos
        assertEquals(JetxRoundRules.dayOf(lateNight, lagos) + 1, JetxRoundRules.dayOf(lateNight + 60_000L, lagos))
    }

    @Test fun theStatusSaysOffWhenTurnedOff() {
        val on = JetxRoundRules.status(true, JetxRoundRules.State.LIVE, 12, 1.53)
        assertEquals("live", on.getString("status"))
        assertEquals(12, on.getInt("rounds_today"))
        assertEquals(1.53, on.getDouble("last_multiplier"), 0.0)
        val off = JetxRoundRules.status(false, JetxRoundRules.State.LIVE, 0, null)
        assertEquals("off", off.getString("status"))
        assertTrue(off.isNull("last_multiplier"))
        assertTrue("setCollector" in JetxRules.COMMANDS)
    }

    @Test fun aDiagnosticCarriesOnlyTheHostAndCounts() {
        val d = JetxRoundRules.parseDiag("""{"diag":{"frame_host":"evil.example","strip_found":true,"items":12}}""",
            "https://jetx.smartsoftgaming.com")
        assertEquals(JetxRoundRules.Diag("jetx.smartsoftgaming.com", true, 12), d)
        val none = JetxRoundRules.parseDiag("""{"diag":{"strip_found":false,"items":0}}""", site)
        assertEquals(JetxRoundRules.Diag("games.example.bet", false, 0), none)
        assertNull("not a round", JetxRoundRules.parse("""{"diag":{"strip_found":false,"items":0}}""", site, now))
    }

    @Test fun badDiagnosticsAreRefused() {
        val ok = """{"diag":{"strip_found":true,"items":5}}"""
        assertNull(JetxRoundRules.parseDiag(ok, "http://games.example.bet"))
        assertNull(JetxRoundRules.parseDiag(ok, null))
        assertNull(JetxRoundRules.parseDiag("""{"diag":{"strip_found":true,"items":5,"text":"6.49x"}}""", site))
        assertNull(JetxRoundRules.parseDiag("""{"diag":{"strip_found":true,"items":5},"multiplier":2}""", site))
        assertNull(JetxRoundRules.parseDiag("""{"diag":{"strip_found":"yes","items":5}}""", site))
        assertNull(JetxRoundRules.parseDiag("""{"diag":{"strip_found":true,"items":5000}}""", site))
        assertNull(JetxRoundRules.parseDiag("""{"diag":{"strip_found":true,"items":2.5}}""", site))
        assertNull(JetxRoundRules.parseDiag("""{"diag":{"strip_found":false,"items":4}}""", site))
        assertNull(JetxRoundRules.parseDiag("""{"diag":"x"}""", site))
        assertNull(JetxRoundRules.parseDiag("not json", site))
    }

    @Test fun theStatusSumsUpTheFramesHeardFromLately() {
        val a = JetxRoundRules.Diag("www.sportybet.com", false, 0)
        val b = JetxRoundRules.Diag("jetx.example", true, 12)
        val old = JetxRoundRules.Diag("ads.example", true, 30)
        val sum = JetxRoundRules.summarize(listOf(a to now, b to now - 5_000L, old to now - 120_000L), now)
        assertEquals(JetxRoundRules.DiagSummary(2, true, 12), sum)
        val st = JetxRoundRules.status(true, JetxRoundRules.State.WAITING, 3, null, sum, 5, "http_503")
        assertEquals(2, st.getInt("frames_seen"))
        assertTrue(st.getBoolean("strip_found"))
        assertEquals(12, st.getInt("strip_items"))
        assertEquals(5, st.getInt("rounds_sent"))
        assertEquals("http_503", st.getString("last_error"))
        assertTrue(JetxRoundRules.status(true, JetxRoundRules.State.LIVE, 0, null).isNull("last_error"))
        assertEquals(null, JetxRoundRules.errorOf(200))
        assertEquals("signed_out", JetxRoundRules.errorOf(401))
        assertEquals("network", JetxRoundRules.errorOf(0))
    }
}
