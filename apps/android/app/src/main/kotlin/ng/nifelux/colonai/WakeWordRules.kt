package ng.nifelux.colonai

/**
 * 0.23.0: the wake word service's state machine (pure, unit tested in WakeWordRulesTest). WakeWordService feeds it
 * what it sees (setting, permission, engine, call, Colon's own mic use, another app recording, battery saver) and
 * does what [step] says: open or close the microphone, and which notification line to show.
 */
object WakeWordRules {
    enum class State { OFF, LISTENING, PAUSED }

    /** Why it is paused, in priority order (the first that holds wins). */
    enum class Reason { NONE, NO_PERMISSION, NO_ENGINE, CALL, COLON, HEARD, MIC_BUSY, BATTERY }

    data class Inputs(
        val enabled: Boolean,
        val micPermission: Boolean = true,
        val engineReady: Boolean = true,
        val inCall: Boolean = false,
        /** Colon's own recognizer, voice mode or song ID has the mic. */
        val colonUsingMic: Boolean = false,
        /** Just heard "Hey Colon": quiet until voice mode has taken over. */
        val heardRecently: Boolean = false,
        /** Another app records (Android 10+ would silence one of us). */
        val otherAppRecording: Boolean = false,
        val powerSave: Boolean = false,
        val pauseOnSaver: Boolean = true,
    )

    data class Decision(val state: State, val reason: Reason)

    enum class Mic { OPEN, CLOSE, KEEP }

    fun decide(i: Inputs): Decision = when {
        !i.enabled -> Decision(State.OFF, Reason.NONE)
        !i.micPermission -> Decision(State.PAUSED, Reason.NO_PERMISSION)
        !i.engineReady -> Decision(State.PAUSED, Reason.NO_ENGINE)
        i.inCall -> Decision(State.PAUSED, Reason.CALL)
        i.colonUsingMic -> Decision(State.PAUSED, Reason.COLON)
        i.heardRecently -> Decision(State.PAUSED, Reason.HEARD)
        i.otherAppRecording -> Decision(State.PAUSED, Reason.MIC_BUSY)
        i.powerSave && i.pauseOnSaver -> Decision(State.PAUSED, Reason.BATTERY)
        else -> Decision(State.LISTENING, Reason.NONE)
    }

    /** What the microphone must do going from [was] to [now]. */
    fun mic(was: State, now: State): Mic = when {
        now == State.LISTENING && was != State.LISTENING -> Mic.OPEN
        now != State.LISTENING && was == State.LISTENING -> Mic.CLOSE
        else -> Mic.KEEP
    }

    /** The service keeps running (notification up) unless the user turned the wake word off. */
    fun keepService(d: Decision): Boolean = d.state != State.OFF

    /** How often the service re-checks while listening / paused (ms). Paused checks sooner, to resume quickly. */
    fun checkEveryMs(d: Decision): Long = if (d.state == State.LISTENING) 3000L else 1500L

    /** The notification's line for a decision (string resource names, mapped in WakeWordService). */
    fun label(d: Decision): String = when (d.reason) {
        Reason.NONE -> if (d.state == State.LISTENING) "wake_listening" else "wake_off"
        Reason.NO_PERMISSION -> "wake_paused_permission"
        Reason.NO_ENGINE -> "wake_paused_engine"
        Reason.CALL -> "wake_paused_call"
        Reason.COLON, Reason.HEARD -> "wake_paused_colon"
        Reason.MIC_BUSY -> "wake_paused_mic"
        Reason.BATTERY -> "wake_paused_battery"
    }

    /** AudioManager modes that mean a call (or ringing): MODE_RINGTONE 1, MODE_IN_CALL 2, MODE_IN_COMMUNICATION 3. */
    fun isCallMode(mode: Int): Boolean = mode in 1..3
}
