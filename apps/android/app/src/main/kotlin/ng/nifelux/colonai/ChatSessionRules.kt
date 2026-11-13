package ng.nifelux.colonai

import java.security.MessageDigest

/**
 * One browser per conversation (ROADMAP Phase 10): pure rules, unit-tested in ChatSessionsTest.
 *
 * Each chat's in-chat browser has its own tabs, history and, where the WebView supports profiles (androidx.webkit
 * MULTI_PROFILE), its own cookies, site storage and logins in a WebView profile named "colon-chat-<key>". The key
 * is the conversation id; a chat that has no conversation yet (a new chat) gets a fresh "draft-<time>" key, which
 * the conversation adopts once it is created, so the first message never loses the browser. At most
 * [DEFAULT_MAX] chats keep a browser (BuildConfig.CHAT_PROFILES_MAX): the least recently used ones are deleted.
 */
object ChatSessionRules {
    const val PREFIX = "colon-chat-"
    const val DRAFT = "draft-"
    const val DEFAULT_MAX = 20
    private val SAFE = Regex("^[A-Za-z0-9_-]{1,64}$")

    /** The session key of a conversation id (null for a new chat that has none yet, or an id we can't use). */
    fun keyOf(conversationId: String?): String? = conversationId?.trim()?.takeIf { SAFE.matches(it) && !isDraft(it) }

    fun draftKey(now: Long): String = DRAFT + now.toString(36)
    fun isDraft(key: String?): Boolean = key != null && key.startsWith(DRAFT)

    /** The WebView profile of a key: "colon-chat-<key>", or a hash when the key isn't plain (never for real ids). */
    fun profileName(key: String): String =
        PREFIX + if (SAFE.matches(key)) key else MessageDigest.getInstance("SHA-256")
            .digest(key.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)

    /** Most recently used first: [key] moves to the front; returns the new order and the keys that fall off. */
    fun touch(order: List<String>, key: String, max: Int): Pair<List<String>, List<String>> {
        val next = listOf(key) + order.filter { it != key }
        val cap = max.coerceAtLeast(1)
        return next.take(cap) to next.drop(cap)
    }

    /** A new chat's draft became conversation [key]: the draft's place (and profile) is the conversation's now. */
    fun adopt(order: List<String>, draft: String, key: String): List<String> =
        order.map { if (it == draft) key else it }.distinct()

    /** Chat profiles on the phone that no kept chat uses (left by a crash, an uninstall of an older build, ...). */
    fun staleProfiles(all: Collection<String>, kept: Collection<String>): List<String> =
        all.filter { it.startsWith(PREFIX) && it !in kept }

    /** Origins whose site storage the shared-profile fallback clears when the chat changes (never Colon's own). */
    fun originsToClear(urls: Collection<String>): List<String> =
        urls.mapNotNull { UrlRules.originOf(it) }.filter { it !in UrlRules.SHELL_ORIGINS }.distinct()

    /** The chat's browser mode: "ai" (AI only) or "shared" (AI + me); anything else is the default. */
    fun mode(value: String?, default: String = "ai"): String = when (value) {
        "ai" -> "ai"
        "shared" -> "shared"
        else -> if (default == "shared") "shared" else "ai"
    }
}
