package ng.nifelux.colonai

import java.net.URI
import java.net.URLEncoder

/**
 * Pure URL rules (no Android types, unit-tested in UrlRulesTest):
 * which origins are Colon's own, what the address bar turns into, and which URLs the app may load or install.
 */
object UrlRules {
    /** Pages that get window.ColonNative. Only these origins can call the native bridge. */
    val BRIDGE_ORIGINS: Set<String> = setOf("https://chat.apparatus.name.ng", "https://browser.apparatus.name.ng")

    /** Pages the Colon AI shell keeps in its own WebView; everything else opens in a Colon Browser tab. */
    val SHELL_ORIGINS: Set<String> = BRIDGE_ORIGINS + setOf(
        "https://api.apparatus.name.ng", "https://admin.apparatus.name.ng",
    )

    /** Hosts an update APK may be downloaded from (GitHub Releases and Colon's own domain). */
    private val APK_HOSTS = setOf("github.com", "objects.githubusercontent.com",
        "release-assets.githubusercontent.com", "chat.apparatus.name.ng")

    const val HOME = "colon:home"
    const val SEARCH = "https://www.google.com/search?q="

    /** "https://host[:port]" for http(s) URLs, else null. Lower-cased, default ports dropped. */
    fun originOf(url: String?): String? {
        if (url.isNullOrBlank()) return null
        val u = try { URI(url.trim()) } catch (_: Exception) { return null }
        val scheme = u.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = u.host?.lowercase() ?: return null
        val port = u.port
        val defaultPort = if (scheme == "https") 443 else 80
        return if (port == -1 || port == defaultPort) "$scheme://$host" else "$scheme://$host:$port"
    }

    fun isBridgeOrigin(url: String?): Boolean = originOf(url) in BRIDGE_ORIGINS
    fun isShellUrl(url: String?): Boolean = originOf(url) in SHELL_ORIGINS

    fun isWebUrl(url: String?): Boolean = originOf(url) != null

    /** True for the Colon API host: the only host that may receive the session cookie from native code. */
    fun isColonApi(url: String?): Boolean {
        val o = originOf(url?.replaceFirst(Regex("^wss://", RegexOption.IGNORE_CASE), "https://")) ?: return false
        return o == "https://api.apparatus.name.ng"
    }

    /** Update APKs: https only, on a known host, ending in .apk. */
    fun isAllowedApkUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val u = try { URI(url) } catch (_: Exception) { return false }
        return u.scheme == "https" && u.host?.lowercase() in APK_HOSTS && (u.path ?: "").endsWith(".apk")
    }

    /**
     * What the address bar loads for what the user typed. URLs (with or without https://) open directly;
     * anything else becomes a search. Non-web schemes (javascript:, file:, content:, data:) are never loaded.
     */
    fun addressToUrl(input: String, search: String = SEARCH): String? {
        val text = input.trim()
        if (text.isEmpty()) return null
        if (text.equals(HOME, ignoreCase = true)) return HOME
        val schemeMatch = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):").find(text)
        if (schemeMatch != null) {
            val scheme = schemeMatch.groupValues[1].lowercase()
            if (scheme == "http" || scheme == "https") return if (isWebUrl(text)) text else searchUrl(text, search)
            // "localhost:8080" or "example.com:8443/x" look like schemes; treat them as hosts below.
            if (!Regex("^[a-z0-9.-]+:\\d+").matches(text.substringBefore('/'))) return searchUrl(text, search)
        }
        if (' ' !in text && looksLikeHost(text.substringBefore('/').substringBefore('?').substringBefore('#'))) {
            val candidate = "https://$text"
            if (isWebUrl(candidate)) return candidate
        }
        return searchUrl(text, search)
    }

    private fun looksLikeHost(host: String): Boolean {
        val h = host.substringBefore(':').lowercase()
        if (h == "localhost") return true
        if (Regex("^\\d{1,3}(\\.\\d{1,3}){3}$").matches(h)) return true
        val labels = h.split('.')
        if (labels.size < 2 || labels.any { it.isEmpty() }) return false
        val tld = labels.last()
        return tld.length >= 2 && tld.all { it.isLetter() } && labels.all { l -> l.all { it.isLetterOrDigit() || it == '-' } }
    }

    fun searchUrl(query: String, search: String = SEARCH): String =
        search + URLEncoder.encode(query, "UTF-8").replace("+", "%20")

    /** The text the address bar shows for a loaded URL (empty for the home page). */
    fun displayUrl(url: String?): String = when {
        url.isNullOrBlank() || url == HOME || url.startsWith("about:") || url.startsWith("data:") -> ""
        else -> url
    }

    /** Escapes text for HTML (used by the home page). */
    fun html(s: String): String = buildString(s.length) {
        for (c in s) when (c) {
            '&' -> append("&amp;"); '<' -> append("&lt;"); '>' -> append("&gt;")
            '"' -> append("&quot;"); '\'' -> append("&#39;"); else -> append(c)
        }
    }
}
