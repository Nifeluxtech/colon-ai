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
        ))
    }

    /** Android 13+ needs the runtime permission; older versions only need notifications switched on. */
    fun permissionNeeded(context: Context): Boolean = Build.VERSION.SDK_INT >= 33 &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED

    fun canPost(context: Context): Boolean =
        !permissionNeeded(context) && NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** "Update downloaded: tap to install". Silently skipped when notifications are off. */
    fun updateReady(context: Context, versionName: String, install: Intent) {
        if (!canPost(context)) return
        val pi = PendingIntent.getActivity(context, 1, install,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_colon)
            .setColor(ContextCompat.getColor(context, R.color.colon_primary))
            .setContentTitle(context.getString(R.string.update_ready_title, versionName))
            .setContentText(context.getString(R.string.update_ready_text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(ID_UPDATE, n)
        } catch (_: SecurityException) {
            // Permission revoked between the check and the post.
        }
    }
}
