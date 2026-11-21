package ng.nifelux.colonai

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.appcompat.app.AlertDialog
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * 0.20.0 voice mode, the app side (main thread only). The chat page's voice overlay reports hands-free's state with
 * ColonNative.call('voice_ui', {state: idle|listening|thinking|speaking|muted, caption, muted}) (feature "voice_ui");
 * this keeps it, starts or stops VoiceService (microphone foreground service, notification, pill), asks once for
 * "Display over other apps", and passes the pill's End / Mute back to the page as the event 'voice_action'.
 * Opened from the "Talk to Colon" tile or shortcut (compact), Colon steps back behind the pill once voice mode runs.
 */
object VoiceMode {
    private const val PREFS = "colon.voice"
    private const val KEY_ASKED = "overlay_asked"

    var phase = VoiceUiRules.Phase.IDLE
        private set
    var caption = ""
        private set
    var muted = false
        private set
    /** Colon AI is on screen (MainActivity started); the in-app overlay shows then, not the pill. */
    var appVisible = false
        private set
    /** Opened from the tile or the shortcut: step back behind the pill once voice mode is up. */
    private var compactPending = false
    private var host: WeakReference<MainActivity>? = null

    val active: Boolean get() = phase != VoiceUiRules.Phase.IDLE

    fun attach(a: MainActivity) { host = WeakReference(a) }

    /** The chat screen is going away for good: voice mode ends with it. */
    fun detach(a: MainActivity) {
        if (host?.get() !== a) return
        host = null; phase = VoiceUiRules.Phase.IDLE; compactPending = false
        VoiceService.stop()
    }

    fun setAppVisible(visible: Boolean) {
        appVisible = visible
        VoiceService.instance?.refresh()
    }

    fun startCompact() { compactPending = true }

    /** NativeBridge "voice_ui". Answers {pill: Boolean} (whether the pill can show over other apps). */
    fun handle(a: MainActivity, args: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        if (BuildConfig.IS_BROWSER_APP) { done(false, null, "unknown_command"); return }
        val u = VoiceUiRules.parse(args) ?: run { done(false, null, "bad_args"); return }
        host = WeakReference(a)
        val was = phase
        // 0.22.1: the page's timings for one turn (lib/voice-timing.js), next to the recognizer's own lines.
        args.optString("timing").takeIf { it.isNotBlank() }?.let { Log.i("ColonVoice", it.take(300)) }
        if (was == VoiceUiRules.Phase.IDLE && u.phase != VoiceUiRules.Phase.IDLE) NativeListen.prewarm(a)
        phase = u.phase; caption = u.caption; muted = u.muted
        if (u.phase == VoiceUiRules.Phase.IDLE) {
            compactPending = false; VoiceService.stop()
        } else {
            if (was == VoiceUiRules.Phase.IDLE) askOverlayOnce(a)
            sync(a)
        }
        done(true, JSONObject().put("pill", Settings.canDrawOverlays(a)), null)
    }

    /** Starts the service while Colon is on screen (and the mic is allowed), or refreshes the running one. */
    private fun sync(a: MainActivity) {
        val svc = VoiceService.instance
        if (svc != null) { svc.refresh(); stepBackIfCompact(); return }
        val mic = ContextCompat.checkSelfPermission(a, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (a.foreground && mic) VoiceService.start(a)
    }

    /** VoiceService is in the foreground now. */
    fun serviceReady() { stepBackIfCompact() }

    private fun stepBackIfCompact() {
        val a = host?.get() ?: return
        val fg = VoiceService.instance?.foreground == true
        if (!VoiceUiRules.stepBack(compactPending, phase, Settings.canDrawOverlays(a), fg)) return
        compactPending = false
        a.moveTaskToBack(true)
    }

    /** The pill or the notification: End / Mute / Unmute go to the page's hands-free. */
    fun userAction(action: String) {
        val a = host?.get()
        if (action == "end") { phase = VoiceUiRules.Phase.IDLE; compactPending = false }
        // No chat page left to tell: nothing is listening any more, so the pill goes (End finishes it anyway).
        if (a == null || a.isDestroyed || !a.emitToPage("voice_action", JSONObject().put("action", action))) {
            if (action != "end") VoiceService.stop()
        }
    }

    fun askedOverlay(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ASKED, false)

    /** One time only: explain the pill and open "Display over other apps" for Colon AI. */
    private fun askOverlayOnce(a: MainActivity) {
        val s = VoiceUiRules.surface(BuildConfig.IS_BROWSER_APP, Settings.canDrawOverlays(a), askedOverlay(a))
        if (s != VoiceUiRules.Surface.ASK || !a.foreground || a.isFinishing) return
        a.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ASKED, true).apply()
        compactPending = false // stay in Colon while the question is up
        try {
            AlertDialog.Builder(a)
                .setTitle(R.string.voice_overlay_title)
                .setMessage(R.string.voice_overlay_text)
                .setPositiveButton(R.string.voice_overlay_allow) { _, _ ->
                    try {
                        a.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + a.packageName)))
                    } catch (_: Exception) { }
                }
                .setNegativeButton(R.string.voice_overlay_later, null)
                .show()
        } catch (_: Exception) { }
    }
}
