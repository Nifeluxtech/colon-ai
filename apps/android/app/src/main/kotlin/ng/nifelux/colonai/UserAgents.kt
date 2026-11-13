package ng.nifelux.colonai

/**
 * "Desktop site": the tab asks for the full desktop page by sending a desktop user agent (no "Mobile", no
 * "Android" platform), keeping Chrome's version and the app's own ColonAndroid token. Pure, unit-tested.
 */
object UserAgents {
    private val PLATFORM = Regex("\\(Linux; Android [^)]*\\)")

    fun desktop(mobileUa: String): String {
        var ua = PLATFORM.replace(mobileUa, "(X11; Linux x86_64)")
        ua = ua.replace(Regex("\\s*; wv"), "")              // the WebView marker inside the platform part
            .replace(Regex("\\sVersion/\\d+(\\.\\d+)*"), "")   // WebView-only token
            .replace(" Mobile Safari/", " Safari/")
            .replace(Regex("\\sMobile(?=\\s|$)"), "")
        return ua.replace(Regex("\\s{2,}"), " ").trim()
    }

    fun isDesktop(ua: String): Boolean = !ua.contains("Android") && !ua.contains("Mobile")
}
