package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * 0.11.0: Saga keeps working when Colon AI goes to the background. While a task runs in a chat's browser this
 * foreground service holds the bridge (BridgeClient.acquire: the socket stays up instead of closing 30 s after the
 * last screen) and shows an ongoing "Saga is working" notification with Stop; the chat's WebView is not paused
 * meanwhile (ChatBrowserPanel.onPause). When the task ends, or needs the user (a sign-in, a code, an approval), a
 * local notification says so (FCM is not set up, so nothing can wake a closed app: if Android or the user closes
 * Colon AI completely, the task stops as before and the card offers Continue).
 */
class SagaService : Service() {
    private var holding = false

    override fun onBind(intent: Intent?): IBinder? = null

    // The manifest declares foregroundServiceType="dataSync" (main AndroidManifest.xml); lint misreads it once the
    // colonai manifest gains another <service> (AssistTileService, 0.18.2).
    @SuppressLint("ForegroundServiceType")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_TASK -> { stopListener?.invoke(); return START_NOT_STICKY }
            ACTION_END -> { release(); stopSelf(); return START_NOT_STICKY }
        }
        val goal = intent?.getStringExtra(EXTRA_GOAL).orEmpty()
        val n = ongoing(this, goal)
        try {
            ServiceCompat.startForeground(this, ID_RUNNING, n, if (Build.VERSION.SDK_INT >= 29)
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0)
        } catch (_: Exception) {
            // Android 12+ refuses a foreground start from the background in some states: the task still runs while
            // the app is open, just without the background guarantee.
            stopSelf(); return START_NOT_STICKY
        }
        if (!holding) { holding = true; ColonApplication.of(this).bridge.acquire() }
        return START_NOT_STICKY
    }

    private fun release() { if (holding) { holding = false; ColonApplication.of(this).bridge.release() } }

    override fun onDestroy() { release(); super.onDestroy() }

    companion object {
        const val ID_RUNNING = 7201
        private const val ID_RESULT = 7202
        private const val ACTION_STOP_TASK = "ng.nifelux.colonai.saga.STOP"
        private const val ACTION_END = "ng.nifelux.colonai.saga.END"
        private const val EXTRA_GOAL = "goal"
        /** The chat's panel: what Stop in the notification does (stops Saga there). */
        var stopListener: (() -> Unit)? = null

        /** A task started (or carried on): keep going in the background. */
        fun start(context: Context, goal: String) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, SagaService::class.java)
                    .putExtra(EXTRA_GOAL, goal.take(160)))
            } catch (_: Exception) { } // not allowed now (background start limits): the app keeps it while open
        }

        /** The task ended or waits for the user: the service goes. */
        fun end(context: Context) {
            try { context.startService(Intent(context, SagaService::class.java).setAction(ACTION_END)) }
            catch (_: Exception) { }
        }

        private fun openApp(context: Context): PendingIntent? {
            val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT) ?: return null
            return PendingIntent.getActivity(context, 3, open, PendingIntent.FLAG_UPDATE_CURRENT or
                PendingIntent.FLAG_IMMUTABLE)
        }

        private fun ongoing(context: Context, goal: String) =
            NotificationCompat.Builder(context, Notifications.CHANNEL_SAGA_RUN)
                .setSmallIcon(R.drawable.ic_stat_colon)
                .setColor(ContextCompat.getColor(context, R.color.colon_primary))
                .setContentTitle(context.getString(R.string.saga_running_title))
                .setContentText(context.getString(R.string.saga_running_text, goal.ifBlank { "…" }))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setContentIntent(openApp(context))
                .addAction(0, context.getString(R.string.saga_running_stop), PendingIntent.getService(context, 4,
                    Intent(context, SagaService::class.java).setAction(ACTION_STOP_TASK),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
                .build()

        /** "Saga finished: <result>" (or stopped) while the app is in the background. */
        fun result(context: Context, done: Boolean, text: String) {
            if (!Notifications.canPost(context)) return
            val n = NotificationCompat.Builder(context, Notifications.CHANNEL_SAGA)
                .setSmallIcon(R.drawable.ic_stat_colon)
                .setColor(ContextCompat.getColor(context, R.color.colon_primary))
                .setContentTitle(context.getString(if (done) R.string.saga_done_title else R.string.saga_failed_title))
                .setContentText(text.take(160))
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .build()
            try { NotificationManagerCompat.from(context).notify(ID_RESULT, n) } catch (_: SecurityException) { }
        }

        /** Saga waits for the user's approval of a risky step while the app is in the background. */
        fun approval(context: Context, reason: String) {
            if (!Notifications.canPost(context)) return
            val n = NotificationCompat.Builder(context, Notifications.CHANNEL_SAGA)
                .setSmallIcon(R.drawable.ic_stat_colon)
                .setColor(ContextCompat.getColor(context, R.color.colon_primary))
                .setContentTitle(context.getString(R.string.saga_approve_title))
                .setContentText(context.getString(R.string.saga_approve_text, reason.take(140)))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .build()
            try { NotificationManagerCompat.from(context).notify(ID_RESULT, n) } catch (_: SecurityException) { }
        }
    }
}
