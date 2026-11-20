package ng.nifelux.colonai

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Ways into Colon's hands-free voice mode that do not depend on the phone's own assistant gesture. Some phones
 * (Infinix XOS, for one) keep the corner swipe and the power-key hold for their own assistant (Folax) or for Google,
 * even when Colon AI is the default digital assistant, and gesture navigation has no Home button to long-press.
 *
 * - [AssistTileService]: a Quick Settings tile, "Talk to Colon" (pull down the shade, tap it).
 * - [AssistShortcut]: a launcher shortcut, "Talk to Colon" (long-press the Colon AI icon, or drag it to the home
 *   screen for a one-tap icon). Published as a dynamic shortcut so it works for debug builds (".debug" suffix) too.
 *
 * Both open [MainActivity] with [MainActivity.EXTRA_ASSIST], exactly like [AssistActivity]. Colon AI flavor only.
 */
object AssistShortcut {
    private const val ID = "talk_to_colon"

    fun assistIntent(context: Context): Intent = Intent(context, MainActivity::class.java)
        .setAction(Intent.ACTION_VIEW)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        .putExtra(MainActivity.EXTRA_ASSIST, true)

    /** Adds (or refreshes) the "Talk to Colon" launcher shortcut. Safe to call on every start. */
    fun publish(context: Context) {
        if (BuildConfig.IS_BROWSER_APP) return
        try {
            val label = context.getString(R.string.assist_label)
            val info = ShortcutInfoCompat.Builder(context, ID)
                .setShortLabel(label)
                .setLongLabel(context.getString(R.string.assist_long_label))
                .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
                .setIntent(assistIntent(context))
                .build()
            ShortcutManagerCompat.pushDynamicShortcut(context, info)
        } catch (_: Exception) {
            // A launcher without shortcut support just has no shortcut.
        }
    }
}

/** Quick Settings tile that starts a hands-free conversation with Colon. */
class AssistTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            state = Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()
        if (isLocked) unlockAndRun { open() } else open()
    }

    private fun open() {
        val intent = AssistShortcut.assistIntent(this)
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                val pending = PendingIntent.getActivity(
                    this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                startActivityAndCollapse(pending)
            } else {
                @Suppress("DEPRECATION")
                startActivityAndCollapse(intent)
            }
        } catch (_: Exception) {
        }
    }
}
