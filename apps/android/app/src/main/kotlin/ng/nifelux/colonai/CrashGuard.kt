package ng.nifelux.colonai

import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.app.ApplicationExitInfo
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.util.Log
import android.widget.Toast
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * 0.24.1: when Colon AI closed with "keeps stopping", the next start knows why. A Java/Kotlin crash writes its stack
 * trace to a file on the way down; a native crash (the "Hey Colon" engine is native code) or an ANR is read back
 * from Android's ApplicationExitInfo (Android 11+). On the next start, before anything else runs, "Hey Colon" is
 * switched off when it was on, so a crash there can never stop the app from opening again; the chat screen then
 * shows what happened once, with a Copy button for the report.
 */
object CrashGuard {
    private const val TAG = "ColonCrash"
    private const val FILE = "last-crash.txt"
    private const val PREFS = "colon.crash"
    private const val KEY_SEEN = "seen_exit_ms"
    private const val MAX_TRACE = 6000

    /** The report to show on the chat screen (once), set by [onAppStart]. */
    @Volatile private var pending: String? = null
    @Volatile private var wakeTurnedOff = false

    /** Application.onCreate: catch Java crashes, then look at how the last run ended. */
    fun onAppStart(app: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try { File(app.filesDir, FILE).writeText(javaReport(thread, error)) } catch (_: Throwable) { }
            previous?.uncaughtException(thread, error)
        }
        val report = try { lastCrash(app) } catch (e: Throwable) { Log.w(TAG, "read failed", e); null } ?: return
        Log.w(TAG, "last run crashed:\n" + report.take(800))
        if (WakeWord.enabled(app)) { WakeWord.setEnabled(app, false); wakeTurnedOff = true }
        pending = report
    }

    private fun javaReport(thread: Thread, error: Throwable): String {
        val sw = StringWriter()
        error.printStackTrace(PrintWriter(sw))
        return "Java crash in thread ${thread.name}\n" + sw.toString().take(MAX_TRACE)
    }

    private fun lastCrash(c: Context): String? {
        val f = File(c.filesDir, FILE)
        val java = if (f.exists()) f.readText().also { f.delete() } else null
        val exit = lastExit(c)
        if (java == null && exit == null) return null
        val head = "Colon AI ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}), " +
            "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}, " +
            Build.SUPPORTED_ABIS.joinToString()
        return listOfNotNull(head, exit, java).joinToString("\n\n")
    }

    /** The newest crash or ANR Android recorded since the last one we reported (Android 11+). */
    private fun lastExit(c: Context): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        val am = c.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val prefs = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val seen = prefs.getLong(KEY_SEEN, 0L)
        val crashes = setOf(ApplicationExitInfo.REASON_CRASH, ApplicationExitInfo.REASON_CRASH_NATIVE,
            ApplicationExitInfo.REASON_ANR)
        val info = am.getHistoricalProcessExitReasons(null, 0, 5).firstOrNull {
            it.timestamp > seen && it.reason in crashes
        } ?: return null
        prefs.edit().putLong(KEY_SEEN, info.timestamp).apply()
        val kind = when (info.reason) {
            ApplicationExitInfo.REASON_CRASH_NATIVE -> "Native crash"
            ApplicationExitInfo.REASON_ANR -> "Not responding (ANR)"
            else -> "Crash"
        }
        val trace = if (info.reason == ApplicationExitInfo.REASON_ANR) {
            try { info.traceInputStream?.use { it.readBytes().decodeToString().take(MAX_TRACE) } }
            catch (_: Throwable) { null }
        } else null
        return listOfNotNull("$kind at ${info.timestamp} (${info.processName}): ${info.description ?: "no detail"}",
            trace).joinToString("\n")
    }

    /** The chat screen opened: show the last crash once, with Copy. */
    fun showIfAny(a: Activity) {
        val report = pending ?: return
        pending = null
        val intro = a.getString(if (wakeTurnedOff) R.string.crash_intro_wake else R.string.crash_intro)
        try {
            AlertDialog.Builder(a)
                .setTitle(R.string.crash_title)
                .setMessage(intro + "\n\n" + report.take(1500))
                .setPositiveButton(R.string.crash_copy) { _, _ ->
                    val cm = a.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("Colon AI crash report", report))
                    Toast.makeText(a, R.string.crash_copied, Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton(R.string.crash_close, null)
                .show()
        } catch (e: Exception) { Log.w(TAG, "dialog failed", e) }
    }
}
