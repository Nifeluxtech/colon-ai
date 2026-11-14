package ng.nifelux.colonai

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 0.10.3 (ADR 0006): the AI-only in-chat browser. The card's state machine (ChatRun), what survives a restart, the
 * status pill, the finished cards kept per chat (CardRules), the hand-back note (HandoffNote), the desktop layout
 * (DesktopView), the full-screen view above the composer (InlineGeometry.focus) and the bridge's new fields.
 */
class ChatRunTest {
    private val ai = ControlState.Mode.AI
    private val manual = ControlState.Mode.MANUAL
    private val words = ChatRun.Words("Working", "Paused", "Your turn", "You're in control", "Done", "Stopped",
        "Failed", "App closed") { "Needs you: $it" }

    private fun running() = ChatRun.start("41", "Deploy my app", "m7", 1000L)

    @Test fun aTaskRunsPausesAndResumesFromTheControlState() {
        var r = running()
        assertEquals(ChatRun.State.RUNNING, r.state)
        r = ChatRun.fromControl(r, ai, true, null, ai, 2000L, 0L, false)
        assertEquals(ChatRun.State.PAUSED, r.state)
        r = ChatRun.fromControl(r, ai, false, null, ai, 3000L, 0L, false)
        assertEquals(ChatRun.State.RUNNING, r.state)
        assertEquals("41", r.task)
        assertEquals("m7", r.anchor)
    }

    @Test fun sagaAsksForTheUserTakeControlThenGiveBack() {
        var r = running()
        r = ChatRun.fromControl(r, manual, false, ControlState.Handoff("one_time_code", "Enter the code"), ai,
            5000L, 600_000L, false)
        assertEquals(ChatRun.State.NEEDS_USER, r.state)
        assertEquals("Enter the code", r.request?.message)
        assertEquals(605_000L, r.deadline)
        assertFalse(ChatRun.touchesPage(r.state))
        r = ChatRun.takeControl(r, 6000L)
        assertEquals(ChatRun.State.USER_CONTROL, r.state)
        assertTrue(ChatRun.touchesPage(r.state))
        // A later control event with the same hand-off keeps the user in control.
        r = ChatRun.fromControl(r, manual, false, ControlState.Handoff("one_time_code", "Enter the code"), ai,
            7000L, 600_000L, false)
        assertEquals(ChatRun.State.USER_CONTROL, r.state)
        r = ChatRun.giveBack(r, 8000L)
        assertEquals(ChatRun.State.RUNNING, r.state)
        assertNull(r.request)
        assertEquals(0L, r.deadline)
    }

    @Test fun theUsersOwnTakeControlIsUserControlWithADeadline() {
        val r = ChatRun.fromControl(running(), manual, false, null, ai, 2000L, 0L, false)
        assertEquals(ChatRun.State.USER_CONTROL, r.state)
        assertTrue(r.resumes)
        assertEquals(2000L + ChatRun.USER_TIMEOUT_MS, r.deadline)
        assertTrue(ChatRun.expired(r, r.deadline + ChatRun.GRACE_MS + 1))
        assertFalse(ChatRun.expired(r, r.deadline + 1))
    }

    @Test fun takingAnIdleBrowserResumesNothing() {
        var r = ChatRun.takeControl(ChatRun.IDLE, 1L)
        assertEquals(ChatRun.State.USER_CONTROL, r.state)
        assertFalse(r.resumes)
        // Nothing on the server changes that: a control event leaves it alone.
        assertEquals(r, ChatRun.fromControl(r, manual, false, null, null, 2L, 0L, false))
        r = ChatRun.giveBack(r, 3L)
        assertEquals(ChatRun.State.IDLE, r.state)
    }

    @Test fun theTaskEndsDoneThenItsNoticeRefinesTheLine() {
        var r = ChatRun.fromControl(running(), manual, false, null, null, 9000L, 0L, false)
        assertEquals(ChatRun.State.DONE, r.state)
        r = ChatRun.end(r, "done", "Deployed Colon AI v0.10.2", 9100L)
        assertEquals("Deployed Colon AI v0.10.2", r.result)
        assertEquals(ChatRun.Pill("check", "Deployed Colon AI v0.10.2", false, false, false, false),
            ChatRun.pill(r, words))
        // A failure notice after the control change wins; a later "done" never hides a failure.
        val failed = ChatRun.end(ChatRun.fromControl(running(), manual, false, null, null, 1L, 0L, false), "error",
            "Saga couldn't finish", 2L)
        assertEquals(ChatRun.State.ERROR, failed.state)
        assertEquals(ChatRun.State.ERROR, ChatRun.end(failed, "done", "x", 3L).state)
        assertTrue(ChatRun.pill(failed, words).retry)
    }

