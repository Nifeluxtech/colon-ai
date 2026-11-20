package ng.nifelux.colonai

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.Locale

/**
 * 0.20.2: the phone's own text-to-speech for the chat page. Android System WebView has no working speechSynthesis,
 * so in voice mode a reply was never read out: the page heard "done" at once and went back to listening.
 * Feature "speak": ColonNative.call('speak', {action: speak|stop, id, text, lang, rate}); events 'speak'
 * {id, type: start|done|error}. Long text is queued in pieces the engine accepts; 'done' comes after the last.
 */
object NativeSpeak {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var failed = false
    private var host: WeakReference<MainActivity>? = null
    private var id: String? = null
    private var pieces = 0
    private val waiting = mutableListOf<() -> Unit>()
    private val main = Handler(Looper.getMainLooper())

    fun handle(a: MainActivity, args: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        when (args.optString("action")) {
            "speak" -> {
                val sid = args.optString("id"); val text = args.optString("text").trim()
                if (sid.isBlank() || text.isEmpty()) { done(false, null, "bad_args"); return }
                host = WeakReference(a); stopNow(); id = sid
                withEngine(a.applicationContext) { ok ->
                    if (id != sid) return@withEngine
                    if (!ok) { emit(sid, "error"); id = null; return@withEngine }
                    speak(sid, text, args.optString("lang").ifBlank { "en-US" }, args.optDouble("rate", 1.0))
                }
                done(true, null, null)
            }
            "stop" -> { stopNow(); done(true, null, null) }
            else -> done(false, null, "bad_args")
        }
    }

    private fun withEngine(ctx: Context, then: (Boolean) -> Unit) {
        if (ready) { then(true); return }
        if (failed) { then(false); return }
        waiting.add { then(ready) }
        if (tts != null) return
        tts = TextToSpeech(ctx) { status ->
            main.post {
                ready = status == TextToSpeech.SUCCESS; failed = !ready
                if (ready) tts?.setOnUtteranceProgressListener(Progress) else { tts?.shutdown(); tts = null }
                val run = waiting.toList(); waiting.clear(); run.forEach { it() }
            }
        }
    }

    private fun speak(sid: String, text: String, lang: String, rate: Double) {
        val t = tts ?: run { emit(sid, "error"); return }
        val want = Locale.forLanguageTag(lang)
        val res = try { t.setLanguage(want) } catch (_: Exception) { TextToSpeech.LANG_NOT_SUPPORTED }
        if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
            try { t.setLanguage(Locale.US) } catch (_: Exception) { }
        }
        t.setSpeechRate(rate.toFloat().coerceIn(0.5f, 2f))
        val max = (try { TextToSpeech.getMaxSpeechInputLength() } catch (_: Exception) { 4000 }).coerceAtMost(3000)
        val parts = split(text, max)
        pieces = parts.size
        parts.forEachIndexed { i, p ->
            val r = t.speak(p, if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, Bundle(), "$sid#$i")
            if (r != TextToSpeech.SUCCESS) { emit(sid, "error"); id = null; return }
        }
    }

    /** Sentence-ish pieces of at most [max] characters. */
    fun split(text: String, max: Int): List<String> {
        val out = mutableListOf<String>(); var rest = text.trim()
        while (rest.length > max) {
            var cut = rest.lastIndexOfAny(charArrayOf('.', '!', '?', '\n'), max - 1)
            if (cut < max / 3) cut = rest.lastIndexOf(' ', max - 1)
            if (cut < max / 3) cut = max - 1
            out.add(rest.substring(0, cut + 1).trim()); rest = rest.substring(cut + 1).trim()
        }
        if (rest.isNotEmpty()) out.add(rest)
        return out
    }

    private fun stopNow() {
        id = null
        try { tts?.stop() } catch (_: Exception) { }
    }

    private fun emit(sid: String, type: String) {
        main.post { host?.get()?.emitToPage("speak", JSONObject().put("id", sid).put("type", type)) }
    }

    private object Progress : UtteranceProgressListener() {
        private fun parts(u: String?): Pair<String, Int>? {
            val k = u?.lastIndexOf('#') ?: -1
            if (u == null || k < 0) return null
            return Pair(u.substring(0, k), u.substring(k + 1).toIntOrNull() ?: 0)
        }
        override fun onStart(utteranceId: String?) {
            val (sid, i) = parts(utteranceId) ?: return
            if (i == 0) main.post { if (sid == id) emit(sid, "start") }
        }
        override fun onDone(utteranceId: String?) {
            val (sid, i) = parts(utteranceId) ?: return
            main.post { if (sid == id && i >= pieces - 1) { id = null; emit(sid, "done") } }
        }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            val (sid, _) = parts(utteranceId) ?: return
            main.post { if (sid == id) { id = null; emit(sid, "error") } }
        }
        override fun onError(utteranceId: String?, errorCode: Int) {
            @Suppress("DEPRECATION") onError(utteranceId)
        }
    }
}
