package ng.nifelux.colonai

import ng.nifelux.colonai.JetxOverlayRules.Status
import ng.nifelux.colonai.JetxOverlayRules.Tone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Colon JetX 0.39.1: the full-screen "what Colon sees" column and the bubble's new default. */
class JetxOverlayRulesTest {
    @Test fun colourBuckets() {
        assertEquals(Tone.LOW, JetxOverlayRules.tone(1.0))
        assertEquals(Tone.LOW, JetxOverlayRules.tone(1.99))
        assertEquals(Tone.MID, JetxOverlayRules.tone(2.0))
        assertEquals(Tone.MID, JetxOverlayRules.tone(9.99))
        assertEquals(Tone.HIGH, JetxOverlayRules.tone(10.0))
        assertEquals(Tone.HIGH, JetxOverlayRules.tone(41.61))
    }

    @Test fun statusDot() {
        val now = 100_000L
        assertEquals(Status.OFF, JetxOverlayRules.status(false, true, 7, now, now))
        assertEquals(Status.READING, JetxOverlayRules.status(true, false, 7, now - 4_000, now))
        assertEquals(Status.READING, JetxOverlayRules.status(true, false, 5, now - 5_000, now))
        assertEquals("stale", Status.NO_CHIPS, JetxOverlayRules.status(true, false, 7, now - 5_001, now))
        assertEquals("too few", Status.NO_CHIPS, JetxOverlayRules.status(true, false, 4, now, now))
        assertEquals("never read", Status.NO_CHIPS, JetxOverlayRules.status(true, false, 0, 0, now))
        assertEquals("the DOM collector has the strip", Status.READING,
            JetxOverlayRules.status(true, true, 0, 0, now))
    }

    @Test fun labelsAndFreshness() {
        assertEquals("2.83x", JetxOverlayRules.label(2.83))
        assertEquals("1.00x", JetxOverlayRules.label(1.0))
        assertEquals("1520x", JetxOverlayRules.label(1520.5))
        assertTrue(JetxOverlayRules.liveFresh(1_000, 20_000))
        assertFalse(JetxOverlayRules.liveFresh(1_000, 40_000))
        assertFalse(JetxOverlayRules.liveFresh(0, 10))
    }

    @Test fun columnBandSitsUnderTheStripAndAboveTheBetPanel() {
        assertEquals(JetxOverlayRules.TOP_DEFAULT to JetxOverlayRules.BOTTOM, JetxOverlayRules.band(null))
        val (t, b) = JetxOverlayRules.band(0.09f)
        assertEquals(0.10f, t, 0.0001f)
        assertEquals(JetxOverlayRules.BOTTOM, b)
        assertEquals("odd strip spot ignored", JetxOverlayRules.TOP_DEFAULT, JetxOverlayRules.band(0.9f).first)
        assertTrue(JetxOverlayRules.band(Float.NaN).second <= 0.6f)
    }

    @Test fun bubbleDefaultsToTheRightEdgeAndOldSpotsResetOnce() {
        assertTrue(JetxRules.BUBBLE_X > 0.9f)
        assertTrue(JetxRules.BUBBLE_Y in 0.3f..0.5f)
        assertTrue(JetxOverlayRules.resetBubble(0))
        assertTrue(JetxOverlayRules.resetBubble(1))
        assertFalse(JetxOverlayRules.resetBubble(JetxOverlayRules.BUBBLE_SCHEME))
        assertEquals(JetxRules.Layout.GAME, JetxRules.launchLayout())
    }
}
