package ng.nifelux.colonai

import java.util.Locale

/**
 * 0.24.0: the update download's decisions (pure, unit tested in UpdateRulesTest). UpdateChecker keeps the download it
 * started in SharedPreferences ("colon.update": [Saved]) and asks these rules what to do with it: when the user taps
 * Download, when the app starts or comes back, and when the system DownloadManager says a download finished.
 */
object UpdateRules {
    /** DownloadManager.STATUS_* (plain ints here so the rules stay JVM-only). */
    const val STATUS_PENDING = 1
    const val STATUS_RUNNING = 2
    const val STATUS_PAUSED = 4
    const val STATUS_SUCCESSFUL = 8
    const val STATUS_FAILED = 16

    /** How often the progress sheet reads DownloadManager (ms). */
    const val POLL_MS = 500L

    /** The download UpdateChecker started, as saved. [verified]: the APK passed verify() (package, newer, same key). */
    data class Saved(
        val downloadId: Long,
        val versionName: String,
        val versionCode: Int,
        val fileName: String,
        val verified: Boolean = false,
    )

    enum class Phase { WAITING, RUNNING, PAUSED, DONE, FAILED, MISSING }

    /** A DownloadManager status as the sheet shows it; null (no row: removed by the user, or cleared) is MISSING. */
    fun phase(status: Int?): Phase = when (status) {
        null -> Phase.MISSING
        STATUS_PENDING -> Phase.WAITING
        STATUS_RUNNING -> Phase.RUNNING
        STATUS_PAUSED -> Phase.PAUSED
        STATUS_SUCCESSFUL -> Phase.DONE
        STATUS_FAILED -> Phase.FAILED
        else -> Phase.WAITING
    }

    fun inProgress(p: Phase): Boolean = p == Phase.WAITING || p == Phase.RUNNING || p == Phase.PAUSED

    enum class OnDownload { START, SHOW_PROGRESS, SHOW_READY }

    /** The user tapped Download for [versionCode]: never a second download of the same version. A finished download
     *  shows Install only once verified and still on disk; otherwise (failed, removed, another version) start anew. */
    fun onDownload(saved: Saved?, versionCode: Int, status: Int?, fileExists: Boolean): OnDownload {
        if (saved == null || saved.versionCode != versionCode) return OnDownload.START
        val p = phase(status)
        return when {
            inProgress(p) -> OnDownload.SHOW_PROGRESS
            p == Phase.DONE && fileExists -> if (saved.verified) OnDownload.SHOW_READY else OnDownload.SHOW_PROGRESS
            else -> OnDownload.START
        }
    }

    enum class OnStart { NOTHING, SHOW_PROGRESS, SHOW_READY, FORGET, CLEAN_UP }

    /**
     * The app started or came back. CLEAN_UP: the saved version (or a newer one) is installed, so its APK and any older
     * ones go. FORGET: the saved download failed or vanished (or its file did), so it is dropped and the next check
     * offers the update again. [hidden]: the user tapped Hide on this download earlier in this run of the app.
     */
    fun onStart(saved: Saved?, installedCode: Int, status: Int?, fileExists: Boolean, hidden: Boolean): OnStart {
        if (saved == null) return OnStart.NOTHING
        if (installedCode >= saved.versionCode) return OnStart.CLEAN_UP
        val p = phase(status)
        return when {
            inProgress(p) -> if (hidden) OnStart.NOTHING else OnStart.SHOW_PROGRESS
            p == Phase.DONE && fileExists -> when {
                hidden -> OnStart.NOTHING
                saved.verified -> OnStart.SHOW_READY
                else -> OnStart.SHOW_PROGRESS // the sheet verifies it, then turns into Install
            }
            else -> OnStart.FORGET
        }
    }

    /** The startup "Update available" prompt is skipped while that version is already downloading or downloaded. */
    fun skipPrompt(saved: Saved?, versionCode: Int, status: Int?): Boolean =
        saved != null && saved.versionCode == versionCode && (inProgress(phase(status)) || phase(status) == Phase.DONE)

    /** A DOWNLOAD_COMPLETE / NOTIFICATION_CLICKED broadcast is ours only when it names the saved download. */
    fun isOurs(savedId: Long, broadcastId: Long): Boolean = savedId > 0 && savedId == broadcastId

    /** Whole percent, or null while the size is unknown (the bar then runs indeterminate). */
    fun percent(done: Long, total: Long): Int? =
        if (total <= 0) null else ((done.coerceIn(0, total) * 100) / total).toInt()

    /** Megabytes with one decimal ("12.4"), the same on every locale so "X MB of Y MB" reads the same everywhere. */
    fun mb(bytes: Long): String = String.format(Locale.ROOT, "%.1f", bytes.coerceAtLeast(0) / (1024.0 * 1024.0))

    fun fileName(apkName: String, versionName: String): String = "$apkName-$versionName.apk"

    /** This app's update APKs in the download folder other than [keep] (null: all of them), to delete. */
    fun staleApks(names: List<String>, apkName: String, keep: String?): List<String> {
        val ours = Regex("^${Regex.escape(apkName)}-\\d+\\.\\d+\\.\\d+\\.apk$")
        return names.filter { ours.matches(it) && it != keep }
    }

    enum class AfterAllow { NOTHING, INSTALL, GIVE_UP }

    /** Back from "Install unknown apps": install when the user allowed it; drop the wait when they didn't. */
    fun afterAllow(pending: Boolean, canInstall: Boolean): AfterAllow = when {
        !pending -> AfterAllow.NOTHING
        canInstall -> AfterAllow.INSTALL
        else -> AfterAllow.GIVE_UP
    }
}
