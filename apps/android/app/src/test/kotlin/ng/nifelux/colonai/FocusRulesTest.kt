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
}
