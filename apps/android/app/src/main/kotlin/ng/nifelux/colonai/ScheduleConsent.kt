package ng.nifelux.colonai

import android.content.Context

/**
 * 0.11.0: scheduled browsing. A schedule the user creates in the chat runs on this phone at its time (the server asks
 * over the bridge; control `scheduled`). Creating one from the app (browser('schedules', {allow: true})) is the
 * user's consent for those runs, so they don't stop at "Let Saga browse?" at 8 am; the user can switch it off. A
 * run the user never allowed on this phone still asks.
 */
object ScheduleConsent {
    private const val PREFS = "colon.saga"
    private const val KEY = "allow_schedules"

    fun allowed(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

    fun set(context: Context, on: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply()
    }

    /** Should the panel switch to the schedule's chat for its run? Only when nothing of the user's is going on in
     *  the chat it shows (no live task, the user isn't holding the browser) and the run is allowed. */
    fun switches(allowed: Boolean, liveHere: Boolean, sameChat: Boolean): Boolean = allowed && !liveHere && !sameChat
}
