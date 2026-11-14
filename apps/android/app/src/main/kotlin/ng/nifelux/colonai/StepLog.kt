package ng.nifelux.colonai

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 0.11.0: Saga's step timeline on the phone. Every command Saga sends the chat's browser becomes a step ("Opened
 * jumia.com.ng", "Clicked "Sign in"", "Typed "rice""), with a small picture of the page taken after it. Tapping the
 * Saga card shows them all (TimelineSheet). Kept per chat for the current task only (a new task starts a new list),
 * at most [MAX] steps, pictures ~12 KB each, never page text. Typed values are shown only when they are plainly not
 * secret: anything typed into a password, code, card or PIN field, anything that looks like personal data, and
 * anything the server asked approval for as personal data or payment is shown as "•••• (N characters)".
 */
object StepLog {
    data class Step(val n: Int, val kind: String, val label: String, val host: String, val ok: Boolean? = null,
                    val at: Long = 0L, val thumb: String? = null) {
        fun toJson(): JSONObject = JSONObject().put("n", n).put("k", kind).put("l", label).put("h", host)
            .put("ok", ok ?: JSONObject.NULL).put("at", at).put("t", thumb ?: JSONObject.NULL)
        companion object {
            fun fromJson(o: JSONObject?): Step? = o?.let {
                Step(it.optInt("n"), it.optString("k"), it.optString("l"), it.optString("h"),
                    if (it.isNull("ok")) null else it.optBoolean("ok"), it.optLong("at"),
                    if (it.isNull("t")) null else it.optString("t"))
            }
        }
    }

    const val MAX = 40
    private const val MAX_LABEL = 120
    private val PERSONAL = Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}|(?:\\+?234|\\b0)[789][01]\\d{8}\\b|\\d{6,}")

    /** What a command is on the timeline: opened · clicked · typed · scrolled · read · signed_in · extracted · tab ·
     *  back · other. */
    fun kindOf(command: String): String = when (command) {
        "open_url" -> "opened"
        "click" -> "clicked"
        "fill" -> "typed"
        "scroll" -> "scrolled"
        "get_page_content", "get_links", "screenshot" -> "read"
        "sign_in" -> "signed_in"
        "extract" -> "extracted"
        "new_tab", "switch_tab", "close_tab", "get_tabs" -> "tab"
        "back", "forward", "reload" -> "back"
        else -> "other"
    }

    /** A typed value as the timeline may show it: the value, or "•••• (N characters)". [secretField]: the phone's
     *  own check found a password / code / card / PIN field; [approvalKind]: what the server asked approval for. */
    fun typed(value: String, secretField: Boolean, approvalKind: String?): String {
        val hide = secretField || approvalKind == "personal_data" || approvalKind == "payment" ||
            PERSONAL.containsMatchIn(value) || looksLikePassword(value)
        return if (hide) "•••• (${value.length} characters)" else "\"${value.take(60)}\""
    }

    /** The step's label: Saga's own words when it said any, else what the command did. Never a secret value. */
    fun label(command: String, say: String?, args: JSONObject, secretField: Boolean = false): String {
        val words = BridgeProtocol.line(say, MAX_LABEL)
        val what = when (command) {
            "open_url", "new_tab" -> UrlRules.displayUrl(args.optString("url"))
            "fill" -> typed(args.optString("value"), secretField, args.optJSONObject("approval")?.optString("kind"))
            "sign_in" -> args.optString("site")
            "scroll" -> args.optString("direction")
            else -> ""
        }
        return listOfNotNull(words, what.takeIf { it.isNotBlank() && words?.contains(it) != true })
            .joinToString(" · ").take(MAX_LABEL * 2).ifEmpty { command.replace('_', ' ') }
    }

    /** One word of 8-64 characters mixing letters with digits and symbols (or cases and digits): a password, likely.
     *  The chat composer warns with the same rule (apps/chat/src/lib/secret-text.js). */
    fun looksLikePassword(v: String): Boolean {
        val t = v.trim()
        if (t.length !in 8..64 || t.any { it.isWhitespace() }) return false
        val lower = t.any { it.isLowerCase() }; val upper = t.any { it.isUpperCase() }
        val digit = t.any { it.isDigit() }; val symbol = t.any { !it.isLetterOrDigit() }
        if (Regex("^https?://|^www\\.|\\.(com|ng|org|net)(/|$)", RegexOption.IGNORE_CASE).containsMatchIn(t)) return false
        return (digit && symbol && (lower || upper)) || (lower && upper && digit)
    }

    fun add(list: List<Step>, s: Step): List<Step> = (list.filter { it.n != s.n } + s).takeLast(MAX)

    fun toJson(list: List<Step>): String = JSONArray(list.map { it.toJson() }).toString()

    fun fromJson(raw: String?): List<Step> = try {
        val a = JSONArray(raw ?: "[]"); (0 until a.length()).mapNotNull { Step.fromJson(a.optJSONObject(it)) }
    } catch (_: Exception) { emptyList() }

    /** The steps of each chat's current task and their pictures (files under saga-steps/<chat>/). */
    class Store(context: Context) {
        private val prefs = context.getSharedPreferences("colon.saga.steps", Context.MODE_PRIVATE)
        private val dir = File(context.filesDir, "saga-steps")
        private fun chatDir(chat: String) = File(dir, ChatSessionRules.profileName(chat))

        fun steps(chat: String): List<Step> = fromJson(prefs.getString(chat, null))
        fun put(chat: String, s: Step) { prefs.edit().putString(chat, toJson(add(steps(chat), s))).apply() }
        fun update(chat: String, n: Int, f: (Step) -> Step) {
            val list = steps(chat)
            list.firstOrNull { it.n == n }?.let { put(chat, f(it)) }
        }
        fun saveThumb(chat: String, n: Int, jpeg: ByteArray): String? = try {
            val f = File(chatDir(chat), "s$n.jpg"); f.parentFile?.mkdirs(); f.writeBytes(jpeg); f.name
        } catch (_: Exception) { null }
        fun thumb(chat: String, name: String): ByteArray? = try { File(chatDir(chat), name).readBytes() }
            catch (_: Exception) { null }
        /** A new task: the old timeline goes. */
        fun clear(chat: String) {
            prefs.edit().remove(chat).apply()
            try { chatDir(chat).deleteRecursively() } catch (_: Exception) { }
        }
    }
}
