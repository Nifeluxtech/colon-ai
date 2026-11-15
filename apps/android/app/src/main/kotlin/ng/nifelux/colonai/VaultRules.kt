package ng.nifelux.colonai

import org.json.JSONArray
import org.json.JSONObject

/**
 * Colon Secured Login (0.11.0, ADR 0007), the pure rules (unit-tested in VaultRulesTest): which site a login is for,
 * whether a page belongs to it, how a user name is shown, and the vault's stored shape. The vault itself
 * (LoginVault) keeps the entries encrypted with an Android Keystore key; nothing here ever leaves the phone. The
 * server and Saga only learn "a login is saved for <site>: yes / no" and whether signing in was done.
 */
object VaultRules {
    /** One saved login. [trusted]: the user lets Saga use it; [approved]: they said yes to Saga signing in there once. */
    data class Entry(val site: String, val user: String, val pass: String, val trusted: Boolean = false,
                     val approved: Boolean = false, val savedAt: Long = 0L)

    private val HOST = Regex("^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,24}$")
    const val MAX_ENTRIES = 100
    const val MAX_FIELD = 512

    /** "https://www.GitHub.com/login" -> "github.com"; null when it isn't a web host. */
    fun site(input: String?): String? {
        var h = input?.trim()?.lowercase() ?: return null
        h = h.substringAfter("://", h).substringAfter('@').split('/', '?', '#', ':').first().removePrefix("www.")
        return h.takeIf { HOST.matches(it) }
    }

    /** True when [pageUrl]'s host is [site], one of its subdomains (accounts.github.com for github.com) or, 0.11.6, its
     *  parent on the same registrable domain (yolotask.com.ng for reviewer.yolotask.com.ng), https only (a login never
     *  goes over plain http), never across registrable domains (evil.com.ng is not com.ng's). */
    fun pageMatches(pageUrl: String?, site: String): Boolean {
        val url = pageUrl?.trim() ?: return false
        if (!url.startsWith("https://", ignoreCase = true)) return false
        val host = site(url) ?: return false
        return sameFamily(host, site)
    }

    /** Second-level labels under a two-letter country code that are a public suffix (com.ng, co.uk, gov.ng…). */
    private val SECOND_LEVEL = setOf("com", "co", "org", "net", "gov", "edu", "ac", "sch", "mil", "name", "info",
        "biz", "mobi", "ltd", "plc", "nom", "or", "ne", "go", "gob", "nic", "web")

    /** 0.11.6: the registrable domain, a public-suffix approximation with no list to ship: "reviewer.yolotask.com.ng"
     *  -> "yolotask.com.ng", "accounts.github.com" -> "github.com", "bbc.co.uk" -> "bbc.co.uk"; null for a bare
     *  suffix ("com.ng", "com"). */
    fun registrable(host: String): String? {
        val l = host.lowercase().removePrefix("www.").split('.').filter { it.isNotEmpty() }
        if (l.size < 2) return null
        val n = if (l.last().length == 2 && l[l.size - 2] in SECOND_LEVEL) 3 else 2
        return if (l.size < n) null else l.takeLast(n).joinToString(".")
    }

    /** One site family: [a] is [b], or one is a subdomain of the other, on the same registrable domain. */
    fun sameFamily(a: String, b: String): Boolean {
        val r = registrable(a) ?: return false
        if (r != registrable(b)) return false
        return a == b || a.endsWith(".$b") || b.endsWith(".$a")
    }

    /**
     * 0.11.6: the saved login for [site] (LoginVault.find): the entry for the site itself; else the closest parent
     * domain's (longest wins: a login for yolotask.com.ng serves reviewer.yolotask.com.ng); else, when [site] is the
     * parent, a subdomain's entry (the shortest, then the newest). Never across registrable domains, never a sibling.
     */
    fun match(list: List<Entry>, site: String): Entry? {
        list.firstOrNull { it.site == site }?.let { return it }
        val reg = registrable(site) ?: return null
        val family = list.filter { registrable(it.site) == reg }
        family.filter { site.endsWith(".${it.site}") }.maxByOrNull { it.site.length }?.let { return it }
        return family.filter { it.site.endsWith(".$site") }.minByOrNull { it.site.length }
    }

    /** "ada.lovelace@example.com" -> "ad•••@example.com"; "nife" -> "n•••". Never the password. */
    fun mask(user: String): String {
        val u = user.trim()
        if (u.isEmpty()) return ""
        val at = u.indexOf('@')
        val name = if (at > 0) u.substring(0, at) else u
        val shown = name.take(if (name.length > 4) 2 else 1)
        return shown + "•••" + (if (at > 0) u.substring(at) else "")
    }

    /** A form's values, checked: null when something is missing or too long. */
    fun entryOf(site: String?, user: String?, pass: String?, trusted: Boolean, now: Long): Entry? {
        val s = site(site) ?: return null
        val u = user?.trim().orEmpty()
        val p = pass.orEmpty()
        if (u.isEmpty() || p.isEmpty() || u.length > MAX_FIELD || p.length > MAX_FIELD) return null
        return Entry(s, u, p, trusted, false, now)
    }

    /** Adds or replaces the entry for its site (one login per site), newest first, at most [MAX_ENTRIES]. A changed
     *  login keeps the site's trust only when the user ticked it again, and needs a new approval. */
    fun upsert(list: List<Entry>, e: Entry): List<Entry> =
        (listOf(e) + list.filter { it.site != e.site }).take(MAX_ENTRIES)

    fun toJson(list: List<Entry>): String = JSONArray().apply {
        list.forEach { put(JSONObject().put("s", it.site).put("u", it.user).put("p", it.pass).put("t", it.trusted)
            .put("a", it.approved).put("at", it.savedAt)) }
    }.toString()

    fun fromJson(raw: String?): List<Entry> = try {
        val a = JSONArray(raw ?: "[]")
        (0 until a.length()).mapNotNull { i ->
            val o = a.optJSONObject(i) ?: return@mapNotNull null
            val s = site(o.optString("s")) ?: return@mapNotNull null
            Entry(s, o.optString("u"), o.optString("p"), o.optBoolean("t"), o.optBoolean("a"), o.optLong("at"))
        }.take(MAX_ENTRIES)
    } catch (_: Exception) { emptyList() }

    /** What Saga may do with the login for [site] on [pageUrl]: the answer the phone acts on (never sent with values). */
    enum class Use { NO_LOGIN, NOT_TRUSTED, WRONG_PAGE, ASK, FILL }

    fun use(entry: Entry?, site: String, pageUrl: String?): Use = when {
        entry == null -> Use.NO_LOGIN
        !entry.trusted -> Use.NOT_TRUSTED
        !pageMatches(pageUrl, site) -> Use.WRONG_PAGE
        !entry.approved -> Use.ASK
        else -> Use.FILL
    }

    /** The bridge error for a [Use] that can't fill (what the server sees). */
    fun errorOf(u: Use): String? = when (u) {
        Use.NO_LOGIN -> "no_login"
        Use.NOT_TRUSTED -> "not_trusted"
        Use.WRONG_PAGE -> "wrong_site"
        else -> null
    }
}
