package ng.nifelux.colonai

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Moving between the two Colon apps (Phase 8 separation): "Open in Colon Browser" from Colon AI's in-chat browser
 * panel, and "Ask Colon AI" / "Back to Colon AI" from Colon Browser. When the other app isn't installed, the
 * caller offers its download page instead.
 */
object Handoff {
    const val RELEASES = "https://github.com/Nifeluxtech/colon-ai/releases/latest"

    /** Package names to try for the other app, most specific first (a debug build prefers the debug partner). */
    fun candidates(partner: String, debug: Boolean): List<String> =
        if (debug) listOf("$partner.debug", partner) else listOf(partner)

    /** Direct APK of the other app on the latest GitHub Release (same asset names as android.yml uploads). */
    fun apkUrl(partnerKey: String): String =
        "$RELEASES/download/" + (if (partnerKey == "colonbrowser") "colon-browser.apk" else "colon-ai.apk")

    fun partnerKey(): String = if (BuildConfig.IS_BROWSER_APP) "colonai" else "colonbrowser"

    /** The installed partner package, or null. */
    fun installedPartner(context: Context): String? =
        candidates(BuildConfig.PARTNER_PACKAGE, BuildConfig.DEBUG).firstOrNull { pkg ->
            try { context.packageManager.getPackageInfo(pkg, 0); true } catch (_: Exception) { false }
        }

    /** Opens [url] in the other Colon app; false when it isn't installed (or can't take the link). */
    fun openUrl(context: Context, url: String): Boolean {
        val pkg = installedPartner(context) ?: return false
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(pkg)
            .addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try { context.startActivity(intent); true } catch (_: Exception) { false }
    }

    /** Opens the other Colon app's main screen; false when it isn't installed. */
    fun launch(context: Context): Boolean {
        val pkg = installedPartner(context) ?: return false
        val intent = context.packageManager.getLaunchIntentForPackage(pkg) ?: return false
        return try { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }
        catch (_: Exception) { false }
    }

    /** Shares text (a page link and question) into Colon AI's message box; false when Colon AI isn't installed. */
    fun askColonAi(context: Context, text: String, subject: String?): Boolean {
        val pkg = installedPartner(context) ?: return false
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").setPackage(pkg)
            .putExtra(Intent.EXTRA_TEXT, text).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        subject?.takeIf { it.isNotBlank() }?.let { send.putExtra(Intent.EXTRA_SUBJECT, it) }
        return try { context.startActivity(send); true } catch (_: Exception) { false }
    }
}
