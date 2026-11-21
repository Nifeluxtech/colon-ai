package ng.nifelux.colonai

import android.app.Activity
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CacheControl
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/**
 * In-app updates for the directly installed APK: reads version.json, offers the newer APK, downloads it with
 * DownloadManager, checks it is really this app (same package, newer version, same signing key) and opens the
 * system installer. 0.24.0: the download is saved in "colon.update" and finished by UpdateReceiver (declared in the
 * manifest), so it installs even after Android stopped the minimized app; UpdateSheet shows its progress.
 * Colon AI and Colon Browser each read their own entry of the manifest (BuildConfig.APP_KEY).
 * Play Store builds (Phase 11) will use Play's own updates instead.
 */
object UpdateChecker {
    private const val PREFS = "colon.update"
    private const val CHECK_EVERY_MS = 15 * 60 * 1000L // 0.20.0: 15 minutes (was 12 hours)
    private val main = Handler(Looper.getMainLooper())

    /** Fetches the manifest (at most every 15 minutes unless forced). onResult runs on the main thread. */
    fun check(context: Context, force: Boolean, onResult: (VersionManifest?, String?) -> Unit) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (!force && now - prefs.getLong("checked_at", 0) < CHECK_EVERY_MS) { onResult(null, "recent"); return }
        prefs.edit().putLong("checked_at", now).apply()
        val req = Request.Builder().url(BuildConfig.UPDATE_URL).cacheControl(CacheControl.FORCE_NETWORK)
            .header("User-Agent", "ColonAndroid/${BuildConfig.VERSION_NAME} (${BuildConfig.APP_KEY})").build()
        ColonApplication.of(context).http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { main.post { onResult(null, "offline") } }
            override fun onResponse(call: Call, response: Response) {
                val body = response.use { if (it.isSuccessful) it.body?.string() else null }
                val manifest = body?.let { VersionManifest.forApp(it, BuildConfig.APP_KEY) }
                main.post { onResult(manifest, if (manifest == null) "bad_manifest" else null) }
            }
        })
    }

    /** Startup check: prompts only when a newer version exists and the user hasn't said "Later" to it. */
    fun checkOnStart(activity: Activity) {
        check(activity, force = false) { m, _ ->
            if (m == null || activity.isFinishing || !m.isNewerThan(BuildConfig.VERSION_CODE)) return@check
            val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (!m.isRequired(BuildConfig.VERSION_CODE) && prefs.getInt("skipped_code", 0) == m.versionCode) return@check
            // 0.24.0: already downloading or downloaded: resume() shows its sheet instead of asking again.
            val s = saved(activity)
            val status = s?.let { query(activity, it.downloadId) }?.status
            if (UpdateRules.skipPrompt(s, m.versionCode, status)) return@check
            prompt(activity, m)
        }
    }

    fun prompt(activity: Activity, m: VersionManifest) {
        if (activity.isFinishing) return
        // 0.24.0: that version is already downloading or downloaded: show its sheet, never a second download.
        val s = saved(activity)
        if (UpdateRules.skipPrompt(s, m.versionCode, s?.let { query(activity, it.downloadId) }?.status)) {
            hiddenId = -1L; show(activity); return
        }
        val required = m.isRequired(BuildConfig.VERSION_CODE)
        val msg = activity.getString(R.string.update_message, m.versionName, BuildConfig.VERSION_NAME) +
            if (m.notes.isNotBlank()) "\n\n${m.notes}" else ""
        val b = MaterialAlertDialogBuilder(activity)
            .setTitle(R.string.update_title)
            .setMessage(msg)
            .setCancelable(!required)
            .setPositiveButton(R.string.update_download) { _, _ -> download(activity, m) }
        if (!required) b.setNegativeButton(R.string.update_later) { _, _ ->
            activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt("skipped_code", m.versionCode).apply()
        }
        m.releaseUrl?.let { url ->
            b.setNeutralButton(R.string.update_release_page) { _, _ -> openExternal(activity, url) }
        }
        b.show()
    }

    /**
     * 0.24.0: starts the download (or shows the one already running for this version) with DownloadManager's own
     * progress notification, and saves it in "colon.update" so UpdateReceiver can finish it even when Android has
     * stopped the app. From an activity the progress sheet opens; otherwise a toast says it started.
     */
    fun download(context: Context, m: VersionManifest) {
        val app = context.applicationContext
        val dir = app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        if (dir == null) { openExternal(context, m.apkUrl); return }
        val dm = app.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val old = saved(app)
        val status = old?.let { query(app, it.downloadId) }?.status
        val exists = old != null && File(dir, old.fileName).exists()
        when (UpdateRules.onDownload(old, m.versionCode, status, exists)) {
            UpdateRules.OnDownload.SHOW_PROGRESS, UpdateRules.OnDownload.SHOW_READY -> {
                hiddenId = -1L
                if (context is Activity) show(context) else toast(app, R.string.update_started)
                return
            }
            UpdateRules.OnDownload.START -> Unit
        }
        old?.let { try { dm.remove(it.downloadId) } catch (_: Exception) {} }
        clear(app)
        deleteApks(dir)
        val name = UpdateRules.fileName(BuildConfig.APK_NAME, m.versionName)
        val req = DownloadManager.Request(Uri.parse(m.apkUrl))
            .setTitle(app.getString(R.string.update_downloading, m.versionName))
            .setMimeType(APK_MIME)
            // 0.24.0: progress stays in the notification shade while Colon is minimized, and the "complete" line
            // stays after it (VISIBILITY_VISIBLE hid it as soon as the download ended).
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(app, Environment.DIRECTORY_DOWNLOADS, name)
        val id = try { dm.enqueue(req) } catch (_: Exception) { toast(app, R.string.update_failed); return }
        save(app, UpdateRules.Saved(id, m.versionName, m.versionCode, name))
        hiddenId = -1L
        Notifications.cancelUpdate(app)
        if (context is Activity) show(context) else toast(app, R.string.update_started)
    }

    /* ---------- 0.24.0: the saved download (SharedPreferences "colon.update") ---------- */

    /** One DownloadManager row: its status (UpdateRules.STATUS_*) and bytes so far / in all (-1 while unknown). */
    data class Progress(val status: Int, val done: Long, val total: Long)

    /** What finishing a download came to (UpdateReceiver and the progress sheet). */
    enum class Result { READY, NOT_DONE, FAILED, INVALID, OTHER_KEY }

    /** On the launch intent from an update notification: show the sheet again even if the user hid it. */
    const val EXTRA_SHOW = "ng.nifelux.colonai.extra.SHOW_UPDATE"
    private const val APK_MIME = "application/vnd.android.package-archive"

    /** The download the user hid (Hide, back, swipe) in this run of the app: not reopened by itself. */
    @Volatile private var hiddenId = -1L
    @Volatile private var sheet: UpdateSheet? = null
    private var sweptOldApks = false

    fun saved(context: Context): UpdateRules.Saved? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = p.getLong("dl_id", -1L)
        val file = p.getString("dl_file", null)
        if (id <= 0 || file.isNullOrEmpty()) return null
        return UpdateRules.Saved(id, p.getString("dl_version_name", "").orEmpty(), p.getInt("dl_version_code", 0),
            file, p.getBoolean("dl_verified", false))
    }

    private fun save(context: Context, s: UpdateRules.Saved) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("dl_id", s.downloadId).putString("dl_version_name", s.versionName)
            .putInt("dl_version_code", s.versionCode).putString("dl_file", s.fileName)
            .putBoolean("dl_verified", s.verified).apply()
    }

    private fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("dl_id").remove("dl_version_name")
            .remove("dl_version_code").remove("dl_file").remove("dl_verified").remove("install_pending").apply()
    }

    fun fileOf(context: Context, s: UpdateRules.Saved): File? =
        context.applicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let { File(it, s.fileName) }

    fun query(context: Context, id: Long): Progress? {
        val dm = context.applicationContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        return try {
            dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
                if (!c.moveToFirst()) null
                else Progress(c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                    c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                    c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
            }
        } catch (_: Exception) { null }
    }

    /**
     * Finishes the saved download once: checks it succeeded, then verify(). Remembered as verified, so the receiver,
     * the sheet and the next start never check twice. Anything else drops it (and its file) from "colon.update".
     * Runs off the main thread (reading the APK can take a moment).
     */
    @Synchronized
    fun complete(context: Context): Result {
        val app = context.applicationContext
        val s = saved(app) ?: return Result.FAILED
        val file = fileOf(app, s)
        if (s.verified && file?.exists() == true) return Result.READY
        val phase = UpdateRules.phase(query(app, s.downloadId)?.status)
        if (UpdateRules.inProgress(phase)) return Result.NOT_DONE
        if (phase != UpdateRules.Phase.DONE || file == null || !file.exists()) { forget(app); return Result.FAILED }
        return when (verify(app, file)) {
            null -> { save(app, s.copy(verified = true)); Result.READY }
            "signature" -> { forget(app); Result.OTHER_KEY }
            else -> { forget(app); Result.INVALID } // the file goes with it, as before
        }
    }

    fun messageFor(r: Result): Int = when (r) {
        Result.OTHER_KEY -> R.string.update_other_key
        Result.INVALID -> R.string.update_invalid
        else -> R.string.update_failed
    }

    /** Drops the saved download: its DownloadManager row and file, the record, and the "ready" notification. */
    fun forget(context: Context) {
        val app = context.applicationContext
        val s = saved(app) ?: return
        val dm = app.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        try { dm.remove(s.downloadId) } catch (_: Exception) {}
        fileOf(app, s)?.delete()
        clear(app)
        Notifications.cancelUpdate(app)
    }

    /** Cancel in the progress sheet. */
    fun cancelDownload(context: Context) {
        forget(context)
        toast(context, R.string.update_cancelled)
    }

    fun hide(downloadId: Long) { hiddenId = downloadId }

    fun sheetGone(s: UpdateSheet) { if (sheet === s) sheet = null }

    /** True while the progress sheet is on screen (the receiver then leaves failures to it). */
    fun sheetShowing(): Boolean = sheet?.isShowing == true

    /** Shows the progress sheet (which turns into Install when the APK is in) for the saved download. */
    fun show(activity: Activity) {
        val s = saved(activity) ?: return
        if (activity.isFinishing || activity.isDestroyed) return
        sheet?.let { if (it.activity === activity && it.isShowing) return; it.dismiss() }
        sheet = UpdateSheet(activity, s).also { it.show() }
    }

    /**
     * MainActivity / BrowserActivity onStart: back from "Install unknown apps" it installs; a finished, verified
     * download shows Install; a running one reopens the progress sheet; an installed update is cleaned up.
     */
    fun resume(activity: Activity) {
        val app = activity.applicationContext
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        when (UpdateRules.afterAllow(prefs.getBoolean("install_pending", false), canInstall(app))) {
            UpdateRules.AfterAllow.INSTALL -> {
                prefs.edit().remove("install_pending").apply(); install(activity); return
            }
            UpdateRules.AfterAllow.GIVE_UP -> prefs.edit().remove("install_pending").apply()
            UpdateRules.AfterAllow.NOTHING -> Unit
        }
        val s = saved(app)
        if (s == null) {
            // APKs left behind by builds before 0.24.0 (nothing saved): swept once per run of the app.
            if (!sweptOldApks) {
                sweptOldApks = true
                app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let { deleteApks(it) }
            }
            return
        }
        val status = query(app, s.downloadId)?.status
        val exists = fileOf(app, s)?.exists() == true
        when (UpdateRules.onStart(s, BuildConfig.VERSION_CODE, status, exists, hiddenId == s.downloadId)) {
            UpdateRules.OnStart.CLEAN_UP -> cleanUp(app)
            UpdateRules.OnStart.FORGET -> forget(app)
            UpdateRules.OnStart.SHOW_PROGRESS, UpdateRules.OnStart.SHOW_READY -> show(activity)
            UpdateRules.OnStart.NOTHING -> Unit
        }
    }

    /** A tap on an update notification ([EXTRA_SHOW]): the sheet shows again even if it was hidden. */
    fun onIntent(intent: Intent?): Boolean {
        if (intent?.getBooleanExtra(EXTRA_SHOW, false) != true) return false
        intent.removeExtra(EXTRA_SHOW)
        hiddenId = -1L
        return true
    }

    /** The update is installed: its APK (and any older ones), the record and the notification go. */
    private fun cleanUp(app: Context) {
        saved(app)?.let { s ->
            val dm = app.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            try { dm.remove(s.downloadId) } catch (_: Exception) {}
        }
        app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let { deleteApks(it) }
        clear(app)
        Notifications.cancelUpdate(app)
    }

    /** Every update APK of this app in the download folder. */
    private fun deleteApks(dir: File) {
        UpdateRules.staleApks(dir.list()?.toList().orEmpty(), BuildConfig.APK_NAME, keep = null)
            .forEach { File(dir, it).delete() }
    }

    /** "Install unknown apps" is on for Colon (Android 8+; older versions ask in the installer itself). */
    private fun canInstall(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.packageManager.canRequestPackageInstalls() else true

    /** null when the APK is Colon AI, newer, and signed with the installed app's key; otherwise the reason. */
    @Suppress("DEPRECATION")
    private fun verify(context: Context, file: File): String? {
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES
        else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.absolutePath, flags) ?: return "unreadable"
        if (archive.packageName != context.packageName) return "package"
        val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        if (code <= BuildConfig.VERSION_CODE) return "older"
        val installed = pm.getPackageInfo(context.packageName, flags)
        if (Build.VERSION.SDK_INT >= 28) archive.applicationInfo?.let {
            it.sourceDir = file.absolutePath; it.publicSourceDir = file.absolutePath
        }
        return if (certs(archive).isNotEmpty() && certs(archive) == certs(installed)) null else "signature"
    }

    @Suppress("DEPRECATION")
    private fun certs(info: PackageInfo): Set<String> {
        val raw = if (Build.VERSION.SDK_INT >= 28) {
            info.signingInfo?.let { if (it.hasMultipleSigners()) it.apkContentsSigners else it.signingCertificateHistory }
        } else info.signatures
        val sha = MessageDigest.getInstance("SHA-256")
        return raw.orEmpty().map { s -> sha.digest(s.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
    }

    /** The system installer for the saved APK (FileProvider uri). */
    fun installIntent(context: Context, file: File): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    /** What the "ready" notification opens: the installer, or the app when "Install unknown apps" is still off (the
     *  app asks for it first, then installs). */
    fun notificationIntent(context: Context, file: File): Intent? =
        if (canInstall(context)) installIntent(context, file)
        else context.packageManager.getLaunchIntentForPackage(context.packageName)?.putExtra(EXTRA_SHOW, true)
            ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)

    /**
     * Install (the sheet). Without "Install unknown apps" it opens that setting and remembers to go on: back in the
     * app, [resume] installs the same verified file (never downloaded again).
     */
    fun install(activity: Activity) {
        val app = activity.applicationContext
        val s = saved(app)
        val file = s?.let { fileOf(app, it) }
        if (s == null || file == null || !file.exists()) { toast(app, R.string.update_failed); return }
        if (!s.verified) { show(activity); return }
        if (!canInstall(app)) {
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("install_pending", true).apply()
            toast(app, R.string.update_allow_installs)
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${app.packageName}")))
            } catch (_: Exception) {}
            return
        }
        try {
            activity.startActivity(installIntent(app, file))
        } catch (_: Exception) {
            toast(app, R.string.update_failed)
        }
    }

    fun openExternal(context: Context, url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            toast(context, R.string.no_app_to_open)
        }
    }

    private fun toast(context: Context, res: Int) {
        main.post { Toast.makeText(context.applicationContext, res, Toast.LENGTH_LONG).show() }
    }
}
