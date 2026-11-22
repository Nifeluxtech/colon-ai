package ng.nifelux.colonai

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * 0.23.0 (Step 5): the "Hey Colon" setting, kept on this phone only (off by default), and the bridge feature
 * "wake_word" for Settings › Voice: ColonNative.call('wake_word', {action: status}) or {action: set, on?,
 * pauseOnSaver?} answers {available, on, pauseOnSaver, state: off|listening|paused, reason, engine}.
 * Turning it on asks for the microphone (and, on Android 13+, notifications for the ongoing notification).
 */
object WakeWord {
    private const val PREFS = "colon.wake"
    private const val KEY_ON = "on"
    private const val KEY_SAVER = "pause_on_saver"

    /** Colon AI with the engine built in (CI downloads it; a local build without it has no wake word). */
    val available: Boolean get() = !BuildConfig.IS_BROWSER_APP && WakeEngines.BUNDLED

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(c: Context): Boolean = available && prefs(c).getBoolean(KEY_ON, false)

    fun setEnabled(c: Context, on: Boolean) { prefs(c).edit().putBoolean(KEY_ON, on).apply() }

    /** 0.24.1: off by default, so "Hey Colon" keeps listening with battery saver on. */
    fun pauseOnSaver(c: Context): Boolean = prefs(c).getBoolean(KEY_SAVER, false)

    fun setPauseOnSaver(c: Context, on: Boolean) { prefs(c).edit().putBoolean(KEY_SAVER, on).apply() }

    private fun micAllowed(c: Context) = ContextCompat.checkSelfPermission(c, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED

    /** Colon is on screen: (re)start the service when the setting is on (after a reboot or the system stopped it). */
    fun ensure(c: Context) {
        if (!enabled(c) || !micAllowed(c)) return
        CrashGuard.mark(c, "app on screen")
        val s = WakeWordService.instance
        if (s == null) WakeWordService.start(c) else s.check()
    }

    fun handle(a: MainActivity, args: JSONObject, done: (Boolean, Any?, String?) -> Unit) {
        if (!available) { done(false, null, "unavailable"); return }
        when (args.optString("action")) {
            "status" -> done(true, status(a), null)
            "set" -> {
                if (args.has("pauseOnSaver")) setPauseOnSaver(a, args.optBoolean("pauseOnSaver", true))
                if (!args.has("on")) { WakeWordService.instance?.check(); done(true, status(a), null); return }
                if (!args.optBoolean("on")) {
                    setEnabled(a, false); WakeWordService.stop(); done(true, status(a), null); return
                }
                val perms = mutableListOf(Manifest.permission.RECORD_AUDIO)
                if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
                a.permissions.ask(perms.toTypedArray()) { r ->
                    if (r[Manifest.permission.RECORD_AUDIO] != true) { done(false, null, "denied"); return@ask }
                    setEnabled(a, true); ensure(a)
                    done(true, status(a), null)
                }
            }
            else -> done(false, null, "bad_args")
        }
    }

    /** What the service reports to Settings › Voice. */
    data class Status(val decision: WakeWordRules.Decision, val engine: String, val loading: Boolean = false,
        val error: String? = null, val level: Float = 0f, val heard: Int = 0)

    private fun status(c: Context): JSONObject {
        val s = WakeWordService.instance?.status()
            ?: Status(WakeWordRules.Decision(WakeWordRules.State.OFF, WakeWordRules.Reason.NONE), "")
        val d = s.decision
        // 0.24.4: "starting" while the engine loads (it used to read as "couldn't start on this phone").
        val starting = enabled(c) && (d.state == WakeWordRules.State.OFF ||
            (s.loading && d.reason == WakeWordRules.Reason.NO_ENGINE))
        return JSONObject().put("available", available).put("on", enabled(c)).put("pauseOnSaver", pauseOnSaver(c))
            .put("state", if (starting) "starting" else d.state.name.lowercase())
            .put("reason", d.reason.name.lowercase()).put("engine", s.engine).put("error", s.error ?: "")
            .put("level", Math.round(s.level * 100)).put("heard", s.heard)
    }
}
