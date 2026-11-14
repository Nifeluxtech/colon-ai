package ng.nifelux.colonai

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.11.0: the inline panel stays steady while the thread scrolls (InlineSteady). */
class InlineSteadyTest {
    private fun p(top: Int, h: Int = 400, w: Int = 600) = InlineGeometry.Placement(true, 20, top, w, h, 100, 1500)

    @Test fun sameReportTwiceIsNoMove() {
        val s = InlineSteady()
        assertTrue(s.next(p(300), 0).moved)
        assertFalse(s.next(p(300), 16).moved)
    }

    @Test fun smallSizeWobbleNeverRelayouts() {
        val s = InlineSteady()
        assertTrue(s.next(p(300), 0).relayout)
        val m = s.next(p(300, h = 401, w = 599), 200)
        assertFalse(m.relayout)
        assertEquals(400, m.placement.height)
        assertTrue(s.next(p(300, h = 460), 400).relayout)
    }

    @Test fun steadyScrollLeadsByAboutOneFrameAndSettlesExactly() {
        val s = InlineSteady()
        s.next(p(1000), 0)
        s.next(p(980), 16)
        val m = s.next(p(960), 32)                                  // -20 px a frame: lead about -20
        assertTrue(m.placement.top < 960)
        assertTrue(m.placement.top >= 960 - InlineSteady.MAX_LEAD)
        val settled = s.settle()
        assertNotNull(settled)
        assertEquals(960, settled!!.placement.top)
    }

    @Test fun directionChangeDropsTheLead() {
        val s = InlineSteady()
        s.next(p(1000), 0); s.next(p(980), 16); s.next(p(960), 32)
        assertEquals(970, s.next(p(970), 48).placement.top)           // turned around: exact, no overshoot
    }

    @Test fun leadIsCappedOnAFling() {
        val s = InlineSteady()
        s.next(p(3000), 0); s.next(p(2700), 16); val m = s.next(p(2400), 32)
        assertEquals(2400 - InlineSteady.MAX_LEAD, m.placement.top)
    }

    @Test fun slowReportsAreNotExtrapolated() {
        val s = InlineSteady()
        s.next(p(1000), 0); s.next(p(990), 300); assertEquals(980, s.next(p(980), 600).placement.top)
    }

    @Test fun hiddenResets() {
        val s = InlineSteady()
        s.next(p(300), 0)
        assertTrue(s.next(InlineGeometry.NOWHERE, 16).moved)
        assertTrue(s.next(p(300), 32).moved)
    }
}
