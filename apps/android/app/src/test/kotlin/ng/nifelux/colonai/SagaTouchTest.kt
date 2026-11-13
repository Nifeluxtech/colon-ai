package ng.nifelux.colonai

import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 0.10.2, the owner's report: Saga's touch didn't work, "AI only" let the user's fingers in, and "AI + me" showed
 * nothing of what Saga was doing. The pure parts: the command's `say` and `notice` frames, acks that fit the
 * bridge's frame limit, the lock in "AI only", when notices show, the scroll swipe and the click retry.
 */
class SagaTouchTest {
    private val ai = ControlState.Mode.AI
    private val shared = ControlState.Mode.SHARED
    private val manual = ControlState.Mode.MANUAL

    @Test fun commandsCarrySagasSayAsOneCleanLine() {
        val c = BridgeProtocol.parse("""{"type":"command","id":"c1-x","name":"click","args":{"id":"c3"},""" +
            """"conversation_id":"42","say":"Clicking\n  \"Sign in\"\u0007"}""") as BridgeProtocol.Incoming.Command
        assertEquals("Clicking \"Sign in\"", c.say)
        assertEquals("c3", c.args.getString("id"))
        assertEquals("42", c.conversationId)
        val quiet = BridgeProtocol.parse("""{"type":"command","id":"c2","name":"scroll","args":{}}""")
            as BridgeProtocol.Incoming.Command
        assertNull(quiet.say)
        assertEquals(160, BridgeProtocol.line("x".repeat(500), BridgeProtocol.MAX_SAY)?.length)
        assertNull(BridgeProtocol.line("  \n ", 10))
    }

    @Test fun noticeFramesAreParsedWithAKnownKind() {
        val n = BridgeProtocol.parse("""{"type":"notice","text":"Done.","kind":"done","conversation_id":"7"}""")
            as BridgeProtocol.Incoming.Notice
        assertEquals("Done.", n.text); assertEquals("done", n.kind); assertEquals("7", n.conversationId)
        val odd = BridgeProtocol.parse("""{"type":"notice","text":"Hi","kind":"shout"}""")
            as BridgeProtocol.Incoming.Notice
        assertEquals("step", odd.kind)
        assertTrue(BridgeProtocol.parse("""{"type":"notice","text":"  "}""") is BridgeProtocol.Incoming.Unknown)
    }

    @Test fun aLongPageReadIsTrimmedToFitTheFrameInsteadOfBeingLost() {
        val elements = JSONArray()
        repeat(60) { i -> elements.put(JSONObject().put("id", "c$i").put("tag", "a").put("href", "https://x.ng/" +
            "p".repeat(300))) }
        val result = JSONObject().put("url", "https://x.ng/").put("text", "ẹ".repeat(12_000)).put("elements", elements)
        val big = BridgeProtocol.ack("c1", true, result, null)
        assertTrue(big.toByteArray().size > 20_000)
        val fit = JSONObject(BridgeProtocol.fitAck("c1", true, result, null, max = 20_000))
        assertTrue(fit.toString().toByteArray().size <= 20_000)
        assertTrue(fit.getBoolean("ok"))
        val r = fit.getJSONObject("result")
        assertTrue(r.getBoolean("truncated"))
        assertEquals("https://x.ng/", r.getString("url"))
        assertEquals(12_000, result.getString("text").length)              // the original is untouched
        // Small acks are untouched; something that can't be made to fit becomes an error the server reads.
        assertEquals(BridgeProtocol.ack("c2", true, JSONObject().put("y", 1), null).length,
            BridgeProtocol.fitAck("c2", true, JSONObject().put("y", 1), null).length)
        val huge = JSONObject().put("blob", "z".repeat(5_000))
        val err = JSONObject(BridgeProtocol.fitAck("c3", true, huge, null, max = 1_000))
        assertFalse(err.getBoolean("ok")); assertEquals("too_large", err.getString("error"))
    }

