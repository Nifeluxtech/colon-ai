package ng.nifelux.colonai

import org.json.JSONObject

/**
 * Colon OS Assistant, Step 2 (docs/os-assistant/step-2.md): the allowlist for phone control. The chat page asks with
 * ColonNative.call('phone', { action, ... }); nothing runs unless [check] accepts the command first, whatever the page
 * (or a model behind it) sends. Calls and texts never go out on their own: the dialler and Messages open with the
 * number filled in and the user taps Call or Send. Pure (no Android types) so it is unit-tested.
 */
object PhoneRules {
    val ACTIONS = setOf("open_app", "settings", "torch", "volume", "media", "dial", "sms", "alarm", "timer",
        "navigate", "camera")
    val SETTINGS_PAGES = setOf("main", "wifi", "bluetooth", "data", "hotspot", "location", "display", "battery",
        "airplane", "sound", "volume", "dnd", "apps", "storage")
    private val VOLUME_OPS = setOf("up", "down", "mute", "unmute", "max", "set")
    private val MEDIA_OPS = setOf("pause", "play", "next", "previous")
    private val APP_NAME = Regex("^[\\p{L}\\p{N} .&'+_-]{1,40}$")
    private val NUMBER = Regex("^\\+?[0-9]{3,15}$")

    /** Short names people say for apps whose label is different. */
    private val ALIASES = mapOf("twitter" to "x", "fb" to "facebook", "ig" to "instagram", "insta" to "instagram",
        "yt" to "youtube", "wa" to "whatsapp", "whatsapp" to "whatsapp", "gmail" to "gmail",
        "play store" to "google play store", "playstore" to "google play store", "maps" to "maps",
        "google maps" to "maps", "calculator" to "calculator", "phone" to "phone", "dialer" to "phone",
        "dialler" to "phone", "messages" to "messages", "sms" to "messages", "contacts" to "contacts",
        "gallery" to "gallery", "photos" to "photos", "clock" to "clock", "calendar" to "calendar",
        "files" to "files", "file manager" to "files")

    /** Null when the command may run, otherwise the error code the page gets ("unknown_action" or "bad_args"). */
    fun check(a: JSONObject): String? {
        val action = a.optString("action")
        if (action !in ACTIONS) return "unknown_action"
        val ok = when (action) {
            "open_app" -> APP_NAME.matches(a.optString("name").trim())
            "settings" -> a.optString("page", "main") in SETTINGS_PAGES
            "torch" -> a.has("on") && a.opt("on") is Boolean
            "volume" -> a.optString("op") in VOLUME_OPS &&
                (a.optString("op") != "set" || a.optInt("level", -1) in 0..100)
            "media" -> a.optString("op") in MEDIA_OPS
            "dial" -> number(a.optString("number")) != null
            "sms" -> number(a.optString("number")) != null && a.optString("body").length <= 500
            "alarm" -> a.optInt("hour", -1) in 0..23 && a.optInt("minute", -1) in 0..59
            "timer" -> a.optInt("seconds", 0) in 1..86400
            "navigate" -> a.optString("place").trim().length in 1..120
            "camera" -> true
            else -> false
        }
        return if (ok) null else "bad_args"
    }

    /** The digits of a phone number ("0803 123-4567" -> "08031234567"), or null when it isn't one. */
    fun number(s: String): String? = s.replace(Regex("[\\s()-]"), "").takeIf { NUMBER.matches(it) }

    /**
     * The package to open for [name] among the launchable apps ([apps]: label to package): an exact label first,
     * then a label starting with the name as a whole word, then a label containing it (the shortest wins).
     */
    fun matchApp(name: String, apps: List<Pair<String, String>>): String? {
        val said = norm(name).let { ALIASES[it] ?: it }
        if (said.isEmpty()) return null
        val labelled = apps.map { norm(it.first) to it.second }.filter { it.first.isNotEmpty() }
        labelled.firstOrNull { it.first == said }?.let { return it.second }
        labelled.filter { it.first.startsWith("$said ") }.minByOrNull { it.first.length }?.let { return it.second }
        if (said.length < 3) return null
        return labelled.filter { it.first.contains(said) }.minByOrNull { it.first.length }?.second
    }

    private fun norm(s: String) = s.lowercase().replace(Regex("[^\\p{L}\\p{N} ]"), " ")
        .replace(Regex("\\s+"), " ").trim()

    /** "07:05" and "7:05 AM" style text for the spoken answer. */
    fun clock(hour: Int, minute: Int): String {
        val h = if (hour % 12 == 0) 12 else hour % 12
        return "$h:${minute.toString().padStart(2, '0')} ${if (hour < 12) "AM" else "PM"}"
    }

    /** "5 minutes", "1 hour 30 minutes", "45 seconds". */
    fun duration(seconds: Int): String {
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return listOfNotNull(
            h.takeIf { it > 0 }?.let { "$it hour" + if (it > 1) "s" else "" },
            m.takeIf { it > 0 }?.let { "$it minute" + if (it > 1) "s" else "" },
            s.takeIf { it > 0 }?.let { "$it second" + if (it > 1) "s" else "" }).joinToString(" ")
    }
}
