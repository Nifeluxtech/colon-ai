package ng.nifelux.colonai

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.provider.AlarmClock
import android.provider.MediaStore
import android.provider.Settings
import android.view.KeyEvent
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Colon OS Assistant, Step 2: runs one phone command that [PhoneRules.check] already accepted. Uses only public
 * intents and system services, no extra permission beyond SET_ALARM (a normal permission): apps open through their
 * launcher intent, settings through Settings screens or panels (Android 10+ lets apps open a switch, not flip it),
 * calls and texts through the dialler and Messages with the user tapping Call or Send.
 */
object PhoneActions {
    /** label (0.22.1): the app's own name for open_app, for the chat's reply ("I'll take you to WhatsApp now."). */
    class Result(val say: String?, val error: String?, val label: String? = null)

    private fun ok(say: String) = Result(say, null)
    private fun fail(code: String) = Result(null, code)

    fun run(act: Activity, a: JSONObject): Result = try {
        when (a.optString("action")) {
            "open_app" -> openApp(act, a.optString("name"))
            "settings" -> settings(act, a.optString("page", "main"), a.optString("toggle"))
            "torch" -> torch(act, a.optBoolean("on"))
            "volume" -> volume(act, a.optString("op"), a.optInt("level", 50))
            "media" -> media(act, a.optString("op"))
            "dial" -> start(act, Intent(Intent.ACTION_DIAL, Uri.fromParts("tel",
                PhoneRules.number(a.optString("number")) ?: "", null)), "Dialling. Tap Call when you're ready.")
            "sms" -> start(act, Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto",
                PhoneRules.number(a.optString("number")) ?: "", null)).putExtra("sms_body", a.optString("body")),
                "Your message is ready. Tap Send.")
            "alarm" -> {
                val h = a.optInt("hour")
                val m = a.optInt("minute")
                start(act, Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, h)
                    .putExtra(AlarmClock.EXTRA_MINUTES, m).putExtra(AlarmClock.EXTRA_SKIP_UI, true),
                    "Alarm set for ${PhoneRules.clock(h, m)}.")
            }
            "timer" -> {
                val s = a.optInt("seconds")
                start(act, Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, s)
                    .putExtra(AlarmClock.EXTRA_SKIP_UI, true), "Timer set for ${PhoneRules.duration(s)}.")
            }
            "navigate" -> {
                val place = a.optString("place").trim()
                start(act, Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(place))),
                    "Opening the map for $place.")
            }
            "camera" -> start(act, Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA), "Opening the camera.")
            else -> fail("unknown_action")
        }
    } catch (_: SecurityException) {
        fail("denied")
    } catch (_: Exception) {
        fail("failed")
    }

    private fun start(act: Activity, intent: Intent, say: String): Result = try {
        act.startActivity(intent); ok(say)
    } catch (_: ActivityNotFoundException) {
        fail("no_app")
    }

    private fun openApp(act: Activity, name: String): Result {
        val pm = act.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val found: List<ResolveInfo> = if (Build.VERSION.SDK_INT >= 33) {
            pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION") pm.queryIntentActivities(launcher, 0)
        }
        val apps = found.map { it.loadLabel(pm).toString() to it.activityInfo.packageName }
            .filter { it.second != act.packageName }
        val pkg = PhoneRules.matchApp(name, apps) ?: return fail("not_found")
        val label = apps.first { it.second == pkg }.first
        val intent = pm.getLaunchIntentForPackage(pkg) ?: return fail("not_found")
        return start(act, intent, "Opening $label.").let { if (it.error == null) Result(it.say, null, label) else it }
    }

    private fun settings(act: Activity, page: String, toggle: String): Result {
        val q = Build.VERSION.SDK_INT >= 29
        val action = when (page) {
            "wifi" -> if (q) Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "data" -> if (q) Settings.Panel.ACTION_INTERNET_CONNECTIVITY else Settings.ACTION_WIRELESS_SETTINGS
            "hotspot" -> Settings.ACTION_WIRELESS_SETTINGS
            "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "battery" -> Settings.ACTION_BATTERY_SAVER_SETTINGS
            "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "volume" -> if (q) Settings.Panel.ACTION_VOLUME else Settings.ACTION_SOUND_SETTINGS
            "dnd" -> "android.settings.ZEN_MODE_PRIORITY_SETTINGS"
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            "storage" -> Settings.ACTION_INTERNAL_STORAGE_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        val say = if (toggle == "on" || toggle == "off") "Here's the switch. Tap it to turn it $toggle."
            else "Opening settings."
        val first = start(act, Intent(action), say)
        return if (first.error == "no_app") start(act, Intent(Settings.ACTION_SETTINGS), say) else first
    }

    private fun torch(act: Activity, on: Boolean): Result {
        val cm = act.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: return fail("no_flash")
        return try {
            cm.setTorchMode(id, on); ok(if (on) "Torch on." else "Torch off.")
        } catch (_: CameraAccessException) {
            fail("busy")
        }
    }

    private fun volume(act: Activity, op: String, level: Int): Result {
        val am = act.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val s = AudioManager.STREAM_MUSIC
        val ui = AudioManager.FLAG_SHOW_UI
        val max = am.getStreamMaxVolume(s).coerceAtLeast(1)
        when (op) {
            "up" -> repeat(2) { am.adjustStreamVolume(s, AudioManager.ADJUST_RAISE, ui) }
            "down" -> repeat(2) { am.adjustStreamVolume(s, AudioManager.ADJUST_LOWER, ui) }
            "mute" -> { am.adjustStreamVolume(s, AudioManager.ADJUST_MUTE, ui); return ok("Muted.") }
            "unmute" -> am.adjustStreamVolume(s, AudioManager.ADJUST_UNMUTE, ui)
            "max" -> am.setStreamVolume(s, max, ui)
            "set" -> am.setStreamVolume(s, (max * level.coerceIn(0, 100) / 100f).roundToInt(), ui)
            else -> return fail("bad_args")
        }
        val now = (am.getStreamVolume(s) * 100f / max).roundToInt()
        return ok("Volume at $now%.")
    }

    private fun media(act: Activity, op: String): Result {
        val am = act.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val code = when (op) {
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            else -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
        }
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
        val say = when (op) {
            "pause" -> "Paused."
            "play" -> "Playing."
            "next" -> "Next track."
            else -> "Previous track."
        }
        return ok(say)
    }
}
