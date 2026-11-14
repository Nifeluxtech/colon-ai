package ng.nifelux.colonai

/**
 * 0.11.1: the in-chat browser's full-screen view and how it goes back to the card (pure, unit-tested in
 * FocusRulesTest). The owner (Infinix SMART 20, 0.11.0) could make the card full screen with its expand button but
 * found no way back: the only control was in the slim top bar, and with a page that hadn't (yet) said it draws the
 * card the panel was in the stacked FULL layout, where the card still showed "expand" (which did nothing) and Back
 * walked the page's history first. Now full screen is one idea in both layouts: the card's corner button turns
 * into "minimise" where the user's finger already is, the top bar keeps "back to the chat", and Back collapses.
 */
object FocusRules {
    /** Full screen now: the view over the chat (inline, [focus]) or the stacked FULL layout (not docked). */
    fun isFull(open: Boolean, focus: Boolean, docked: Boolean, mode: PanelLayout.Mode): Boolean =
        open && (focus || (!docked && mode == PanelLayout.Mode.FULL))

    enum class Back { VIDEO, COLLAPSE, PAGE, NONE }

    /** What the phone's Back does: leave full-screen video, then leave full screen (back to the card), then go back
     *  in the page when the panel was touched last; otherwise the chat handles it. */
    fun back(video: Boolean, open: Boolean, full: Boolean, panelTouched: Boolean): Back = when {
        video -> Back.VIDEO
        !open -> Back.NONE
        full -> Back.COLLAPSE
        panelTouched -> Back.PAGE
        else -> Back.NONE
    }

    /** The layout to go back to from the stacked FULL layout: the one before it, never FULL again. */
    fun leaveFull(beforeFull: PanelLayout.Mode): PanelLayout.Mode =
        if (beforeFull == PanelLayout.Mode.FULL) PanelLayout.Mode.INLINE else beforeFull
}
