package ng.nifelux.colonai

/**
 * Layouts of Colon AI's in-chat browser panel (ROADMAP Phase 10). Pure, unit-tested in PanelLayoutTest.
 * - inline (v0.9.1, phones' default): the panel sits in the chat thread, in the Colon Browser card the chat page
 *   draws (the page reports the card's box with browser('anchor'), InlineGeometry places the panel over it). Only
 *   with a page that says it can draw the card ({inline: true} on its browser calls); otherwise it is embedded;
 * - embedded: the panel sits above the chat at a fixed share of the height; it can collapse to its header;
 * - split: panel and chat share the screen with a draggable divider (stacked on phones, side by side on wide
 *   screens in landscape);
 * - full: the panel fills the screen (back or the shrink button returns to the previous layout).
 * Switching only resizes views, so the page, its tabs and Saga's session are never reloaded.
 */
object PanelLayout {
    enum class Mode(val wire: String) {
        INLINE("inline"), EMBEDDED("embedded"), SPLIT("split"), FULL("full");

        companion object {
            fun from(s: String?): Mode? = entries.firstOrNull { it.wire == s }
        }
    }

    const val EMBEDDED_SHARE = 0.42f
    const val MIN_SHARE = 0.25f
    const val MAX_SHARE = 0.75f
    const val WIDE_DP = 720

    /** Phones open in the thread (inline); tablets and wide landscape screens open split. */
    fun defaultMode(widthDp: Int): Mode = if (widthDp >= WIDE_DP) Mode.SPLIT else Mode.INLINE

    /** The layout actually used. [webInline]: the chat page can draw the inline card (true), can't (false: an
     *  older page, so embedded as before), or is loading and hasn't said yet (null: stay inline, hidden). */
    fun effective(mode: Mode, webInline: Boolean?): Mode =
        if (mode == Mode.INLINE && webInline == false) Mode.EMBEDDED else mode

    /** Collapsing leaves full screen and split for a layout that can collapse: back to the thread when full screen
     *  was entered from it, otherwise embedded. */
    fun collapseTarget(mode: Mode, beforeFull: Mode): Mode = when (mode) {
        Mode.INLINE, Mode.EMBEDDED -> mode
        Mode.FULL -> if (beforeFull == Mode.INLINE) Mode.INLINE else Mode.EMBEDDED
        Mode.SPLIT -> Mode.EMBEDDED
    }

    /** Side by side (browser beside the chat) only on wide landscape screens; otherwise stacked. */
    fun sideBySide(mode: Mode, widthDp: Int, heightDp: Int): Boolean =
        mode == Mode.SPLIT && widthDp >= WIDE_DP && widthDp > heightDp

    fun clampShare(share: Float): Float =
        if (share.isNaN()) EMBEDDED_SHARE else share.coerceIn(MIN_SHARE, MAX_SHARE)

    /** The panel's share of the space (0 = header only, 1 = everything). */
    fun panelShare(mode: Mode, collapsed: Boolean, splitShare: Float): Float = when (mode) {
        Mode.FULL -> 1f
        Mode.INLINE -> 0f // not in the stacked box: the panel is over the chat, in the thread
        Mode.EMBEDDED -> if (collapsed) 0f else EMBEDDED_SHARE
        Mode.SPLIT -> clampShare(splitShare)
    }

    /** Divider drag: the new share from the finger's position along the box (stacked: y; side by side: x from the
     *  right, since the panel is on the right). */
    fun shareFromDrag(pos: Float, size: Float, panelAtEnd: Boolean): Float {
        if (size <= 0f) return EMBEDDED_SHARE
        val share = if (panelAtEnd) (size - pos) / size else pos / size
        return clampShare(share)
    }
}
