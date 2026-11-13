package ng.nifelux.colonai

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Google and some banks refuse sign-in inside a WebView (ROADMAP Phase 8). Those pages open in a Chrome Custom Tab
 * (the phone's own browser, with its saved logins and security checks) and the user comes back with the system
 * back button or the tab's ×. Cookies set in the Custom Tab belong to that browser, not to Colon's WebView, so a
 * site that needs the sign-in inside the tab can still ask again; the tab is reloaded on return to pick up what it can.
 */
object SignInTabs {
    /** Opens [url] in a Custom Tab (never in Colon Browser itself). False when no other browser is installed. */
    fun open(activity: Activity, url: String, dark: Boolean): Boolean {
        val uri = Uri.parse(url)
        val pkg = CustomTabsClient.getPackageName(activity, null, true)?.takeIf { it != activity.packageName }
            ?: otherBrowser(activity, uri)
            ?: return false
        val colors = CustomTabColorSchemeParams.Builder()
            .setToolbarColor(if (dark) 0xFF080F24.toInt() else 0xFFFFFFFF.toInt()).build()
        val tab = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setDefaultColorSchemeParams(colors)
            .setColorScheme(if (dark) CustomTabsIntent.COLOR_SCHEME_DARK else CustomTabsIntent.COLOR_SCHEME_LIGHT)
            .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
            .build()
        tab.intent.setPackage(pkg)
        return try { tab.launchUrl(activity, uri); true } catch (_: Exception) { false }
    }

    /** Any installed browser other than this app (Colon Browser handles web links itself). */
    private fun otherBrowser(activity: Activity, uri: Uri): String? {
        val view = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        @Suppress("DEPRECATION")
        return activity.packageManager.queryIntentActivities(view, PackageManager.MATCH_DEFAULT_ONLY)
            .map { it.activityInfo.packageName }
            .firstOrNull { it != activity.packageName && it != BuildConfig.PARTNER_PACKAGE }
    }
}
