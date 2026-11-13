package ng.nifelux.colonai

import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.ContextCompat
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
 * system installer. Colon AI and Colon Browser each read their own entry of the manifest (BuildConfig.APP_KEY).
 * Play Store builds (Phase 11) will use Play's own updates instead.
 */
object UpdateChecker {
    private const val PREFS = "colon.update"
    private const val CHECK_EVERY_MS = 12 * 60 * 60 * 1000L
    private val main = Handler(Looper.getMainLooper())

    /** Fetches the manifest (at most every 12 h unless forced). onResult runs on the main thread. */
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
            prompt(activity, m)
        }
    }

    fun prompt(activity: Activity, m: VersionManifest) {
        if (activity.isFinishing) return
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

    fun download(context: Context, m: VersionManifest) {
        val app = context.applicationContext
        val dir = app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        if (dir == null) { openExternal(context, m.apkUrl); return }
        val name = "${BuildConfig.APK_NAME}-${m.versionName}.apk"
        File(dir, name).delete()
        val req = DownloadManager.Request(Uri.parse(m.apkUrl))
            .setTitle(app.getString(R.string.update_downloading, m.versionName))
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(app, Environment.DIRECTORY_DOWNLOADS, name)
        val dm = app.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val id = dm.enqueue(req)
        Toast.makeText(context, R.string.update_started, Toast.LENGTH_SHORT).show()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return
                try { app.unregisterReceiver(this) } catch (_: Exception) {}
                finished(app, dm, id, File(dir, name), m)
            }
        }
        ContextCompat.registerReceiver(app, receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED)
    }

    private fun finished(app: Context, dm: DownloadManager, id: Long, file: File, m: VersionManifest) {
        val ok = dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
            c.moveToFirst() && c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) ==
                DownloadManager.STATUS_SUCCESSFUL
        } ?: false
        if (!ok || !file.exists()) { toast(app, R.string.update_failed); return }
        when (verify(app, file)) {
            null -> install(app, file, m)
            "signature" -> toast(app, R.string.update_other_key)
            else -> { file.delete(); toast(app, R.string.update_invalid) }
        }
    }

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

    private fun install(app: Context, file: File, m: VersionManifest) {
        val uri = FileProvider.getUriForFile(app, "${app.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !app.packageManager.canRequestPackageInstalls()) {
            toast(app, R.string.update_allow_installs)
            try {
                app.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) {}
            Notifications.updateReady(app, m.versionName, intent)
            return
        }
        Notifications.updateReady(app, m.versionName, intent)
        try { app.startActivity(intent) } catch (_: Exception) { toast(app, R.string.update_failed) }
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
