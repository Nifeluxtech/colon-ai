package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.11.1: full screen always has a way back (the corner button, the top bar and the phone's Back). */
class FocusRulesTest {
    private val inline = PanelLayout.Mode.INLINE
    private val embedded = PanelLayout.Mode.EMBEDDED
    private val full = PanelLayout.Mode.FULL

    @Test fun fullScreenInEitherLayout() {
        assertTrue(FocusRules.isFull(open = true, focus = true, docked = true, mode = inline))   // view over the chat
        assertFalse(FocusRules.isFull(open = true, focus = false, docked = true, mode = inline)) // the card
        assertTrue(FocusRules.isFull(open = true, focus = false, docked = false, mode = full))   // stacked FULL
        assertFalse(FocusRules.isFull(open = true, focus = false, docked = false, mode = embedded))
        assertFalse(FocusRules.isFull(open = false, focus = true, docked = true, mode = inline)) // closed: never
    }

    @Test fun backLeavesFullScreenBeforeThePageOrTheChat() {
        assertEquals(FocusRules.Back.VIDEO, FocusRules.back(video = true, open = true, full = true, panelTouched = true))
        assertEquals(FocusRules.Back.COLLAPSE, FocusRules.back(video = false, open = true, full = true,
            panelTouched = true))   // 0.11.0 went back in the page's history first in the stacked FULL layout
        assertEquals(FocusRules.Back.COLLAPSE, FocusRules.back(video = false, open = true, full = true,
            panelTouched = false))
        assertEquals(FocusRules.Back.PAGE, FocusRules.back(video = false, open = true, full = false,
            panelTouched = true))
        assertEquals(FocusRules.Back.NONE, FocusRules.back(video = false, open = true, full = false,
            panelTouched = false))
        assertEquals(FocusRules.Back.NONE, FocusRules.back(video = false, open = false, full = false,
            panelTouched = true))
    }

    @Test fun leavingTheStackedFullLayoutNeverStaysFull() {
        assertEquals(inline, FocusRules.leaveFull(inline))
        assertEquals(embedded, FocusRules.leaveFull(embedded))
        assertEquals(inline, FocusRules.leaveFull(full))
    }

    /** 0.11.2: Minimise really goes back to the card: the full-screen box never sticks once full screen ends. */
    @Test fun minimiseReturnsThePanelToTheCardsBox() {
        val steady = InlineSteady()
        val card = InlineGeometry.Placement(true, 20, 600, 680, 420, 170, 1390)
        steady.next(card, 0)
        val full = InlineGeometry.focus(null, 2f, 0, 720, 1500, 1500, 100)
        assertTrue(full.height > card.height)
        steady.placedElsewhere(full)                                // what ChatBrowserPanel.placeInline does in focus
        assertFalse(FocusRules.isFull(open = true, focus = false, docked = true, mode = inline))
        val back = steady.next(card, 400)
        assertTrue(back.moved)
        assertEquals(card.height, back.placement.height)
        assertEquals(card.top, back.placement.top)
    }

    /** 0.11.2: nothing floats over the page in the thread when the chat page draws the card's header and line. */
    @Test fun chromeDrawnByThePageLeavesTheThreadCardClear() {
        assertFalse(ChatCardRules.floating(full = false, pageChrome = true))
        assertTrue(ChatCardRules.floating(full = false, pageChrome = false))  // an older chat page: as before
        assertTrue(ChatCardRules.floating(full = true, pageChrome = true))    // full screen keeps Minimise
    }
}
