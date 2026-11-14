package ng.nifelux.colonai

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 0.11.0: keeps the in-chat browser panel rock steady while the thread scrolls (the owner's report: it "shakes").
 * The chat page reports the card's box at most once an animation frame, but each report reaches the app a frame or
 * two after the chat WebView has already drawn the scrolled thread, so following the reports as they come made the
 * panel lag, then catch up: a visible shake. Pure (unit-tested in InlineSteadyTest); ChatBrowserPanel applies the
 * result on the next vsync (Choreographer), never mid-layout:
 *  - a move under [deadPx] device px is no move at all (sub-pixel rounding no longer flips the panel by 1 px);
 *  - the size changes only past [sizeSlackPx] (no relayout on every report while the keyboard animates);
 *  - while reports keep coming in one direction (a scroll or fling), the panel leads by the motion of one frame
 *    ([LEAD_MS], at most [MAX_LEAD] px), which hides the report's lag; when the reports stop ([QUIET_MS]) or turn,
 *    the lead is dropped and the panel sits exactly on the box ([settle]).
 */
class InlineSteady(private val deadPx: Int = 1, private val sizeSlackPx: Int = 2) {
    /** What to do now: [placement] to apply; [relayout] when its size changed; [moved] false = leave the panel. */
    data class Move(val placement: InlineGeometry.Placement, val relayout: Boolean, val moved: Boolean)

    private var applied: InlineGeometry.Placement? = null
    private var lastTop = 0
    private var lastAt = -1L
    private var dir = 0
    private var streak = 0
    private var velocity = 0f            // px per ms, smoothed
    var exact: InlineGeometry.Placement? = null
        private set

    /** The panel is hidden or re-docked: start over. */
    fun reset() { applied = null; lastAt = -1L; dir = 0; streak = 0; velocity = 0f; exact = null }

    fun next(p: InlineGeometry.Placement, nowMs: Long): Move {
        val prev = applied
        exact = p
        if (!p.visible) {
            reset(); exact = p
            return Move(p, false, prev?.visible == true)
        }
        val dt = if (lastAt < 0) 0L else nowMs - lastAt
        val dy = p.top - lastTop
        val d = if (dy > 0) 1 else if (dy < 0) -1 else 0
        if (dt in 1..QUIET_MS && d != 0 && d == dir) {
            streak++
            velocity = 0.5f * velocity + 0.5f * (dy.toFloat() / dt)
        } else { streak = if (d != 0) 1 else 0; velocity = 0f }
        dir = d; lastTop = p.top; lastAt = nowMs
        val lead = if (streak >= 2) (velocity * LEAD_MS).roundToInt().coerceIn(-MAX_LEAD, MAX_LEAD) else 0
        return place(p, lead, prev)
    }

    /** No report for [QUIET_MS]: the exact box, without any lead. */
    fun settle(): Move? {
        val p = exact ?: return null
        streak = 0; velocity = 0f
        if (!p.visible) return null
        return place(p, 0, applied).takeIf { it.moved }
    }

    private fun place(p: InlineGeometry.Placement, lead: Int, prev: InlineGeometry.Placement?): Move {
        val sized = prev != null && prev.visible && abs(prev.width - p.width) <= sizeSlackPx &&
            abs(prev.height - p.height) <= sizeSlackPx
        val w = if (sized) prev!!.width else p.width
        val h = if (sized) prev!!.height else p.height
        val target = p.copy(top = p.top + lead, width = w, height = h)
        if (prev != null && prev.visible && sized && abs(prev.top - target.top) < deadPx &&
            abs(prev.left - target.left) < deadPx && abs(prev.clipTop - target.clipTop) < deadPx &&
            abs(prev.clipBottom - target.clipBottom) < deadPx) return Move(prev, false, false)
        applied = target
        return Move(target, !sized, true)
    }

    companion object {
        const val LEAD_MS = 16f
        const val MAX_LEAD = 48
        const val QUIET_MS = 100L
    }
}
