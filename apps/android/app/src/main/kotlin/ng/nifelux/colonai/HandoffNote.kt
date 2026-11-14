package ng.nifelux.colonai

/**
 * 0.10.3: what the phone tells Saga when the user gives the browser back (control `return_to_ai` with `note`): the
 * user's own message from the composer ("I've logged in, continue") and where the page is now. Pure, unit-tested in
 * ChatRunTest. Never a field's value: the phone never reads what the user typed into the page, and the message is
 * scrubbed of anything that looks like a secret (a password, code or PIN after its word, card-like digit runs), the
 * same rules as the server's frames.note and SecretFields' words, so a slip in the chat doesn't reach the model.
 */
object HandoffNote {
    const val MAX = 500
    private val SECRET_WORD = Regex("\\b(password|passcode|passwd|pin|otp|one[- ]time code|code|cvv|cvc|token)\\b" +
        "(\\s*(?:is|was|:|=)?\\s*)\\S+", RegexOption.IGNORE_CASE)
    private val DIGITS = Regex("\\d[\\d -]{3,}\\d")

    /** The user's words, one line, secrets hidden; "" for none. */
    fun scrub(text: String?): String {
        val line = BridgeProtocol.line(text, MAX) ?: return ""
        return DIGITS.replace(SECRET_WORD.replace(line) { m -> m.groupValues[1] + m.groupValues[2] + "[hidden]" }) {
            m -> if (m.value.count { it.isDigit() } >= 6) "[number hidden]" else m.value
        }
    }

    /**
     * The note: [message] (the user's words, may be empty) and the page they left Saga on ([url], [title]), e.g.
     * `I've logged in, continue (page now: dash.example.com/overview "Overview")`. Only the host and path of the
     * URL: a query string can carry tokens.
     */
    fun build(message: String?, url: String?, title: String?): String {
        val said = scrub(message)
        val where = url?.let { pageOf(it) }?.let { p ->
            val t = BridgeProtocol.line(title, 80)?.let { " \"$it\"" } ?: ""
            "(page now: $p$t)"
        } ?: ""
        return listOf(said, where).filter { it.isNotEmpty() }.joinToString(" ").take(MAX)
    }

    /** host/path of an http(s) URL, without the query, fragment or credentials; null for anything else. */
    fun pageOf(url: String): String? {
        val m = Regex("^https?://(?:[^@/?#]*@)?([^/?#:]+)(?::\\d+)?([^?#]*)").find(url.trim()) ?: return null
        val host = m.groupValues[1].lowercase().removePrefix("www.")
        val path = m.groupValues[2].trimEnd('/')
        return (host + path).take(120)
    }
}
