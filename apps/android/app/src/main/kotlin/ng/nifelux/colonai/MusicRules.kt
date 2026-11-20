package ng.nifelux.colonai

import org.json.JSONObject

/**
 * Colon OS Assistant, Step 3 (docs/os-assistant/step-3.md): the allowlist for Colon Music and the pure matching
 * rules, so they are unit-tested. The chat page asks with ColonNative.call('music', { action, ... }); [check] runs
 * first, whatever the page sends. Streams play only from Jamendo (free Creative Commons music); anything else opens
 * in YouTube or Audiomack through a normal link.
 */
object MusicRules {
    val ACTIONS = setOf("play", "play_url", "open", "stop", "now", "identify")
    private val SOURCES = setOf("any", "phone")
    private val SERVICES = setOf("youtube", "audiomack")
    private val STOP_WORDS = setOf("by", "the", "song", "songs", "track", "music", "a", "an", "of", "from", "my")

    /** Null when the command may run, otherwise the error code the page gets ("unknown_action" or "bad_args"). */
    fun check(a: JSONObject): String? {
        val action = a.optString("action")
        if (action !in ACTIONS) return "unknown_action"
        val ok = when (action) {
            "play" -> query(a) && a.optString("source", "any") in SOURCES
            "open" -> query(a) && a.optString("service") in SERVICES
            "play_url" -> jamendoUrl(a.optString("url")) && a.optString("title").trim().length in 1..200 &&
                a.optString("artist").length <= 200
            else -> true
        }
        return if (ok) null else "bad_args"
    }

    private fun query(a: JSONObject) = a.optString("query").trim().length in 1..120

    /** Only https streams on jamendo.com (or a subdomain) may play. */
    fun jamendoUrl(url: String): Boolean {
        val m = Regex("^https://([a-z0-9.-]+)(?::443)?(?:/|\\?|$)", RegexOption.IGNORE_CASE).find(url) ?: return false
        val host = m.groupValues[1].lowercase()
        return host == "jamendo.com" || host.endsWith(".jamendo.com")
    }

    /** "*" (or nothing left after the filler words) means the whole library, shuffled. */
    fun wantsAll(query: String) = query.trim() == "*" || words(query).isEmpty()

    /** Lower-case words without accents or punctuation, minus filler ("by", "the", "song"...). */
    fun words(s: String): List<String> = norm(s).split(' ').filter { it.isNotEmpty() && it !in STOP_WORDS }

    fun norm(s: String): String = java.text.Normalizer.normalize(s.lowercase(), java.text.Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "").replace(Regex("[^\\p{L}\\p{N} ]"), " ").replace(Regex("\\s+"), " ").trim()

    /**
     * How well a track fits what the user said: 0 unless every word they said is in the title, artist or album;
     * then more for the title or artist matching the whole phrase.
     */
    fun score(query: String, title: String, artist: String, album: String): Int {
        val said = words(query)
        if (said.isEmpty()) return 0
        val t = norm(title)
        val ar = norm(artist)
        val hay = " $t $ar ${norm(album)} "
        if (!said.all { hay.contains(" $it ") }) return 0
        val phrase = said.joinToString(" ")
        var s = 10
        if (t == phrase) s += 60 else if (" $t ".contains(" $phrase ")) s += 25
        if (ar == phrase) s += 30
        if (said.any { " $t ".contains(" $it ") }) s += 5
        return s
    }

    /** Untagged files: no artist, or a title that is just the file name. */
    fun tagged(title: String, artist: String, fileName: String): Boolean {
        val a = artist.trim()
        if (a.isEmpty() || a == "<unknown>") return false
        val base = fileName.substringBeforeLast('.').trim()
        return title.isNotBlank() && !title.trim().equals(base, ignoreCase = true)
    }

    /** The search page a song that isn't on the phone or Jamendo opens in. */
    fun serviceUrl(service: String, query: String, encode: (String) -> String): String = when (service) {
        "audiomack" -> "https://audiomack.com/search?q=" + encode(query)
        else -> "https://www.youtube.com/results?search_query=" + encode(query)
    }

    fun serviceName(service: String) = if (service == "audiomack") "Audiomack" else "YouTube"

    /** What Colon says about a song: "Last Last by Burna Boy". */
    fun describe(title: String, artist: String) =
        if (artist.isBlank() || artist == "<unknown>") title else "$title by $artist"
}
