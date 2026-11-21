package ng.nifelux.colonai

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Notification channels and the POST_NOTIFICATIONS plumbing. Push (FCM) is not wired yet: it needs a Firebase
 * project and a google-services.json, which must not live in this public repo (see apps/android/README.md).
 */
object Notifications {
    const val CHANNEL_UPDATES = "updates"
    const val CHANNEL_SAGA = "saga"
    const val CHANNEL_GENERAL = "general"
    /** 0.11.0: the ongoing "Saga is working" notification of a task running in the background (SagaService). */
    const val CHANNEL_SAGA_RUN = "saga_run"
    /** 0.20.0: the ongoing "Colon voice mode" notification while voice mode runs (VoiceService). */
    const val CHANNEL_VOICE = "voice"
    const val CHANNEL_WAKE = "wake" // 0.23.0: the ongoing "Hey Colon" notification
    const val CHANNEL_WAKE_HEARD = "wake_heard" // 0.23.0: "Tap to talk" when Colon can't open by itself
    private const val ID_UPDATE = 7001

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(listOf(
            NotificationChannel(CHANNEL_UPDATES, context.getString(R.string.channel_updates),
                NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(CHANNEL_SAGA, context.getString(R.string.channel_saga),
                NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(CHANNEL_GENERAL, context.getString(R.string.channel_general),
                NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(CHANNEL_SAGA_RUN, context.getString(R.string.channel_saga_run),
                NotificationManager.IMPORTANCE_LOW),
            NotificationChannel(CHANNEL_VOICE, context.getString(R.string.channel_voice),
                NotificationManager.IMPORTANCE_LOW),
            NotificationChannel(CHANNEL_WAKE, context.getString(R.string.channel_wake),
                NotificationManager.IMPORTANCE_LOW),
            NotificationChannel(CHANNEL_WAKE_HEARD, context.getString(R.string.channel_wake_heard),
                NotificationManager.IMPORTANCE_HIGH),
        ))
    }

    /** Android 13+ needs the runtime permission; older versions only need notifications switched on. */
    fun permissionNeeded(context: Context): Boolean = Build.VERSION.SDK_INT >= 33 &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED

    fun canPost(context: Context): Boolean =
        !permissionNeeded(context) && NotificationManagerCompat.from(context).areNotificationsEnabled()

    private const val ID_SAGA = 7101

    /** 0.10.3: "Saga needs you" while Colon AI is in the background (sign-in, code, captcha, payment, consent); a
     *  tap brings the chat back. Silently skipped when notifications are off. The message is Saga's request only. */
    fun sagaNeedsUser(context: Context, message: String) {
        if (!canPost(context)) return
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT) ?: return
        val pi = PendingIntent.getActivity(context, 2, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL_SAGA)
            .setSmallIcon(R.drawable.ic_stat_colon)
            .setColor(ContextCompat.getColor(context, R.color.colon_primary))
            .setContentTitle(context.getString(R.string.saga_needs_you_title))
            .setContentText(context.getString(R.string.saga_needs_you_text, message.take(160)))
            .setStyle(NotificationCompat.BigTextStyle().bigText(context.getString(R.string.saga_needs_you_text,
                message.take(160))))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(context).notify(ID_SAGA, n) } catch (_: SecurityException) { }
    }

    /** The request was answered (or the task ended): its notification goes. */
    fun cancelSaga(context: Context) {
        try { NotificationManagerCompat.from(context).cancel(ID_SAGA) } catch (_: Exception) { }
    }

    /** "Colon AI X is ready · Tap to install" (0.24.0: stays until the update is installed or dropped; a tap opens the
     *  system installer, or the app when "Install unknown apps" is still off). Silently skipped when notifications
     *  are off: the app shows Install itself the next time it opens. */
    fun updateReady(context: Context, versionName: String, install: Intent) {
        if (!canPost(context)) return
        val pi = PendingIntent.getActivity(context, 1, install,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_colon)
            .setColor(ContextCompat.getColor(context, R.color.colon_primary))
            .setContentTitle(context.getString(R.string.update_ready_title, versionName))
            .setContentText(context.getString(R.string.update_ready_text))
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(pi)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(ID_UPDATE, n)
        } catch (_: SecurityException) {
            // Permission revoked between the check and the post.
        }
    }

    /** 0.24.0: the update was installed, cancelled or failed: its "ready" notification goes. */
    fun cancelUpdate(context: Context) {
        try { NotificationManagerCompat.from(context).cancel(ID_UPDATE) } catch (_: Exception) { }
    }
}
