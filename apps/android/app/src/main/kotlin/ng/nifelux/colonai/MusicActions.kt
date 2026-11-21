package ng.nifelux.colonai

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import org.json.JSONObject

/**
 * Colon Music, Step 3 (docs/os-assistant/step-3.md): runs one music command that [MusicRules.check] accepted.
 * play: the phone's songs (asks for the music permission the first time); the chat page falls back to Jamendo
 * (play_url) and then to YouTube or Audiomack (open) when the phone has no match. identify: Colon's own player
 * first (its tags, or a fingerprint of an untagged file), the mic only when the player is idle; the mic goes
 * through [SongRecognizer] (Step 4: songprint, then a hand-off to the Shazam app).
 * [done] answers the page: (ok, result {say, ...}, error code).
 */
object MusicActions {
    private val main = Handler(Looper.getMainLooper())

    private fun say(text: String, extra: JSONObject = JSONObject()) = extra.put("say", text)

    fun run(host: MainActivity, a: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        when (a.optString("action")) {
            "play" -> play(host, a.optString("query").trim(), done)
            "play_url" -> {
                val t = Track(a.optString("title").trim(), a.optString("artist").trim(), a.optString("album"),
                    a.optString("url"), "jamendo")
                ColonMusic.play(host, listOf(t))
                done(true, say("Playing ${MusicRules.describe(t.title, t.artist)} from Jamendo."), null)
            }
            "open" -> {
                val service = a.optString("service")
                val q = a.optString("query").trim()
                val url = MusicRules.serviceUrl(service, q) { Uri.encode(it) }
                try {
                    host.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    done(true, say("Opening $q on ${MusicRules.serviceName(service)}."), null)
                } catch (_: ActivityNotFoundException) {
                    done(false, null, "no_app")
                }
            }
            "stop" -> { ColonMusic.stop(); done(true, say("Music stopped."), null) }
            "now" -> {
                val t = ColonMusic.current()
                if (t == null) done(true, JSONObject().put("idle", true), null)
                else done(true, say(MusicRules.describe(t.title, t.artist)).put("title", t.title)
                    .put("artist", t.artist).put("source", t.source).put("playing", ColonMusic.isPlaying), null)
            }
            "identify" -> identify(host, done)
            else -> done(false, null, "unknown_action")
        }
    }

    private fun play(host: MainActivity, query: String, done: (Boolean, Any?, String?) -> Unit) {
        host.requestPermission(MusicLibrary.permission()) { granted ->
            if (!granted) { done(false, null, "no_library"); return@requestPermission }
            Thread {
                val tracks = MusicLibrary.search(host, query)
                main.post {
                    val first = tracks.firstOrNull()
                    if (first == null) done(false, null, "not_found")
                    else {
                        ColonMusic.play(host, tracks)
                        val what = if (MusicRules.wantsAll(query)) "your music, shuffled"
                            else MusicRules.describe(first.title, first.artist)
                        done(true, say("Playing $what.").put("title", first.title).put("artist", first.artist)
                            .put("source", "phone"), null)
                    }
                }
            }.start()
        }
    }

    private fun identify(host: MainActivity, done: (Boolean, Any?, String?) -> Unit) {
        val cur = ColonMusic.current()
        if (cur != null && ColonMusic.isPlaying) {
            if (cur.tagged || cur.source != "phone") {
                done(true, found(MusicRules.describe(cur.title, cur.artist), cur.title, cur.artist, null, "player"),
                    null)
                return
            }
            Thread {
                val hit = SongId.decodeFile(host, cur.uri)?.let { SongId.recognise(it) }
                main.post {
                    if (hit == null) done(false, null, "no_match")
                    else done(true, found(MusicRules.describe(hit.title, hit.artist), hit.title, hit.artist,
                        hit.link, "player"), null)
                }
            }.start()
            return
        }
        host.requestPermission(Manifest.permission.RECORD_AUDIO) { granted ->
            if (!granted) { done(false, null, "denied"); return@requestPermission }
            Toast.makeText(host, host.getString(R.string.music_listening), Toast.LENGTH_SHORT).show()
            Thread {
                val pcm = SongId.recordMic(host)
                val hit = pcm?.let { SongRecognizer.recognise(it) }
                main.post {
                    if (pcm == null) { done(false, null, "no_mic"); return@post }
                    // Step 4: songprint first, then the Shazam app when it is installed (free only).
                    val next = SongRecognizer.outcome(hit != null, SongRecognizer.shazamInstalled(host))
                    when {
                        hit != null -> done(true, found(MusicRules.describe(hit.title, hit.artist), hit.title,
                            hit.artist, hit.link, "mic"), null)
                        next == "handed_off" && SongRecognizer.handOff(host) ->
                            done(true, say("Opening Shazam to listen.").put("code", "handed_off"), null)
                        else -> done(false, null, "no_match")
                    }
                }
            }.start()
        }
    }

    private fun found(what: String, title: String, artist: String, link: String?, from: String) =
        say("That's $what.").put("title", title).put("artist", artist).put("from", from)
            .put("link", link ?: JSONObject.NULL)
}
