package ng.nifelux.colonai

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * 0.20.1: the phone's own speech recognizer for the chat page (main thread only). The app's WebView has no Web
 * Speech API, so English voice input used to be recorded and transcribed on the server: slow, and no live words.
 * Feature "listen" (only when the phone has a recognition service): ColonNative.call('listen',
 * {action: start|stop|cancel, id, lang}); events 'listen' {id, type: partial|final|level|error|end, text?, v?, error?}.
 * One recognition per start (the page restarts it after each pause, like Chrome's dictation); see native-listen.js.
 */
object NativeListen {
    private const val LEVEL_EVERY_MS = 80L

    private var recognizer: SpeechRecognizer? = null
    private var id: String? = null
    private var host: WeakReference<MainActivity>? = null
    private var lastLevel = 0L

    fun available(context: Context): Boolean =
        try { SpeechRecognizer.isRecognitionAvailable(context) } catch (_: Exception) { false }

    fun handle(a: MainActivity, args: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        when (args.optString("action")) {
            "start" -> start(a, args.optString("id"), args.optString("lang").ifBlank { "en-NG" }, done)
            "stop" -> { if (args.optString("id") == id) recognizer?.stopListening(); done(true, null, null) }
            "cancel" -> { if (args.optString("id") == id) release(); done(true, null, null) }
            else -> done(false, null, "bad_args")
        }
    }

    private fun start(a: MainActivity, sid: String, lang: String, done: (Boolean, Any?, String?) -> Unit) {
        if (sid.isBlank()) { done(false, null, "bad_args"); return }
        if (ContextCompat.checkSelfPermission(a, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED) { done(false, null, "denied"); return }
        if (!available(a)) { done(false, null, "unavailable"); return }
        release()
        host = WeakReference(a); id = sid
        val r = try { SpeechRecognizer.createSpeechRecognizer(a.applicationContext) } catch (_: Exception) { null }
        if (r == null) { id = null; done(false, null, "unavailable"); return }
        recognizer = r
        r.setRecognitionListener(Listener(sid))
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, a.packageName)
        try { r.startListening(intent); done(true, null, null) }
        catch (_: Exception) { release(); done(false, null, "unavailable") }
    }

    private fun release() {
        val r = recognizer
        recognizer = null; id = null
        try { r?.cancel() } catch (_: Exception) { }
        try { r?.destroy() } catch (_: Exception) { }
    }

    private fun emit(sid: String, data: JSONObject) {
        if (sid != id) return
        host?.get()?.emitToPage("listen", data.put("id", sid))
    }

    /** Ends this session: tells the page, then frees the recognizer (a new start makes a fresh one). */
    private fun finish(sid: String) {
        if (sid != id) return
        emit(sid, JSONObject().put("type", "end"))
        release()
    }

    /** SpeechRecognizer error codes → the Web Speech API's names, which media.js already handles. */
    fun errorName(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
        SpeechRecognizer.ERROR_SERVER -> "network"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
        SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
        else -> "other"
    }

    private class Listener(val sid: String) : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { }
        override fun onBeginningOfSpeech() { }
        override fun onBufferReceived(buffer: ByteArray?) { }
        override fun onEndOfSpeech() { }
        override fun onEvent(eventType: Int, params: Bundle?) { }

        override fun onRmsChanged(rmsdB: Float) {
            val now = SystemClock.uptimeMillis()
            if (now - lastLevel < LEVEL_EVERY_MS) return
            lastLevel = now
            val v = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f) // about -2..10 dB from the recognizer
            emit(sid, JSONObject().put("type", "level").put("v", (v * 0.4f).toDouble()))
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val t = best(partialResults) ?: return
            emit(sid, JSONObject().put("type", "partial").put("text", t))
        }

        override fun onResults(results: Bundle?) {
            val t = best(results)
            if (!t.isNullOrBlank()) emit(sid, JSONObject().put("type", "final").put("text", t))
            finish(sid)
        }

        override fun onError(error: Int) {
            emit(sid, JSONObject().put("type", "error").put("error", errorName(error)))
            finish(sid)
        }

        private fun best(b: Bundle?): String? =
            b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
    }
}
