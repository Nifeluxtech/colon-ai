package ng.nifelux.colonai

/**
 * 0.11.6 (owner's report on 0.11.5): Saga asked for a login (no saved login for the site), the phone showed the Colon
 * Secured Login form, the user SAVED it, and Saga stayed stuck: Give back reached the server only when the card was
 * already in [ChatRun.State.NEEDS_USER], which arrives asynchronously from the control state (or never, when that
 * state was lost), so the server waited its full SAGA_HANDOFF_TIMEOUT_MS. The rules for that wait, pure and
 * unit-tested in LoginWaitTest:
 *  - after the form (saved or closed) Give back always goes to the server, whatever the card shows;
 *  - a typed "continue" / "I've saved it" while Saga waits for a login says "Login saved for <site>" when the vault
 *    holds a login for the site (Saga then signs in at once, saved-login.js SAVED_NOTE);
 *  - a login saved from anywhere else (the chat's form card, Saved logins, an app that came back) also resumes.
 */
object LoginWait {
    const val DECLINED = "I didn't save a login."
    private const val SAVED_PREFIX = "Login saved for "

    fun savedNote(site: String): String = "$SAVED_PREFIX$site in Colon Secured Login"

    /** The form's answer as the note for Saga: [saved] is the site the form saved, null when it was closed. */
    fun formNote(saved: String?): String = saved?.let { savedNote(it) } ?: DECLINED

    /** A wait on the login form is open: the phone opened it for Saga ([pending]), or the card shows Saga's login
     *  request. */
    fun open(r: ChatRun.Run, pending: String?): Boolean =
        pending != null || (r.state == ChatRun.State.NEEDS_USER && r.request?.kind == "login")

    /** Give back reaches the server: always while a login wait is open, else only when Saga asked or the user took
     *  over a running task (0.10.3). */
    fun sends(r: ChatRun.Run, loginWait: Boolean): Boolean = loginWait || r.state == ChatRun.State.NEEDS_USER ||
        (r.state == ChatRun.State.USER_CONTROL && r.resumes)

    /** The note sent with Give back. While a login wait is open and the vault has a login for its site
     *  ([savedSite]), the user's "continue" becomes "Login saved for <site>"; the form's answers stay as they are. */
    fun note(message: String?, loginWait: Boolean, savedSite: String?): String? = when {
        !loginWait -> message
        message?.startsWith(SAVED_PREFIX) == true || message == DECLINED -> message
        savedSite != null -> savedNote(savedSite)
        else -> message
    }

    /** The site the wait is for: the form's own, Saga's last signIn, else the page's host. */
    fun site(pending: String?, lastSignIn: String?, pageUrl: String?): String? =
        pending ?: lastSignIn ?: VaultRules.site(pageUrl)

    /** The app came back, or a login was saved elsewhere: resume on its own when a login wait is open, the vault now
     *  holds a login for its site, and the user hasn't answered the form yet ([answered]). */
    fun resumesOnSaved(open: Boolean, answered: Boolean, savedSite: String?): Boolean =
        open && !answered && savedSite != null
}
