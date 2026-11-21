package ng.nifelux.colonai

import ng.nifelux.colonai.WakeWordRules.Decision
import ng.nifelux.colonai.WakeWordRules.Inputs
import ng.nifelux.colonai.WakeWordRules.Mic
import ng.nifelux.colonai.WakeWordRules.Reason
import ng.nifelux.colonai.WakeWordRules.State
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 0.23.0 "Hey Colon": the engine wrapper (with a fake engine) and the service's state machine. */
class WakeWordTest {
    /** Says [hits] for the chunk numbers listed; throws on [throwAt]. */
    private class FakeEngine(val hits: Set<Int> = emptySet(), val throwAt: Int = -1) : WakeWordEngine {
        override val name = "fake"
        var chunks = 0; var resets = 0; var released = false; var last: FloatArray? = null
        override fun accept(samples: FloatArray): String? {
            val i = chunks++; last = samples
            if (i == throwAt) throw UnsatisfiedLinkError("no sherpa-onnx-jni")
            return if (i in hits) "▁HE Y ▁COL ON" else null
        }
        override fun reset() { resets++ }
        override fun release() { released = true }
    }

    private val chunk = ShortArray(1600)

    @Test fun pcmIsScaledToMinusOneToOne() {
        val f = WakeWordDetector.toFloats(shortArrayOf(0, 16384, -32768, 32767), 4)
        assertEquals(0f, f[0], 0f); assertEquals(0.5f, f[1], 1e-6f); assertEquals(-1f, f[2], 0f)
        assertTrue(f[3] < 1f && f[3] > 0.999f)
    }

    @Test fun feedsOnlyTheSamplesRead() {
        val e = FakeEngine(); WakeWordDetector(e).feed(chunk, 320)
        assertEquals(320, e.last!!.size)
    }

    @Test fun reportsTheKeyword() {
        val d = WakeWordDetector(FakeEngine(setOf(1)), clock = { 0L })
        assertNull(d.feed(chunk)); assertEquals("▁HE Y ▁COL ON", d.feed(chunk))
    }

    @Test fun cooldownStopsADoubleFire() {
        var now = 1_000L
        val d = WakeWordDetector(FakeEngine(setOf(0, 1, 2)), cooldownMs = 3000, clock = { now })
        assertTrue(d.feed(chunk) != null)
        now += 500; assertNull(d.feed(chunk))
        now += 3000; assertTrue(d.feed(chunk) != null)
    }

    @Test fun anEngineErrorStopsQuietly() {
        val e = FakeEngine(setOf(1), throwAt = 0)
        val d = WakeWordDetector(e)
        assertNull(d.feed(chunk)); assertTrue(d.failed); assertTrue(d.error!!.contains("UnsatisfiedLinkError"))
        assertNull(d.feed(chunk)); assertEquals(1, e.chunks) // never called again
        d.reset(); assertEquals(0, e.resets)
    }

    @Test fun emptyReadsAreIgnoredAndReleaseReachesTheEngine() {
        val e = FakeEngine(); val d = WakeWordDetector(e)
        assertNull(d.feed(chunk, 0)); assertEquals(0, e.chunks)
        d.reset(); assertEquals(1, e.resets); d.release(); assertTrue(e.released)
    }

    @Test fun keywordsLineIsTheGigaspeechTokens() = assertEquals("▁HE Y ▁COL ON", WakeWordEngine.KEYWORDS)

    private fun d(i: Inputs) = WakeWordRules.decide(i)

    @Test fun offUnlessSwitchedOn() {
        assertEquals(Decision(State.OFF, Reason.NONE), d(Inputs(enabled = false, inCall = true)))
        assertFalse(WakeWordRules.keepService(d(Inputs(enabled = false))))
        assertEquals(Decision(State.LISTENING, Reason.NONE), d(Inputs(enabled = true)))
    }

    @Test fun pauseReasonsInPriorityOrder() {
        val all = Inputs(enabled = true, micPermission = false, engineReady = false, inCall = true,
            colonUsingMic = true, heardRecently = true, otherAppRecording = true, powerSave = true)
        assertEquals(Reason.NO_PERMISSION, d(all).reason)
        assertEquals(Reason.NO_ENGINE, d(all.copy(micPermission = true)).reason)
        val ready = all.copy(micPermission = true, engineReady = true)
        assertEquals(Reason.CALL, d(ready).reason)
        assertEquals(Reason.COLON, d(ready.copy(inCall = false)).reason)
        assertEquals(Reason.HEARD, d(ready.copy(inCall = false, colonUsingMic = false)).reason)
        assertEquals(Reason.MIC_BUSY, d(ready.copy(inCall = false, colonUsingMic = false, heardRecently = false))
            .reason)
        val saver = Inputs(enabled = true, powerSave = true)
        assertEquals(Decision(State.PAUSED, Reason.BATTERY), d(saver))
        assertEquals(State.LISTENING, d(saver.copy(pauseOnSaver = false)).state)
        assertTrue(WakeWordRules.keepService(d(all)))
    }

    @Test fun micOpensAndClosesOnlyOnChange() {
        assertEquals(Mic.OPEN, WakeWordRules.mic(State.PAUSED, State.LISTENING))
        assertEquals(Mic.OPEN, WakeWordRules.mic(State.OFF, State.LISTENING))
        assertEquals(Mic.CLOSE, WakeWordRules.mic(State.LISTENING, State.PAUSED))
        assertEquals(Mic.CLOSE, WakeWordRules.mic(State.LISTENING, State.OFF))
        assertEquals(Mic.KEEP, WakeWordRules.mic(State.LISTENING, State.LISTENING))
        assertEquals(Mic.KEEP, WakeWordRules.mic(State.PAUSED, State.PAUSED))
    }

    @Test fun aCallThenResume() {
        var was = State.LISTENING
        val seq = listOf(Inputs(enabled = true, inCall = true), Inputs(enabled = true))
        val mics = seq.map { val n = d(it).state; WakeWordRules.mic(was, n).also { was = n } }
        assertEquals(listOf(Mic.CLOSE, Mic.OPEN), mics)
    }

    @Test fun labelsAndCheckRhythm() {
        assertEquals("wake_listening", WakeWordRules.label(d(Inputs(enabled = true))))
        assertEquals("wake_paused_call", WakeWordRules.label(d(Inputs(enabled = true, inCall = true))))
        assertEquals("wake_paused_colon", WakeWordRules.label(d(Inputs(enabled = true, heardRecently = true))))
        assertEquals("wake_paused_battery", WakeWordRules.label(d(Inputs(enabled = true, powerSave = true))))
        assertEquals(3000L, WakeWordRules.checkEveryMs(d(Inputs(enabled = true))))
        assertEquals(1500L, WakeWordRules.checkEveryMs(d(Inputs(enabled = true, inCall = true))))
    }

    @Test fun callModes() {
        assertFalse(WakeWordRules.isCallMode(0)) // MODE_NORMAL
        assertTrue(WakeWordRules.isCallMode(1)); assertTrue(WakeWordRules.isCallMode(2))
        assertTrue(WakeWordRules.isCallMode(3)); assertFalse(WakeWordRules.isCallMode(4)) // MODE_CALL_SCREENING
    }
}
