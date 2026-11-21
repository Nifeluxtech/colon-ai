package ng.nifelux.colonai

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/**
 * Colon OS Assistant, Step 4 (docs/os-assistant/step-4.md): recognising music around the phone, free tools only
 * (owner decision 2026-11-21). Providers are tried in order:
 *  1. songprint ([SongId]): a Shazam-compatible signature built on the phone; only the signature leaves it.
 *  2. The Shazam app, when it is installed: Colon hands off and Shazam listens itself (free, the user's own app).
 * Neither -> no_match. [recognise] runs on a background thread; [handOff] must run on the main thread.
 */
object SongRecognizer {
    const val SHAZAM_PACKAGE = "com.shazam.android"
    const val SHAZAM_TAG_ACTION = "com.shazam.android.intent.actions.START_TAGGING"

    /** One way to name a song. [identify] answers null when it can't (the next provider is tried). */
    interface Provider {
        val name: String
        fun identify(mono16k: ShortArray): SongId.Found?
    }

    /** songprint against Shazam's public discovery endpoint (no key, unofficial; see step-3.md). */
    object Songprint : Provider {
        override val name = "songprint"
        override fun identify(mono16k: ShortArray): SongId.Found? = SongId.recognise(mono16k)
    }

    private val providers: List<Provider> = listOf(Songprint)

    /** The first provider's answer, or null when none of them could name the song. */
    fun recognise(mono16k: ShortArray): SongId.Found? {
        for (p in providers) {
            val hit = try { p.identify(mono16k) } catch (_: Exception) { null }
            if (hit != null) return hit
        }
        return null
    }

    /** What the page hears after the on-phone providers: "found", "handed_off" or "no_match" (pure, unit-tested). */
    fun outcome(found: Boolean, shazamInstalled: Boolean): String = when {
        found -> "found"
        shazamInstalled -> "handed_off"
        else -> "no_match"
    }

    fun shazamInstalled(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(SHAZAM_PACKAGE, 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }

    /** Opens Shazam listening (its tagging action, else its launcher). False when it couldn't be opened. */
    fun handOff(context: Context): Boolean {
        val tag = Intent(SHAZAM_TAG_ACTION).setPackage(SHAZAM_PACKAGE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val launch = context.packageManager.getLaunchIntentForPackage(SHAZAM_PACKAGE)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        for (i in listOfNotNull(tag, launch)) {
            try {
                context.startActivity(i)
                return true
            } catch (_: ActivityNotFoundException) {
                // try the next way in
            } catch (_: SecurityException) {
                // try the next way in
            }
        }
        return false
    }
}
