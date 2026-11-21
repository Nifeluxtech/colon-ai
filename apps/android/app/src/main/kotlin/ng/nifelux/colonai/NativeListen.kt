package ng.nifelux.colonai

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * 0.20.1: the phone's own speech recognizer for the chat page (main thread only). The app's WebView has no Web
 * Speech API, so English voice input used to be recorded and transcribed on the server: slow, and no live words.
 * Feature "listen" (only when the phone has a recognition service): ColonNative.call('listen',
 * {action: start|stop|cancel, id, lang}); events 'listen' {id, type: partial|final|level|error|end, text?, v?, error?}.
 * One recognition per start (the page restarts it after each pause, like Chrome's dictation); see native-listen.js.
 *
 * 0.22.1 (voice mode over other apps heard nothing): every recognizer error is logged (tag ColonVoice) and named
 * properly (VoiceUiRules.recognizerError; busy/client used to be "other", which left voice mode on "Listening…"); a
 * new recognizer starts a moment after the old one is released (an immediate restart answered ERROR_RECOGNIZER_BUSY
 * on some phones); a language the speech service can't do is retried once in en-US; and the real level, the words
 * heard and any error go straight to the voice overlay (VoiceService), which no longer waits on the chat page.
 *
 * 0.22.1 latency (budget: mic ready < 300 ms, docs/os-assistant/voice-ui.md): a recognizer is pre-warmed when the
 * app or the voice overlay opens (binding the speech service is the slow part) and the next one is made as soon as
 * the old one is released; onReadyForSpeech sends {type: 'ready'} to the page and plays a short start beep; the
 * end-of-speech silences are shortened (700 / 500 ms) and on-device recognition is preferred where the phone has it.
 */
object NativeListen {
    private const val TAG = "ColonVoice"
    private const val LEVEL_EVERY_MS = 80L
    private const val RESTART_GAP_MS = 250L

    private var recognizer: SpeechRecognizer? = null
    private var id: String? = null
    private var host: WeakReference<MainActivity>? = null
    private var lastLevel = 0L
    private var lang = "en-NG"
    private var retried = false
    private var releasedAt = 0L
    private val main = Handler(Looper.getMainLooper())
    /** A recognizer made ahead of time (not listening), so a start doesn't wait for the speech service to bind. */
    private var spare: SpeechRecognizer? = null
    private const val SILENCE_COMPLETE_MS = 700L
    private const val SILENCE_POSSIBLY_COMPLETE_MS = 500L

    /** 0.23.0: a session is on (the wake word stays paused until it ends). */
    val inUse: Boolean get() = id != null

    fun available(context: Context): Boolean =
        try { SpeechRecognizer.isRecognitionAvailable(context) } catch (_: Exception) { false }

    fun handle(a: MainActivity, args: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        when (args.optString("action")) {
            "start" -> start(a, args.optString("id"), args.optString("lang").ifBlank { "en-NG" }, done)
            "stop" -> {
                val sid = args.optString("id")
                if (sid == id) { if (recognizer == null) finish(sid) else recognizer?.stopListening() }
                done(true, null, null)
            }
            "cancel" -> { if (args.optString("id") == id) release(); done(true, null, null) }
            else -> done(false, null, "bad_args")
        }
    }

    private fun start(a: MainActivity, sid: String, language: String, done: (Boolean, Any?, String?) -> Unit) {
        if (sid.isBlank()) { done(false, null, "bad_args"); return }
        if (ContextCompat.checkSelfPermission(a, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "start refused: RECORD_AUDIO not granted")
            VoiceService.instance?.problem(a.getString(R.string.voice_err_permission))
            done(false, null, "denied"); return
        }
        if (!available(a)) {
            Log.w(TAG, "start refused: no recognition service"); done(false, null, "unavailable"); return
        }
        release()
        host = WeakReference(a); id = sid; lang = language; retried = false
        WakeWordService.yieldMic() // 0.23.0: "Hey Colon" lets go of the mic while Colon's recognizer runs
        done(true, null, null)
        // The page restarts after every pause: give the speech service a moment to let go of the last session.
        val wait = RESTART_GAP_MS - (SystemClock.uptimeMillis() - releasedAt)
        if (wait > 0) main.postDelayed({ if (id == sid) begin(a, sid) }, wait) else begin(a, sid)
    }

    private fun begin(a: MainActivity, sid: String) {
        val r = spare?.also { spare = null } ?: try { SpeechRecognizer.createSpeechRecognizer(a.applicationContext) }
            catch (e: Exception) { Log.w(TAG, "createSpeechRecognizer failed", e); null }
        if (r == null) { fail(sid, "other"); return }
        recognizer = r
        r.setRecognitionListener(Listener(sid))
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, a.packageName)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, SILENCE_COMPLETE_MS)
            .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
                SILENCE_POSSIBLY_COMPLETE_MS)
        // On-device first where the phone says it has it (Android 12+); a language retry goes back to the default.
        if (!retried && onDevice(a)) intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        try { r.startListening(intent) }
        catch (e: Exception) { Log.w(TAG, "startListening failed", e); fail(sid, "other") }
    }

    private fun onDevice(c: Context): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        try { SpeechRecognizer.isOnDeviceRecognitionAvailable(c) } catch (_: Exception) { false }

    /** 0.22.1: makes a recognizer ahead of the next start (app or voice overlay opened, or a session ended). */
    fun prewarm(c: Context) {
        if (spare != null || recognizer != null || BuildConfig.IS_BROWSER_APP) return
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED || !available(c)) return
        spare = try { SpeechRecognizer.createSpeechRecognizer(c.applicationContext) } catch (e: Exception) {
            Log.w(TAG, "prewarm failed", e); null }
    }

    /** Frees the pre-warmed recognizer (wake word needs the mic, or the app is going away). */
    fun dropSpare() { try { spare?.destroy() } catch (_: Exception) { }; spare = null }

    /** The session can't go on: tell the page (error, then end) and the overlay. */
    private fun fail(sid: String, error: String) {
        if (sid != id) return
        VoiceUiRules.problemRes(error)?.let { res ->
            host?.get()?.let { VoiceService.instance?.problem(it.getString(res)) } }
        emit(sid, JSONObject().put("type", "error").put("error", error))
        finish(sid)
    }

    private fun release() {
        val r = recognizer
        recognizer = null; id = null
        if (r != null) releasedAt = SystemClock.uptimeMillis()
        try { r?.cancel() } catch (_: Exception) { }
        try { r?.destroy() } catch (_: Exception) { }
        // The next turn's recognizer, made once the speech service has let go of this one.
        val c = host?.get()?.applicationContext
        if (r != null && c != null) main.postDelayed({ if (recognizer == null) prewarm(c) }, RESTART_GAP_MS)
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

    /** SpeechRecognizer error codes → the Web Speech API's names, which media.js handles (VoiceUiRules, tested). */
    fun errorName(code: Int): String = VoiceUiRules.recognizerError(code)

    private class Listener(val sid: String) : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            if (sid != id) return
            VoiceCues.startBeep()
            emit(sid, JSONObject().put("type", "ready"))   // 0.22.1: the page marks "mic ready" (voice-timing.js)
        }
        override fun onBeginningOfSpeech() { }
        override fun onBufferReceived(buffer: ByteArray?) { }
        override fun onEndOfSpeech() { }
        override fun onEvent(eventType: Int, params: Bundle?) { }

        override fun onRmsChanged(rmsdB: Float) {
            val now = SystemClock.uptimeMillis()
            if (now - lastLevel < LEVEL_EVERY_MS) return
            lastLevel = now
            val v = VoiceUiRules.rmsLevel(rmsdB) // about -2..10 dB from the recognizer
            if (sid == id) VoiceService.instance?.level(v) // 0.22.1: the overlay's wave follows the real mic
            emit(sid, JSONObject().put("type", "level").put("v", (v * 0.4f).toDouble()))
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val t = best(partialResults) ?: return
            if (sid == id && t.isNotBlank()) VoiceService.instance?.heard(t)
            emit(sid, JSONObject().put("type", "partial").put("text", t))
        }

        override fun onResults(results: Bundle?) {
            val t = best(results)
            if (!t.isNullOrBlank()) {
                if (sid == id) VoiceService.instance?.heard(t)
                emit(sid, JSONObject().put("type", "final").put("text", t))
            }
            finish(sid)
        }

        override fun onError(error: Int) {
            val name = errorName(error)
            Log.w(TAG, "recognizer error $error ($name), lang $lang, voice mode ${VoiceMode.active}")
            if (sid != id) return
            val other = VoiceUiRules.retryLanguage(name, lang)
            val a = host?.get()
            if (other != null && !retried && a != null) {
                retried = true; lang = other
                try { recognizer?.cancel() } catch (_: Exception) { }
                try { recognizer?.destroy() } catch (_: Exception) { }
                recognizer = null
                main.postDelayed({ if (id == sid) begin(a, sid) }, RESTART_GAP_MS)
                return
            }
            fail(sid, name)
        }

        private fun best(b: Bundle?): String? =
            b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
    }
}
