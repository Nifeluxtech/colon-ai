package ng.nifelux.colonai

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Colon OS Assistant, Step 1 (docs/os-assistant/plan.md): Colon AI as the phone's assistant.
 *
 * Android opens this invisible screen when the user picks Colon AI as the default digital assistant app
 * (Settings › Apps › Default apps › Digital assistant app) and then long-presses Home or swipes up from a bottom
 * corner (ACTION_ASSIST), or from a headset / car voice button (ACTION_VOICE_COMMAND). It forwards to the one
 * MainActivity in Colon's own task with [MainActivity.EXTRA_ASSIST]; the chat then starts its hands-free voice
 * conversation (Phase 6: speech in, Saga's reply read aloud, listen again). Nothing is recorded until the chat
 * page starts listening, and the microphone permission is asked there as usual.
 */
class AssistActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val out = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra(MainActivity.EXTRA_ASSIST, true)
        try { startActivity(out) } catch (_: Exception) {}
        finish()
    }
}
