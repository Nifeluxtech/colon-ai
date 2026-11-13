package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Phase 9 (v0.9.0): when Saga waits for the user's tap, and reading tools.js results. */
class SagaApprovalTest {
    private val ai = ControlState.Mode.AI
    private val shared = ControlState.Mode.SHARED

    @Test fun theStrongerOfServerAndPhoneWins() {
        assertEquals("payment", SagaApproval.decide("personal_data", "payment", ai, "click"))
        assertEquals("purchase", SagaApproval.decide("purchase", null, ai, "click"))
        assertEquals("form_submission", SagaApproval.decide(null, "form_submission", ai, "fill"))
        assertNull(SagaApproval.decide(null, null, ai, "click"))
    }

    @Test fun theServerCanAddButNeverRemoveAnApproval() {
        // An unknown or empty kind from the server is ignored; the phone's own check still counts.
        assertEquals("payment", SagaApproval.decide("none", "payment", ai, "click"))
        val args = JSONObject("""{"id":"c1","approved":true,"approval":{"kind":"none"}}""")
        assertNull(SagaApproval.serverKind(args))
        assertEquals("send_message", SagaApproval.serverKind(JSONObject("""{"approval":{"kind":"send_message"}}""")))
    }

    @Test fun sharedModeAsksBeforeEveryStepThatChangesThePage() {
        assertEquals("shared", SagaApproval.decide(null, null, shared, "open_url"))
        assertEquals("shared", SagaApproval.decide(null, null, shared, "click"))
        assertEquals("payment", SagaApproval.decide(null, "payment", shared, "click"))
        assertNull(SagaApproval.decide(null, null, shared, "get_page_content"))
        assertNull(SagaApproval.decide(null, null, ai, "open_url"))
    }

    @Test fun decodesEvaluateJavascriptResults() {
        val raw = JSONObject.quote("""{"url":"https://punchng.com/","elements":[]}""")
        assertEquals("https://punchng.com/", SagaTools.decode(raw)?.optString("url"))
        assertNull(SagaTools.decode("null"))
        assertNull(SagaTools.decode("{not json"))
    }

    @Test fun advertisesThePhase9Commands() {
        for (c in listOf("get_page_content", "get_links", "click", "fill", "scroll", "screenshot")) {
            assertTrue(c, c in BridgeProtocol.COMMANDS)
        }
    }
}
