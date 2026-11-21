package ng.nifelux.colonai

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast

/**
 * 0.24.0: the system DownloadManager's broadcasts for the update download, declared in the manifest (was registered
 * at runtime, so nothing installed when Android had stopped the minimized app). Only the download saved in
 * "colon.update" counts. Complete: the APK is verified (UpdateChecker.complete) and "Colon AI X is ready · Tap to
 * install" is posted. A tap on the download's progress notification brings the app back to its progress sheet.
 */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        val saved = UpdateChecker.saved(app) ?: return
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
        when (intent.action) {
            DownloadManager.ACTION_DOWNLOAD_COMPLETE -> {
                if (!UpdateRules.isOurs(saved.downloadId, id)) return
                val pending = goAsync()
                Thread {
                    try { finish(app) } finally { pending.finish() }
                }.start()
            }
            DownloadManager.ACTION_NOTIFICATION_CLICKED -> {
                // Several ids when several downloads are listed; any of them being ours opens the app.
                val ids = intent.getLongArrayExtra(DownloadManager.EXTRA_NOTIFICATION_CLICK_DOWNLOAD_IDS)
                    ?.toList().orEmpty() + id
                if (ids.none { UpdateRules.isOurs(saved.downloadId, it) }) return
                val open = app.packageManager.getLaunchIntentForPackage(app.packageName) ?: return
                open.putExtra(UpdateChecker.EXTRA_SHOW, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                // Android 10+ may refuse an activity start from the background; the download notification stays.
                try { app.startActivity(open) } catch (_: Exception) { }
            }
        }
    }

    private fun finish(app: Context) {
        val r = UpdateChecker.complete(app)
        val s = UpdateChecker.saved(app)
        val file = s?.let { UpdateChecker.fileOf(app, it) }
        if (r == UpdateChecker.Result.READY && s != null && file != null) {
            UpdateChecker.notificationIntent(app, file)?.let { Notifications.updateReady(app, s.versionName, it) }
            return
        }
        // The open progress sheet says it itself; otherwise a toast (the app may not be on screen).
        if (r != UpdateChecker.Result.NOT_DONE && !UpdateChecker.sheetShowing()) {
            Handler(Looper.getMainLooper()).post {
                Toast.makeText(app, UpdateChecker.messageFor(r), Toast.LENGTH_LONG).show()
            }
        }
    }
}
