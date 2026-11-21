package ng.nifelux.colonai

/**
 * 0.23.0 (OS Assistant Step 5): "Hey Colon". The keyword spotter behind [WakeWordEngine] runs on the phone, offline.
 *
 * Engine: sherpa-onnx keyword spotting (Apache-2.0), model sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01-mobile,
 * keywords line [KEYWORDS] (no training; SherpaKwsEngine, built only when CI downloaded the AAR and the model, see
 * docs/os-assistant/step-5.md). Backup: openWakeWord (Apache-2.0 code; a "hey colon" model has to be trained with
 * its free Colab notebook, then run through ONNX Runtime) as another [WakeWordEngine]; nothing else changes.
 *
 * [WakeWordDetector] is the engine-independent part (unit tested with a fake engine): 16-bit PCM to floats, a
 * cooldown so one "Hey Colon" never fires twice, and a stop on the first engine error (a missing native library
 * throws UnsatisfiedLinkError, which must never crash the service).
 */
interface WakeWordEngine {
    /** Shown in logs and the settings status. */
    val name: String

    /** Feeds 16 kHz mono samples in [-1, 1]; returns the keyword heard in them, or null. */
    fun accept(samples: FloatArray): String?

    /** Forgets what it heard so far (after a pause, so old audio never completes a keyword). */
    fun reset()

    fun release()

    companion object {
        const val SAMPLE_RATE = 16000
        /** The sherpa-onnx keywords file line for "Hey Colon" (BPE tokens of the gigaspeech model). */
        const val KEYWORDS = "▁HE Y ▁COL ON"
    }
}

class WakeWordDetector(
    private val engine: WakeWordEngine,
    private val cooldownMs: Long = COOLDOWN_MS,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private var lastHit: Long? = null

    /** True once the engine threw: the detector stays quiet and the service reports "unavailable". */
    var failed = false
        private set
    var error: String? = null
        private set

    /** Feeds [count] samples of [pcm]; returns the keyword when "Hey Colon" was just heard (not in cooldown). */
    fun feed(pcm: ShortArray, count: Int = pcm.size): String? {
        if (failed || count <= 0) return null
        val hit = try { engine.accept(toFloats(pcm, minOf(count, pcm.size))) } catch (e: Throwable) {
            failed = true; error = e.javaClass.simpleName + (e.message?.let { ": $it" } ?: ""); return null
        }
        if (hit.isNullOrBlank()) return null
        val now = clock()
        val last = lastHit
        if (last != null && now - last < cooldownMs) return null
        lastHit = now
        return hit.trim()
    }

    /** After a pause: drop half-heard audio. */
    fun reset() { if (!failed) try { engine.reset() } catch (_: Throwable) { } }

    fun release() { try { engine.release() } catch (_: Throwable) { } }

    companion object {
        const val COOLDOWN_MS = 3000L

        fun toFloats(pcm: ShortArray, count: Int): FloatArray = FloatArray(count) { pcm[it] / 32768f }
    }
}
