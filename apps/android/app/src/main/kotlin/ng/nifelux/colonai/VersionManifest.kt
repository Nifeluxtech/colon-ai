package ng.nifelux.colonai

import org.json.JSONObject

/**
 * The update manifest served at https://chat.apparatus.name.ng/android/version.json
 * (apps/chat/public/android/version.json in the repo). Parsing is pure and unit-tested (VersionManifestTest).
 *
 * One file serves both apps (v0.8.0): the top-level fields describe Colon AI (unchanged since v0.7.1, so older
 * Colon AI builds keep working) and the "browser" object describes Colon Browser. Each app reads only its own
 * entry ([forApp]); an APK must also be named for that app, so Colon AI is never offered Colon Browser's APK.
 */
data class VersionManifest(
    val versionName: String,
    val versionCode: Int,
    val apkUrl: String,
    val releaseUrl: String?,
    val notes: String,
    val minSupportedCode: Int,
) {
    fun isNewerThan(installedCode: Int): Boolean = versionCode > installedCode

    /** True when the installed build is too old to keep using (the prompt can't be dismissed for good). */
    fun isRequired(installedCode: Int): Boolean = installedCode < minSupportedCode

    companion object {
        const val APP_COLON_AI = "colonai"
        const val APP_COLON_BROWSER = "colonbrowser"

        /** Parses the entry for [app] (colonai or colonbrowser); null when missing, malformed or unsafe. */
        fun forApp(json: String, app: String): VersionManifest? {
            val root = try { JSONObject(json) } catch (_: Exception) { return null }
            val entry = when (app) {
                APP_COLON_AI -> root
                APP_COLON_BROWSER -> root.optJSONObject("browser") ?: return null
                else -> return null
            }
            val m = parse(entry.toString()) ?: return null
            val file = m.apkUrl.substringAfterLast('/')
            val prefix = if (app == APP_COLON_BROWSER) "colon-browser" else "colon-ai"
            return if (file == "$prefix.apk" || Regex("^${prefix}-\\d+\\.\\d+\\.\\d+\\.apk$").matches(file)) m
            else null
        }

        /** Parses one manifest entry; null when it is malformed or points somewhere an APK must not come from. */
        fun parse(json: String): VersionManifest? = try {
            val o = JSONObject(json)
            val name = o.optString("versionName")
            val code = o.optInt("versionCode", -1)
            val apk = o.optString("apkUrl")
            if (!Regex("^\\d+\\.\\d+\\.\\d+$").matches(name) || code <= 0 || !UrlRules.isAllowedApkUrl(apk)) null
            else VersionManifest(
                versionName = name,
                versionCode = code,
                apkUrl = apk,
                releaseUrl = o.optString("releaseUrl").takeIf { it.startsWith("https://") },
                notes = o.optString("notes").take(600),
                minSupportedCode = o.optInt("minSupportedVersionCode", 0),
            )
        } catch (_: Exception) {
            null
        }

        /** The versionCode rule the Gradle build uses: major * 10000 + minor * 100 + patch. */
        fun codeFor(versionName: String): Int {
            val p = versionName.split('.').map { it.toInt() }
            return p[0] * 10000 + p[1] * 100 + p[2]
        }
    }
}
