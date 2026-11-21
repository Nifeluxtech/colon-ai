package ng.nifelux.colonai

import android.media.AudioManager
import android.media.ToneGenerator
import android.util.Log

/**
 * 0.22.1: short sounds for voice. startBeep() when the recognizer is ready for speech (the user knows to talk);
 * chime() when the wake word is heard (0.23.0). One ToneGenerator, made on first use; failures are only logged
 * (some phones refuse a ToneGenerator while another app holds audio focus).
 */
object VoiceCues {
    private const val TAG = "ColonVoice"
    private const val VOLUME = 55 // of 100, on the music stream
    private var tone: ToneGenerator? = null

    private fun play(type: Int, ms: Int) {
        try {
            val t = tone ?: ToneGenerator(AudioManager.STREAM_MUSIC, VOLUME).also { tone = it }
            t.startTone(type, ms)
        } catch (e: Exception) { Log.w(TAG, "tone failed", e); tone = null }
    }

    fun startBeep() = play(ToneGenerator.TONE_PROP_BEEP, 90)

    fun chime() = play(ToneGenerator.TONE_PROP_ACK, 160)
}
