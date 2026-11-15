package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.11.6: the phone's side of a Saga wait on the Colon Secured Login form (LoginWait, ChatRun's pill). Owner's
 *  report: the form was saved, yet Give back never left the phone because the card was still "running". */
class LoginWaitTest {
    private val words = ChatRun.Words("Working", "Paused", "Your turn", "You're in control", "Done", "Stopped",
        "Failed", "App closed") { "Saga needs you: $it" }
    private val running = ChatRun.start("7", "Log in to yolotask", null, 1L)
    private val asked = running.copy(state = ChatRun.State.NEEDS_USER,
        request = ChatRun.Request("login", "Save your reviewer.yolotask.com.ng login"))

    @Test fun theFormAlwaysGivesBackWhateverTheCardShows() {
        // The bug: the form returned while the card still said "running": nothing was sent.
        assertTrue(LoginWait.open(running, "reviewer.yolotask.com.ng"))
        assertTrue(LoginWait.sends(running, loginWait = true))
        assertTrue(LoginWait.sends(ChatRun.IDLE, loginWait = true))       // a lost state: still sent (restored)
        assertTrue(LoginWait.open(asked, null))                            // the card knows: open too
        // Without a login wait, the 0.10.3 rule: only when Saga asked or the user took over a running task.
        assertFalse(LoginWait.sends(running, loginWait = false))
        assertTrue(LoginWait.sends(asked, loginWait = false))
        assertTrue(LoginWait.sends(running.copy(state = ChatRun.State.USER_CONTROL, resumes = true), false))
        assertFalse(LoginWait.sends(running.copy(state = ChatRun.State.USER_CONTROL, resumes = false), false))
        assertFalse(LoginWait.open(running, null))
    }

    @Test fun notesSavedClosedAndTypedContinue() {
        assertEquals("Login saved for reviewer.yolotask.com.ng in Colon Secured Login",
            LoginWait.formNote("reviewer.yolotask.com.ng"))
        assertEquals("I didn't save a login.", LoginWait.formNote(null))
        // "continue" while the vault has the login: Saga is told it is saved (it signs in at once).
        assertEquals("Login saved for yolotask.com.ng in Colon Secured Login",
            LoginWait.note("continue", true, "yolotask.com.ng"))
        assertEquals("continue", LoginWait.note("continue", true, null))
        assertEquals("continue", LoginWait.note("continue", false, "yolotask.com.ng"))
        assertEquals("I didn't save a login.", LoginWait.note("I didn't save a login.", true, "x.ng"))
        // The note starts as the server's SAVED_NOTE expects, even with the page added (HandoffNote).
        assertTrue(HandoffNote.build(LoginWait.formNote("x.ng"), "https://x.ng/login", "Sign in")
            .startsWith("Login saved for x.ng"))
    }

    @Test fun siteAndResumeOnSaved() {
        assertEquals("a.ng", LoginWait.site("a.ng", "b.ng", "https://c.ng/"))
        assertEquals("b.ng", LoginWait.site(null, "b.ng", "https://c.ng/"))
        assertEquals("c.ng", LoginWait.site(null, null, "https://www.c.ng/login"))
        assertTrue(LoginWait.resumesOnSaved(open = true, answered = false, savedSite = "a.ng"))
        assertFalse(LoginWait.resumesOnSaved(open = true, answered = true, savedSite = "a.ng"))
        assertFalse(LoginWait.resumesOnSaved(open = false, answered = false, savedSite = "a.ng"))
        assertFalse(LoginWait.resumesOnSaved(open = true, answered = false, savedSite = null))
    }

    @Test fun theWaitingCardOffersTheLoginFormAndStop() {
        val p = ChatRun.pill(asked, words)
        assertTrue(p.login)
        assertTrue(p.stop)
        assertFalse(p.takeControl)
        // Any other request keeps Take control.
        val other = ChatRun.pill(asked.copy(request = ChatRun.Request("captcha", "Solve it")), words)
        assertFalse(other.login)
        assertTrue(other.takeControl)
        // Give back resumes Saga from the login request.
        assertEquals(ChatRun.State.RUNNING, ChatRun.giveBack(asked, 2L).state)
    }
}
