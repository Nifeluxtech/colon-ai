package ng.nifelux.colonai

import org.json.JSONObject

/**
 * 0.20.0 voice mode: the pure decisions behind Colon's floating voice pill and its Siri-style expanded overlay
 * (VoiceOverlay.kt), unit-tested in VoiceUiRulesTest. The chat page reports its hands-free state through
 * ColonNative.call('voice_ui', {state, caption, muted}); these rules check it, pick the label and colour, decide
 * between the pill, a one-time permission prompt and the plain notification, and read pill gestures.
 */
object VoiceUiRules {
    enum class Phase { IDLE, LISTENING, THINKING, SPEAKING, MUTED }

    /** What shows while Colon is in the background: the pill, the permission prompt first, or just the notification. */
    enum class Surface { PILL, ASK, NOTIFICATION }

    enum class Gesture { NONE, TAP, LONG_PRESS, SWIPE_END }

    const val CAPTION_MAX = 140
    const val CORNER_FALLBACK_DP = 24
    const val LONG_PRESS_MS = 900L // 0.20.1: 550 ms ended voice mode on a slow tap
    /** How far (in dp) a finger must travel for a swipe to end voice mode; less is a tap. */
    const val SWIPE_DP = 72
    const val TAP_SLOP_DP = 24 // 0.20.1: a finger's wobble still counts as a tap

    /** A voice_ui message from the page, checked: null when it is not one Colon sends. */
    data class Update(val phase: Phase, val caption: String, val muted: Boolean)

    fun phaseOf(s: String?): Phase? = when (s) {
        "idle" -> Phase.IDLE
        "listening" -> Phase.LISTENING
        "thinking" -> Phase.THINKING
        "speaking" -> Phase.SPEAKING
        "muted" -> Phase.MUTED
        else -> null
    }

    fun parse(a: JSONObject): Update? {
        val p = phaseOf(a.optString("state")) ?: return null
        val raw = a.opt("caption")
        if (raw != null && raw != JSONObject.NULL && raw !is String) return null
        val muted = a.opt("muted")
        if (muted != null && muted !is Boolean) return null
        return Update(p, caption(raw as? String), muted == true)
    }

    /** One line of plain text, at most [CAPTION_MAX] characters (control characters dropped). */
    fun caption(raw: String?): String {
        val s = (raw ?: "").replace(Regex("[\\p{Cntrl}\\s]+"), " ").trim()
        return if (s.length <= CAPTION_MAX) s else s.take(CAPTION_MAX - 1).trimEnd() + "…"
    }

    /** The state line on the pill and the notification (string resources, so they can be translated). */
    fun labelRes(p: Phase): Int = when (p) {
        Phase.LISTENING -> R.string.voice_listening
        Phase.THINKING -> R.string.voice_thinking
        Phase.SPEAKING -> R.string.voice_speaking
        Phase.MUTED -> R.string.voice_muted
        Phase.IDLE -> R.string.voice_title
    }

    /** The wave and glow colour (ARGB): cyan listening, violet thinking, Colon blue speaking, grey muted. */
    fun accent(p: Phase): Int = when (p) {
        Phase.LISTENING -> 0xFF38BDF8.toInt()
        Phase.THINKING -> 0xFFA78BFA.toInt()
        Phase.SPEAKING -> 0xFF4169E1.toInt()
        Phase.MUTED, Phase.IDLE -> 0xFF94A3B8.toInt()
    }

    /** The edge glow's gradient stops (ARGB), Siri-like: the state's accent leads, then pink, violet and cyan. */
    fun glow(p: Phase): IntArray = when (p) {
        Phase.MUTED, Phase.IDLE -> intArrayOf(0xFF94A3B8.toInt(), 0xFF475569.toInt(), 0xFF94A3B8.toInt())
        else -> intArrayOf(accent(p), 0xFFF472B6.toInt(), 0xFFA78BFA.toInt(), 0xFF38BDF8.toInt(), accent(p))
    }

    /** How lively the wave is (0 flat .. 1 full): it follows the voice while listening and speaking. */
    fun waveEnergy(p: Phase): Float = when (p) {
        Phase.LISTENING -> 0.8f
        Phase.SPEAKING -> 1f
        Phase.THINKING -> 0.35f
        Phase.MUTED, Phase.IDLE -> 0f
    }

    /**
     * The pill needs "Display over other apps" (SYSTEM_ALERT_WINDOW, a special access the user grants in Settings).
     * Without it Colon asks once, then stays with the ongoing notification. Colon Browser never shows a pill.
     */
    fun surface(browserApp: Boolean, canDrawOverlays: Boolean, askedBefore: Boolean): Surface = when {
        browserApp -> Surface.NOTIFICATION
        canDrawOverlays -> Surface.PILL
        !askedBefore -> Surface.ASK
        else -> Surface.NOTIFICATION
    }

    /** The pill is on screen only while voice mode runs and Colon itself is not (the in-app overlay is then). */
    fun showPill(p: Phase, appVisible: Boolean, surface: Surface): Boolean =
        p != Phase.IDLE && !appVisible && surface == Surface.PILL

    /** Opened from the tile or the shortcut with "Display over other apps" on: Colon steps back behind the pill. */
    fun stepBack(compact: Boolean, p: Phase, canDrawOverlays: Boolean, serviceForeground: Boolean): Boolean =
        compact && p != Phase.IDLE && canDrawOverlays && serviceForeground

    /** Screen-corner radius in px: the display's own (API 31+ RoundedCorner) or [CORNER_FALLBACK_DP]. */
    fun cornerRadiusPx(displayRadiusPx: Int?, density: Float): Float =
        if (displayRadiusPx != null && displayRadiusPx > 0) displayRadiusPx.toFloat()
        else CORNER_FALLBACK_DP * density

    /** A finished touch on the pill: moved far = swipe (ends), held long = long-press (ends), else a tap. */
    fun gesture(dxPx: Float, dyPx: Float, heldMs: Long, density: Float): Gesture {
        val dist = kotlin.math.hypot(dxPx, dyPx)
        return when {
            dist >= SWIPE_DP * density -> Gesture.SWIPE_END
            dist > TAP_SLOP_DP * density -> Gesture.NONE
            heldMs >= LONG_PRESS_MS -> Gesture.LONG_PRESS
            else -> Gesture.TAP
        }
    }
}
