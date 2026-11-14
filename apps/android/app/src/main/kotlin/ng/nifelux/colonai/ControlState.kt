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
    /** Phase 10: Saga handed the page to the user for a secret field (password, code, card, PIN, sign-in, payment):
     *  what to type, shown in the panel and the chat until the user taps Return to AI. Null otherwise. */
    var handoff: Handoff? = null
        private set

    data class Handoff(val kind: String, val message: String)

    /** Saga may run a command only while it has control and is not paused. */
    fun canRunCommands(): Boolean = mode != Mode.MANUAL && !paused

    /** The backend's request, after the user agreed (see BrowserActivity.askConsent). */
    fun grant(newMode: Mode, taskLabel: String?): String? {
        if (newMode == Mode.MANUAL) return stop()
        if (mode == newMode && !paused) return null
        mode = newMode; paused = false; resumable = newMode; task = taskLabel; handoff = null
        return "consent"
    }

    fun takeControl(): String? {
        if (mode == Mode.MANUAL) return null
        resumable = mode; mode = Mode.MANUAL; paused = false
        return "take_control"
    }

    /** Saga reached a secret field: the user takes over to type it, and Return to AI resumes the same task. Only
     *  while a Saga task is running (in control, or resumable after Take control). */
    fun handOff(kind: String, message: String): String? {
        if (mode == Mode.MANUAL && resumable == null) return null
        if (mode != Mode.MANUAL) resumable = mode
        mode = Mode.MANUAL; paused = false
        handoff = Handoff(kind.take(20), message.take(200))
        return "handoff"
    }

    fun returnToAi(): String? {
        val back = resumable ?: return null
        if (mode != Mode.MANUAL) return null
        mode = back; paused = false; handoff = null
        return "return_to_ai"
    }

    /** Phase 10: the user switches this chat between "AI only" (AI) and "AI + me" (SHARED). While Saga has control
     *  the change is reported ("mode"); in Manual it only changes what Return to AI goes back to (nothing to send).
     *  It never gives Saga control. */
    fun switchMode(next: Mode): String? {
        if (next == Mode.MANUAL) return null
        if (mode == Mode.MANUAL) { if (resumable != null) resumable = next; return null }
        if (mode == next) return null
        mode = next; resumable = next
        return "mode"
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

    /**
     * 0.10.4: puts back a Saga task that waits for the user after this object was made afresh (the app restarted,
     * or its screen was rebuilt): the user has the browser and Give back resumes [back]. Nothing is reported (the
     * server kept its side); returns false when there is nothing to put back.
     */
    fun restoreWaiting(back: Mode, waitingFor: Handoff?): Boolean {
        if (back == Mode.MANUAL) return false
        mode = Mode.MANUAL; paused = false; resumable = back; handoff = waitingFor
        return true
    }

    /** 0.10.4: the same for a task Saga was running when this object was made afresh: Saga has the browser again. */
    fun restoreRunning(back: Mode, isPaused: Boolean): Boolean {
        if (back == Mode.MANUAL) return false
        mode = back; paused = isPaused; resumable = back; handoff = null
        return true
    }

    /** Ends the Saga task for good: back to Manual with nothing to return to. */
    fun stop(): String? {
        if (mode == Mode.MANUAL && resumable == null) return null
        mode = Mode.MANUAL; paused = false; resumable = null; task = null; handoff = null
        return "stop"
    }
}