    @Test fun theUsersStopIsStopped() {
        val r = ChatRun.fromControl(running(), manual, false, null, null, 2L, 0L, true)
        assertEquals(ChatRun.State.STOPPED, r.state)
        assertEquals("Stopped", ChatRun.pill(r, words).text)
    }

    @Test fun aTaskStartedByConsentGetsItsNameFromTheChat() {
        var r = ChatRun.fromControl(ChatRun.IDLE, ai, false, null, ai, 10L, 0L, false)
        assertEquals(ChatRun.State.RUNNING, r.state)
        assertNull(r.task)
        r = ChatRun.named(r, "52", "Book a table", "m9", 20L)
        assertEquals(ChatRun.State.RUNNING, r.state)
        assertEquals(listOf("52", "Book a table", "m9"), listOf(r.task, r.goal, r.anchor))
        // A new task after a finished one starts afresh.
        val next = ChatRun.named(ChatRun.end(r, "done", "ok", 30L), "53", "Again", "m10", 40L)
        assertEquals(listOf("53", "", ChatRun.State.RUNNING), listOf(next.task, next.result, next.state))
    }

    @Test fun aLiveTaskAfterTheAppDiedIsAnErrorWithRetry() {
        val r = ChatRun.restore(ChatRun.fromControl(running(), manual, false, ControlState.Handoff("pin", "PIN"),
            ai, 1L, 0L, false))
        assertEquals(ChatRun.State.ERROR, r.state)
        assertEquals(ChatRun.Pill("error", "App closed", false, false, true, false), ChatRun.pill(r, words))
        assertEquals(ChatRun.IDLE, ChatRun.restore(ChatRun.IDLE))
    }

    @Test fun theRunSurvivesJson() {
        val r = ChatRun.takeControl(ChatRun.fromControl(running(), manual, false,
            ControlState.Handoff("sign_in", "Sign in here"), ai, 5L, 1000L, false), 6L)
        assertEquals(r, ChatRun.fromJson(JSONObject(ChatRun.toJson(r).toString())))
        assertEquals(ChatRun.IDLE, ChatRun.fromJson(null))
        assertEquals(ChatRun.State.IDLE, ChatRun.fromJson(JSONObject("""{"state":"nonsense"}""")).state)
    }

    @Test fun thePillForEachState() {
        assertEquals("none", ChatRun.pill(ChatRun.IDLE, words).icon)
        val run = ChatRun.step(running(), "Clicking\nDeploy")
        assertEquals(ChatRun.Pill("spinner", "Clicking Deploy", false, false, false, true), ChatRun.pill(run, words))
        val ask = ChatRun.fromControl(run, manual, false, ControlState.Handoff("captcha", "Solve the check"), ai, 1L,
            0L, false)
        assertEquals(ChatRun.Pill("turn", "Needs you: Solve the check", true, false, false, true),
            ChatRun.pill(ask, words))
        assertTrue(ChatRun.pill(ChatRun.takeControl(ask, 2L), words).giveBack)
        // Steps don't change an ended card.
        val done = ChatRun.end(run, "done", "ok", 3L)
        assertEquals(done, ChatRun.step(done, "more"))
    }

    @Test fun cardsKeepTheNewestPicturesWithinTheCaps() {
        val many = (1..25).map { CardRules.Card("t$it", "g", null, "done", "", it.toLong(), "t$it.jpg", 90_000) }
        val (kept, drop) = CardRules.cap(many)
        assertEquals(CardRules.MAX_CARDS, kept.size)
        assertEquals("t25", kept.last().id)
        val shots = kept.filter { it.shot != null }
        assertEquals(CardRules.MAX_SNAPSHOTS, shots.size)
        assertTrue(shots.sumOf { it.bytes } <= CardRules.MAX_BYTES)
        assertEquals(listOf("t20", "t21", "t22", "t23", "t24", "t25"), shots.map { it.id })
        assertTrue("t1.jpg" in drop && "t19.jpg" in drop)
        assertFalse("t25.jpg" in drop)
        // The same task again keeps its picture when the update has none.
        val up = CardRules.upsert(listOf(many[0]), many[0].copy(result = "Done", shot = null, bytes = 0))
        assertEquals(listOf("Done", "t1.jpg"), listOf(up[0].result, up[0].shot))
        assertNull(CardRules.Card.fromJson(JSONObject("""{"id":"x","shot":"../../etc/passwd"}"""))?.shot)
    }

