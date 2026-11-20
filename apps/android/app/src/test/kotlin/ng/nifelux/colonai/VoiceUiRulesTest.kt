package ng.nifelux.colonai

import ng.nifelux.colonai.VoiceUiRules.Gesture
import ng.nifelux.colonai.VoiceUiRules.Phase
import ng.nifelux.colonai.VoiceUiRules.Surface
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.20.0 voice mode: the page's voice_ui messages, labels, colours, pill decisions and pill gestures. */
class VoiceUiRulesTest {
    private fun j(s: String) = JSONObject(s)

    @Test fun pageMessagesAreCheckedAndCleaned() {
        assertEquals(VoiceUiRules.Update(Phase.LISTENING, "hello there", false),
            VoiceUiRules.parse(j("""{"state":"listening","caption":"hello\n  there"}""")))
        assertEquals(VoiceUiRules.Update(Phase.MUTED, "", true),
            VoiceUiRules.parse(j("""{"state":"muted","muted":true}""")))
        assertEquals(Phase.IDLE, VoiceUiRules.parse(j("""{"state":"idle","caption":null}"""))?.phase)
        assertNull(VoiceUiRules.parse(j("""{"state":"singing"}""")))
        assertNull(VoiceUiRules.parse(j("""{}""")))
        assertNull(VoiceUiRules.parse(j("""{"state":"speaking","caption":42}""")))
        assertNull(VoiceUiRules.parse(j("""{"state":"speaking","muted":"yes"}""")))
    }

    @Test fun captionsStayShortAndOnOneLine() {
        val long = VoiceUiRules.caption("a".repeat(500))
        assertEquals(VoiceUiRules.CAPTION_MAX, long.length)
        assertTrue(long.endsWith("…"))
        assertEquals("one two", VoiceUiRules.caption("one\u0000\ttwo "))
        assertEquals("", VoiceUiRules.caption(null))
    }

    @Test fun everyPhaseHasItsLabelAndColour() {
        assertEquals(R.string.voice_listening, VoiceUiRules.labelRes(Phase.LISTENING))
        assertEquals(R.string.voice_thinking, VoiceUiRules.labelRes(Phase.THINKING))
        assertEquals(R.string.voice_speaking, VoiceUiRules.labelRes(Phase.SPEAKING))
        assertEquals(R.string.voice_muted, VoiceUiRules.labelRes(Phase.MUTED))
        val colours = listOf(Phase.LISTENING, Phase.THINKING, Phase.SPEAKING, Phase.MUTED).map(VoiceUiRules::accent)
        assertEquals(4, colours.toSet().size)
        colours.forEach { assertEquals(0xFF, it ushr 24) } // opaque
        assertEquals(0xFF38BDF8.toInt(), VoiceUiRules.accent(Phase.LISTENING))
        val g = VoiceUiRules.glow(Phase.SPEAKING)
        assertEquals(g.first(), g.last()) // the sweep gradient closes without a seam
        assertArrayEquals(VoiceUiRules.glow(Phase.IDLE), VoiceUiRules.glow(Phase.MUTED))
        assertEquals(0f, VoiceUiRules.waveEnergy(Phase.MUTED), 0f)
        assertTrue(VoiceUiRules.waveEnergy(Phase.SPEAKING) > VoiceUiRules.waveEnergy(Phase.THINKING))
    }

    @Test fun pillNeedsTheOverlayPermissionAndAsksOnlyOnce() {
        assertEquals(Surface.PILL, VoiceUiRules.surface(false, canDrawOverlays = true, askedBefore = true))
        assertEquals(Surface.ASK, VoiceUiRules.surface(false, canDrawOverlays = false, askedBefore = false))
        assertEquals(Surface.NOTIFICATION, VoiceUiRules.surface(false, canDrawOverlays = false, askedBefore = true))
        assertEquals(Surface.NOTIFICATION, VoiceUiRules.surface(true, canDrawOverlays = true, askedBefore = false))
    }

    @Test fun pillOnlyWhileVoiceRunsAndColonIsNotOnScreen() {
        assertTrue(VoiceUiRules.showPill(Phase.LISTENING, appVisible = false, surface = Surface.PILL))
        assertTrue(VoiceUiRules.showPill(Phase.MUTED, appVisible = false, surface = Surface.PILL))
        assertFalse(VoiceUiRules.showPill(Phase.LISTENING, appVisible = true, surface = Surface.PILL))
        assertFalse(VoiceUiRules.showPill(Phase.IDLE, appVisible = false, surface = Surface.PILL))
        assertFalse(VoiceUiRules.showPill(Phase.SPEAKING, appVisible = false, surface = Surface.NOTIFICATION))
    }

    @Test fun compactStartStepsBackOnlyWhenThePillCanTakeOver() {
        assertTrue(VoiceUiRules.stepBack(true, Phase.LISTENING, canDrawOverlays = true, serviceForeground = true))
        assertFalse(VoiceUiRules.stepBack(false, Phase.LISTENING, canDrawOverlays = true, serviceForeground = true))
        assertFalse(VoiceUiRules.stepBack(true, Phase.LISTENING, canDrawOverlays = false, serviceForeground = true))
        assertFalse(VoiceUiRules.stepBack(true, Phase.LISTENING, canDrawOverlays = true, serviceForeground = false))
        assertFalse(VoiceUiRules.stepBack(true, Phase.IDLE, canDrawOverlays = true, serviceForeground = true))
    }

    @Test fun cornersFollowTheDisplayOrFallBackTo24dp() {
        assertEquals(96f, VoiceUiRules.cornerRadiusPx(96, 3f), 0f)
        assertEquals(72f, VoiceUiRules.cornerRadiusPx(null, 3f), 0f)
        assertEquals(48f, VoiceUiRules.cornerRadiusPx(0, 2f), 0f)
    }

    @Test fun pillGestures() {
        val d = 2.75f // a 440 dpi phone such as the Infinix SMART 20
        assertEquals(Gesture.TAP, VoiceUiRules.gesture(3f, 2f, 120, d))
        assertEquals(Gesture.LONG_PRESS, VoiceUiRules.gesture(0f, 0f, 700, d))
        assertEquals(Gesture.SWIPE_END, VoiceUiRules.gesture(200f, 0f, 150, d))
        assertEquals(Gesture.SWIPE_END, VoiceUiRules.gesture(0f, -160f, 900, d))
        assertEquals(Gesture.NONE, VoiceUiRules.gesture(60f, 0f, 150, d)) // moved, but not far enough
        assertNotEquals(Gesture.TAP, VoiceUiRules.gesture(0f, 0f, VoiceUiRules.LONG_PRESS_MS, d))
    }
}
