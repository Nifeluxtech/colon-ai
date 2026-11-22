package ng.nifelux.colonai

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicInteger

/**
 * 0.23.0 (Step 5): listens for "Hey Colon" while the user has it switched on (Settings › Voice, off by default).
 * A foreground service of type "microphone" with a persistent notification (Stop turns the setting off). The mic is
 * open only in [WakeWordRules.State.LISTENING]; a call, Colon's own recognizer / voice mode / song ID, another app
 * recording, or battery saver (when that option is on) closes it, and it opens again when that is over. On "Hey
 * Colon": a chime, then the voice listener opens exactly like the "Talk to Colon" shortcut, so the command or chat
 * goes through the chat page and both lines show in the thread. Android 14+ only lets a microphone service start
 * while Colon is on screen, so it starts from the app (WakeWord.ensure), never at boot.
 */
class WakeWordService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var decision = WakeWordRules.Decision(WakeWordRules.State.PAUSED, WakeWordRules.Reason.NO_ENGINE)
    private var detector: WakeWordDetector? = null
    private var engineLoading = false
    private var engineName = ""
    private var foreground = false
    private var heardAt = 0L
    private var heardCount = 0
    private var micFailedAt = 0L
    private var shownLabel: String? = null
    @Volatile private var recording = false
    @Volatile private var record: AudioRecord? = null
    private var thread: Thread? = null
    private val tick = Runnable { check() }
    /** 0.24.1: the native engine is never used by two threads at once (a crash on slower phones). */
    private val engineLock = Any()

    override fun onBind(intent: Intent?): IBinder? = null

    // The colonai manifest declares foregroundServiceType="microphone" (lint misreads per-flavor types, see SagaService).
    @SuppressLint("ForegroundServiceType")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { WakeWord.setEnabled(this, false); finish(); return START_NOT_STICKY }
        instance = this
        if (!foreground) {
            try {
                ServiceCompat.startForeground(this, ID, notification(WakeWordRules.label(decision)),
                    if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
                foreground = true
            } catch (e: Exception) {
                Log.w(TAG, "foreground start refused", e); instance = null; stopSelf(); return START_NOT_STICKY
            }
        }
        loadEngine()
        check()
        return START_STICKY
    }

    private fun loadEngine() {
        if (detector != null || engineLoading) return
        engineLoading = true
        Thread({
            CrashGuard.mark(applicationContext, "engine loading")
            val e = WakeEngines.create(applicationContext)
            CrashGuard.mark(applicationContext, if (e == null) "engine failed" else "engine ready")
            main.post {
                engineLoading = false
                if (e == null) Log.w(TAG, "no wake word engine") else engineName = e.name
                if (e != null) { if (instance === this) detector = WakeWordDetector(e) else e.release() }
                check()
            }
        }, "colon-wake-load").start()
    }

    private fun inputs(): WakeWordRules.Inputs {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        val now = SystemClock.elapsedRealtime()
        val mine = record?.audioSessionId
        val others = try { am.activeRecordingConfigurations.any { it.clientAudioSessionId != mine } }
            catch (_: Exception) { false }
        return WakeWordRules.Inputs(
            enabled = WakeWord.enabled(this),
            micPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED,
            engineReady = detector?.failed == false,
            inCall = WakeWordRules.isCallMode(am.mode),
            colonUsingMic = VoiceMode.active || NativeListen.inUse || ColonMic.busy,
            heardRecently = heardAt > 0 && now - heardAt < HEARD_QUIET_MS,
            otherAppRecording = others || (micFailedAt > 0 && now - micFailedAt < MIC_RETRY_MS),
            powerSave = pm.isPowerSaveMode,
            pauseOnSaver = WakeWord.pauseOnSaver(this),
        )
    }

    /** Re-reads everything, opens or closes the mic, updates the notification, and checks again later. */
    fun check() {
        main.removeCallbacks(tick)
        if (instance !== this) return
        val next = WakeWordRules.decide(inputs())
        val was = decision.state
        decision = next
        if (!WakeWordRules.keepService(next)) { finish(); return }
        when (WakeWordRules.mic(was, next.state)) {
            WakeWordRules.Mic.OPEN -> openMic()
            WakeWordRules.Mic.CLOSE -> closeMic()
            WakeWordRules.Mic.KEEP -> if (next.state == WakeWordRules.State.LISTENING && !recording) openMic()
        }
        val label = WakeWordRules.label(next)
        if (label != shownLabel && foreground) {
            try { NotificationManagerCompat.from(this).notify(ID, notification(label)) } catch (_: SecurityException) { }
        }
        main.postDelayed(tick, WakeWordRules.checkEveryMs(next))
    }

    @SuppressLint("MissingPermission") // checked in inputs() (micPermission) before the state can be LISTENING
    private fun openMic() {
        val det = detector ?: return
        if (recording) return
        val rate = WakeWordEngine.SAMPLE_RATE
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, maxOf(min, rate))
        } catch (e: Exception) { Log.w(TAG, "AudioRecord failed", e); null }
        if (rec == null || rec.state != AudioRecord.STATE_INITIALIZED) { rec?.release(); micBusy(); return }
        try { rec.startRecording() } catch (_: Exception) { }
        if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) { rec.release(); micBusy(); return }
        CrashGuard.mark(this, "mic open")
        synchronized(engineLock) { det.reset() }
        record = rec; recording = true
        thread = Thread({ listen(rec, det) }, "colon-wake").also { it.start() }
    }

    private fun micBusy() { micFailedAt = SystemClock.elapsedRealtime(); Log.i(TAG, "mic busy, retrying soon") }

    private fun listen(rec: AudioRecord, det: WakeWordDetector) {
        val buf = ShortArray(WakeWordEngine.SAMPLE_RATE / 10) // 100 ms
        var first = true
        while (recording) {
            val n = try { rec.read(buf, 0, buf.size) } catch (_: Exception) { -1 }
            if (!recording) break
            if (n <= 0) { try { Thread.sleep(50) } catch (_: InterruptedException) { break }; continue }
            if (first) { CrashGuard.mark(applicationContext, "first audio to engine"); first = false }
            val hit = synchronized(engineLock) { if (recording) det.feed(buf, n) else null }
            if (hit != null) main.post { heard(hit) }
            if (det.failed) { Log.w(TAG, "engine stopped: ${det.error}"); main.post { check() }; break }
        }
    }

    /** Closes the mic (any thread). Colon's own recognizer calls this before it starts. */
    fun closeMic() {
        if (recording) CrashGuard.mark(applicationContext, "mic close")
        recording = false
        val rec = record; record = null
        try { rec?.stop() } catch (_: Exception) { }
        val t = thread; thread = null
        if (t != null && t !== Thread.currentThread()) try { t.join(JOIN_MS) } catch (_: InterruptedException) { }
        try { rec?.release() } catch (_: Exception) { }
    }

    private fun heard(keyword: String) {
        if (instance !== this) return
        Log.i(TAG, "wake word heard: $keyword")
        CrashGuard.mark(this, "heard $keyword")
        heardAt = SystemClock.elapsedRealtime(); heardCount++
        check() // closes the mic (HEARD) so the recognizer gets it
        VoiceCues.chime()
        main.postDelayed({ openListener() }, CHIME_MS)
    }

    /** Opens the voice listener like the "Talk to Colon" shortcut; from the background only with the overlay
     *  permission (Android blocks other background activity starts), otherwise a tap-to-talk notification. */
    private fun openListener() {
        // 0.24.1: full voice mode in Colon, never the shortcut's step-back behind the pill.
        CrashGuard.mark(this, "open voice mode")
        val intent = AssistShortcut.assistIntent(this).apply { removeExtra(MainActivity.EXTRA_VOICE_COMPACT) }
        if (VoiceMode.appVisible || Settings.canDrawOverlays(this)) {
            try { startActivity(intent); return } catch (e: Exception) { Log.w(TAG, "open failed", e) }
        }
        val pi = PendingIntent.getActivity(this, 22, intent, PendingIntent.FLAG_UPDATE_CURRENT or
            PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, Notifications.CHANNEL_WAKE_HEARD)
            .setSmallIcon(R.drawable.ic_stat_colon)
            .setContentTitle(getString(R.string.wake_heard_title))
            .setContentText(getString(R.string.wake_heard_text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true).setTimeoutAfter(HEARD_QUIET_MS)
            .setContentIntent(pi)
            .build()
        try { NotificationManagerCompat.from(this).notify(ID_HEARD, n) } catch (_: SecurityException) { }
    }

    private fun finish() {
        main.removeCallbacks(tick)
        closeMic()
        val det = detector; detector = null
        CrashGuard.mark(this, "engine release")
        synchronized(engineLock) { det?.release() }
        if (instance === this) instance = null
        if (foreground) { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); foreground = false }
        stopSelf()
    }

    override fun onDestroy() { if (instance === this) finish(); super.onDestroy() }

    private fun notification(label: String) = NotificationCompat.Builder(this, Notifications.CHANNEL_WAKE)
        .also { shownLabel = label }
        .setSmallIcon(R.drawable.ic_stat_colon)
        .setColor(ContextCompat.getColor(this, R.color.colon_primary))
        .setContentTitle(getString(R.string.wake_title))
        .setContentText(getString(labelRes(label)))
        .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(PendingIntent.getActivity(this, 21, VoiceService.appIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .addAction(0, getString(R.string.wake_stop), PendingIntent.getService(this, 23,
            Intent(this, WakeWordService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .build()

    private fun labelRes(label: String): Int = when (label) {
        "wake_listening" -> R.string.wake_listening
        "wake_paused_permission" -> R.string.wake_paused_permission
        "wake_paused_engine" -> R.string.wake_paused_engine
        "wake_paused_call" -> R.string.wake_paused_call
        "wake_paused_colon" -> R.string.wake_paused_colon
        "wake_paused_mic" -> R.string.wake_paused_mic
        "wake_paused_battery" -> R.string.wake_paused_battery
        else -> R.string.wake_starting
    }

    /** For the settings page (0.24.4: also loading, the engine's error, the mic level and how often it heard). */
    fun status() = WakeWord.Status(decision, engineName, engineLoading,
        detector?.error ?: if (engineLoading) null else WakeEngines.lastError, detector?.level ?: 0f, heardCount)

    companion object {
        private const val TAG = "ColonWake"
        const val ID = 7302
        private const val ID_HEARD = 7303
        private const val ACTION_STOP = "ng.nifelux.colonai.wake.STOP"
        private const val CHIME_MS = 250L
        private const val HEARD_QUIET_MS = 8000L
        private const val MIC_RETRY_MS = 5000L
        private const val JOIN_MS = 1000L

        /** The running service (main thread), or null. */
        @Volatile var instance: WakeWordService? = null
            private set

        /** Starts it (only while Colon is on screen: Android 14+ refuses a microphone service from the background). */
        fun start(context: Context) {
            try { ContextCompat.startForegroundService(context, Intent(context, WakeWordService::class.java)) }
            catch (e: Exception) { Log.w(TAG, "start failed", e) }
        }

        fun stop() { instance?.finish() }

        /** Colon is about to use the mic itself: let go of it now; re-checked (and resumed later) on the main thread. */
        fun yieldMic() {
            val s = instance ?: return
            CrashGuard.mark(s.applicationContext, "yield mic to Colon")
            s.closeMic()
            s.main.post { s.check() }
        }
    }
}

/** Colon's own short mic uses outside the recognizer (song ID): the wake word pauses while any runs. */
object ColonMic {
    private val users = AtomicInteger()
    val busy: Boolean get() = users.get() > 0

    fun <T> using(block: () -> T): T {
        users.incrementAndGet()
        WakeWordService.yieldMic()
        try { return block() } finally { users.decrementAndGet() }
    }
}