    @Test fun theHandBackNoteNeverCarriesSecrets() {
        assertEquals("I've logged in, continue (page now: dash.example.com/overview \"Overview\")",
            HandoffNote.build("I've logged in, continue", "https://www.dash.example.com/overview?token=abc#x",
                "Overview"))
        assertEquals("The code was [hidden] my password: [hidden] done",
            HandoffNote.scrub("The code was 552019, my password: hunter2 done"))
        assertEquals("Card [number hidden] order 12345", HandoffNote.scrub("Card 4111 1111 1111 1111 order 12345"))
        assertEquals("", HandoffNote.build(null, "javascript:alert(1)", null))
        assertEquals("example.com", HandoffNote.pageOf("https://user:pw@example.com/"))
        assertTrue(HandoffNote.build("x".repeat(900), null, null).length <= HandoffNote.MAX)
    }

    @Test fun theDesktopLayoutFitsTheCardAtWebViewsLowestZoom() {
        assertEquals(1280, DesktopView.layoutWidth(340))        // 1280 / 340 dp needs a 0.27 zoom: fine
        assertEquals(1200, DesktopView.layoutWidth(300))        // 0.25 is the floor: 4 x 300 dp
        assertEquals(980, DesktopView.layoutWidth(200))         // never below the classic desktop width
        assertEquals(1280, DesktopView.layoutWidth(0))
        assertEquals(0.265625f, DesktopView.fitScale(1020, 3f, 1280), 0.0001f)
        assertTrue(DesktopView.script(1280).contains("'width=1280'"))
    }

    @Test fun fullScreenStopsAboveTheComposerEvenWithTheKeyboardOpen() {
        val band = InlineGeometry.bandOf(JSONObject("""{"visible":false,"viewportBottom":640,"pageHeight":760,
            "dpr":2.75}"""))!!
        // Keyboard closed: the shell is 2090 px tall; the composer (120 CSS px) stays below the browser.
        val closed = InlineGeometry.focus(band, 2.75f, 0, 1080, 2090, 2090, 300)
        assertEquals(InlineGeometry.Placement(true, 0, 0, 1080, 1760, 0, 1760), closed)
        // Keyboard open: the chat shrank to 1200 px before the page reported again: the same gap from its bottom.
        assertEquals(870, InlineGeometry.focus(band, 2.75f, 0, 1080, 1200, 1200, 300).height)
        // No report yet: the fallback gap.
        assertEquals(1790, InlineGeometry.focus(null, 2.75f, 0, 1080, 2090, 2090, 300).height)
        assertNull(InlineGeometry.bandOf(JSONObject("""{"visible":false}""")))
    }

    @Test fun thePointerFollowsTheWebViewInsideItsParentAtAnyScale() {
        // Both in the same (scaled) content frame: parent coordinates, no ancestor scale.
        assertEquals(Pair(130f, 90f), SagaTap.toSibling(100f, 60f, 30f, 30f, 0f, 0f))
        // The desktop card: 1280 CSS px zoomed out into a 1020 px WebView; the tools.js fractions give the same
        // spot as the CSS maths, so no density or zoom is needed.
        val (x, y) = SagaTap.fromCss(640f, 400f, 0f, 0f, 1280f, 800f, 1020, 638)
        val p = SagaTap.plan(JSONObject("""{"cx":0.5,"cy":0.5,"in_view":true,"hit":true}"""), 1020, 638, true)
        assertEquals(x, p.x, 0.5f)
        assertEquals(y, p.y, 0.5f)
        // Full screen, pinch-zoomed in on the lower right: the visual viewport is a part of the layout.
        val (zx, zy) = SagaTap.fromCss(1000f, 700f, 900f, 600f, 320f, 400f, 1080, 1350)
        assertEquals(337.5f, zx, 0.01f)
        assertEquals(337.5f, zy, 0.01f)
    }

    @Test fun theBridgeCarriesTheNoteAndTheWait() {
        val f = JSONObject(BridgeProtocol.control(ai, false, "return_to_ai", "I'm done"))
        assertEquals("I'm done", f.getString("note"))
        assertFalse(JSONObject(BridgeProtocol.control(ai, false, "pause")).has("note"))
        val h = BridgeProtocol.parse("""{"type":"handoff","kind":"sign_in","message":"Sign in","timeout_ms":600000}""")
            as BridgeProtocol.Incoming.Handoff
        assertEquals(600_000L, h.timeoutMs)
        val n = BridgeProtocol.parse("""{"type":"notice","text":"Saga stopped","kind":"stopped"}""")
            as BridgeProtocol.Incoming.Notice
        assertEquals("stopped", n.kind)
    }
}