    @Test fun aiOnlyLocksThePageAiAndMeDoesNot() {
        assertTrue(InputGuard.blocksUser(ai))
        assertFalse(InputGuard.blocksUser(shared))
        assertFalse(InputGuard.blocksUser(manual))
        // A paused "AI only" task stays locked: Take control is how the user gets the page back.
        val c = ControlState()
        c.grant(ai, "task"); c.pause()
        assertTrue(InputGuard.blocksUser(c.mode))
        c.takeControl()
        assertFalse(InputGuard.blocksUser(c.mode))
        // The phone's own keys still work; the page's typing doesn't.
        assertFalse(InputGuard.blocksKey(KeyEvent.KEYCODE_BACK))
        assertFalse(InputGuard.blocksKey(KeyEvent.KEYCODE_VOLUME_DOWN))
        assertTrue(InputGuard.blocksKey(KeyEvent.KEYCODE_A))
        assertTrue(InputGuard.blocksKey(KeyEvent.KEYCODE_ENTER))
        assertTrue(InputGuard.blocksKey(KeyEvent.KEYCODE_DPAD_DOWN))
    }

    @Test fun noticesShowInAiAndMeOnlyAndAsksStayLonger() {
        assertTrue(NoticeRules.shows(shared, shared, false))
        assertTrue(NoticeRules.shows(manual, shared, false))      // handed to the user mid-task ("Need your OTP")
        assertTrue(NoticeRules.shows(manual, null, true))         // the task ended in an "AI + me" chat ("Done")
        assertFalse(NoticeRules.shows(ai, ai, false))
        assertFalse(NoticeRules.shows(manual, ai, false))
        assertFalse(NoticeRules.shows(manual, null, false))
        assertTrue(NoticeRules.durationMs("ask") > NoticeRules.durationMs("done"))
        assertTrue(NoticeRules.durationMs("done") > NoticeRules.durationMs("step"))
        assertEquals(NoticeRules.STEP_MS, NoticeRules.durationMs("anything"))
        assertNull(NoticeRules.text(null))
        assertEquals("Typing \"rice\"", NoticeRules.text(" Typing\t\"rice\" "))
    }

    @Test fun scrollIsAFingerSwipeCheckedAfterwards() {
        val down = SagaTap.swipe("down", 1000, 2000, true)!!
        assertTrue(down.fromY > down.toY)                         // the finger goes up: the page moves down
        assertEquals(600f, down.x, 0.01f)
        val up = SagaTap.swipe("up", 1000, 2000, true)!!
        assertTrue(up.fromY < up.toY)
        assertNull(SagaTap.swipe("top", 1000, 2000, true))         // by script
        assertNull(SagaTap.swipe("down", 0, 0, true))
        assertNull(SagaTap.swipe("down", 1000, 2000, false))
        val before = JSONObject().put("y", 0).put("max", 1200)
        assertTrue(SagaTap.scrolled(before, JSONObject().put("y", 640)))
        assertFalse(SagaTap.scrolled(before, JSONObject().put("y", 0)))
        assertFalse(SagaTap.scrolled(before, null))
        assertFalse(SagaTap.scrolled(before, JSONObject().put("error", "page_error")))
    }

    @Test fun aTapThatChangedNothingIsRetriedOnceByScriptNeverForApprovedSteps() {
        val none = JSONObject().put("changed", "none")
        assertTrue(SagaTap.retryWithScript(none, "tap", true))
        assertFalse(SagaTap.retryWithScript(none, "tap", false))             // payment, purchase, message, form
        assertFalse(SagaTap.retryWithScript(none, "script", true))           // already the script click
        assertFalse(SagaTap.retryWithScript(none, "tap+script", true))       // only once
        assertFalse(SagaTap.retryWithScript(JSONObject().put("changed", "focused"), "tap", true))
        assertFalse(SagaTap.retryWithScript(JSONObject().put("changed", "navigated"), "tap", true))
        assertNotNull(SagaApproval.decide(null, "payment", ai, "click"))
        assertNull(SagaApproval.decide(null, null, ai, "click"))
    }
}
