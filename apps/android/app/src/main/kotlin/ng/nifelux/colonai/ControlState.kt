package ng.nifelux.colonai

/**
 * Who drives the browser (ROADMAP Phases 9-10): Manual (the user), AI (Saga) or Shared (both, Saga asks first).
 * Pure state machine, unit-tested in ControlStateTest. The UI buttons (Take control, Return to AI, Pause, Stop)
 * call these methods; each returns the reason string that is reported to the backend, or null when nothing changed.
 */
class ControlState {
    enum class Mode(val wire: String) {
        MANUAL("manual"), AI("ai"), SHARED("shared");

        companion object {
            fun from(s: String?): Mode? = entries.firstOrNull { it.wire == s }
        }
    }

    var mode: Mode = Mode.MANUAL
        private set
    var paused: Boolean = false
        private set
    /** The AI mode to go back to after "Take control" (null when no Saga task is running). */
    var resumable: Mode? = null
        private set
    var task: String? = null
        private set

    /** Saga may run a command only while it has control and is not paused. */
    fun canRunCommands(): Boolean = mode != Mode.MANUAL && !paused

    /** The backend's request, after the user agreed (see BrowserActivity.askConsent). */
    fun grant(newMode: Mode, taskLabel: String?): String? {
        if (newMode == Mode.MANUAL) return stop()
        if (mode == newMode && !paused) return null
        mode = newMode; paused = false; resumable = newMode; task = taskLabel
        return "consent"
    }

    fun takeControl(): String? {
        if (mode == Mode.MANUAL) return null
        resumable = mode; mode = Mode.MANUAL; paused = false
        return "take_control"
    }

    fun returnToAi(): String? {
        val back = resumable ?: return null
        if (mode != Mode.MANUAL) return null
        mode = back; paused = false
        return "return_to_ai"
    }

    fun pause(): String? {
        if (mode == Mode.MANUAL || paused) return null
        paused = true
        return "pause"
    }

    fun resume(): String? {
        if (!paused) return null
        paused = false
        return "resume"
    }

    /** Ends the Saga task for good: back to Manual with nothing to return to. */
    fun stop(): String? {
        if (mode == Mode.MANUAL && resumable == null) return null
        mode = Mode.MANUAL; paused = false; resumable = null; task = null
        return "stop"
    }
}
