package ng.nifelux.colonai

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * 0.20.0 voice mode in the background (Colon AI only; declared in src/colonai/AndroidManifest.xml).
 *
 * While the chat's hands-free voice mode runs, this foreground service of type "microphone" keeps Colon allowed to
 * use the mic when it is not on screen (Android 11+ only lets a backgrounded app record from a microphone-type
 * foreground service started while it was visible; SagaService's "dataSync" type does not cover the mic), shows the
 * ongoing "Colon voice mode" notification (End, Open), and owns the floating pill / expanded overlay
 * (VoiceOverlay) when "Display over other apps" is allowed. State comes from the chat page through VoiceMode.
 */
class VoiceService : Service(), VoiceOverlay.Actions {
    private var overlay: VoiceOverlay? = null
    private var shown: Pair<VoiceUiRules.Phase, Boolean>? = null // what the notification says now
    var foreground = false
        private set

    override fun onBind(intent: Intent?): IBinder? = null

    // The colonai manifest declares foregroundServiceType="microphone"; lint misreads per-flavor service types (see
    // SagaService). Started only while Colon is on screen (VoiceMode.sync), with the mic permission already granted.
    @SuppressLint("ForegroundServiceType")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_END -> { end(); return START_NOT_STICKY }
            ACTION_MUTE -> { mute(!VoiceMode.muted); return START_NOT_STICKY }
        }
        instance = this
        if (!foreground) {
            try {
                ServiceCompat.startForeground(this, ID, notification(), if (Build.VERSION.SDK_INT >= 30)
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
                foreground = true; shown = Pair(VoiceMode.phase, VoiceMode.muted)
            } catch (_: Exception) {
                // No mic permission yet, or Android refused a start from the background: the in-app voice screen
                // still works; the next state change from the page tries again.
                instance = null; stopSelf(); return START_NOT_STICKY
            }
        }
        refresh()
        VoiceMode.serviceReady()
        return START_NOT_STICKY
    }

    /** Re-reads VoiceMode's state: notification text, pill or expanded overlay, or neither while Colon is on screen. */
    fun refresh() {
        val phase = VoiceMode.phase
        if (phase == VoiceUiRules.Phase.IDLE) { finish(); return }
        val now = Pair(phase, VoiceMode.muted)
        if (now != shown && foreground) {
            shown = now
            try { NotificationManagerCompat.from(this).notify(ID, notification()) } catch (_: SecurityException) { }
        }
        val canDraw = Settings.canDrawOverlays(this)
        val surface = VoiceUiRules.surface(BuildConfig.IS_BROWSER_APP, canDraw, VoiceMode.askedOverlay(this))
        if (VoiceUiRules.showPill(phase, VoiceMode.appVisible, surface)) {
            val o = overlay ?: VoiceOverlay(this, this).also { overlay = it }
            o.update(phase, VoiceMode.caption, VoiceMode.muted)
            if (!o.showing && !o.showPill()) overlay = null
        } else {
            overlay?.hideAll()
        }
    }

    private fun finish() {
        overlay?.hideAll(); overlay = null
        if (instance === this) instance = null
        foreground = false
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /* ---------- VoiceOverlay.Actions: the pill and the expanded overlay ---------- */

    override fun end() {
        VoiceMode.userAction("end")
        finish()
    }

    override fun mute(on: Boolean) { VoiceMode.userAction(if (on) "mute" else "unmute") }

    override fun openApp() {
        overlay?.hideAll()
        try { startActivity(appIntent(this)) } catch (_: Exception) { }
    }

    override fun onTaskRemoved(rootIntent: Intent?) { finish(); super.onTaskRemoved(rootIntent) }

    override fun onDestroy() {
        overlay?.hideAll(); overlay = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun notification() = NotificationCompat.Builder(this, Notifications.CHANNEL_VOICE)
        .setSmallIcon(R.drawable.ic_stat_colon)
        .setColor(ContextCompat.getColor(this, R.color.colon_primary))
        .setContentTitle(getString(R.string.voice_title))
        .setContentText(getString(VoiceUiRules.labelRes(VoiceMode.phase)))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(PendingIntent.getActivity(this, 11, appIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .addAction(0, getString(if (VoiceMode.muted) R.string.voice_unmute else R.string.voice_mute),
            PendingIntent.getService(this, 12, Intent(this, VoiceService::class.java).setAction(ACTION_MUTE),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .addAction(0, getString(R.string.voice_end), PendingIntent.getService(this, 13,
            Intent(this, VoiceService::class.java).setAction(ACTION_END),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .build()

    companion object {
        const val ID = 7301
        private const val ACTION_END = "ng.nifelux.colonai.voice.END"
        private const val ACTION_MUTE = "ng.nifelux.colonai.voice.MUTE"

        /** The running service (main thread only), or null. */
        var instance: VoiceService? = null
            private set

        fun appIntent(context: Context): Intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                Intent.FLAG_ACTIVITY_SINGLE_TOP)

        /** Starts the service (only call while Colon is on screen: a background start is refused). */
        fun start(context: Context) {
            try { ContextCompat.startForegroundService(context, Intent(context, VoiceService::class.java)) }
            catch (_: Exception) { }
        }

        fun stop() { instance?.finish() }
    }
}
