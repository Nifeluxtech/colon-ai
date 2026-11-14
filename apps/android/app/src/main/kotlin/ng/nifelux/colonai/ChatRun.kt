package ng.nifelux.colonai

import org.json.JSONObject

/**
 * 0.10.3: where a chat's Saga task stands, as the in-chat browser card shows it (docs/decisions/0006). Pure and
 * unit-tested (ChatRunTest); ChatRunKeeper persists it per chat so it survives an app restart.
 *
 * The chat's browser is AI-only: the user's touches reach the page only in [State.USER_CONTROL], which the user
 * enters by tapping Take control (their own choice, or because Saga asked: [State.NEEDS_USER]).
 *   idle -> running (a task starts) -> paused <-> running
 *   running -> needs_user (Saga asked: sign-in, code, captcha, payment, consent) -> user_control (Take control)
 *   running | paused -> user_control (the user's own Take control)
 *   user_control -> running (Give back to Saga, or a message in the composer; the task resumes with it)
 *   any live state -> done | error | stopped (the task ended, the user stopped it, or a wait for the user ran out)
 * [ControlState] (shared with Colon Browser) stays what the server is told; [fromControl] maps it onto this.
 * 0.10.4: a task the server still holds is never given up on the phone: after the app was closed it waits for the
 * user ([restore]: Give back carries on), and an ended card whose page is still there offers Continue ([pill]).
 */
object ChatRun {
    enum class State(val wire: String) {
        IDLE("idle"), RUNNING("running"), PAUSED("paused"), NEEDS_USER("needs_user"), USER_CONTROL("user_control"),
        DONE("done"), ERROR("error"), STOPPED("stopped");

        companion object {
            fun from(s: String?): State? = entries.firstOrNull { it.wire == s }
        }
    }

    /** Saga's request to the user ([kind] sign_in · one_time_code · captcha · payment · consent · password …). */
    data class Request(val kind: String, val message: String)

    /**
     * [task] the server's task id (null for a task the chat page hasn't named yet, or the user's own Take control
     * with no task); [anchor] the chat message the card sits under; [step] Saga's latest words; [result] the line
     * shown when it ended; [deadline] when Saga stops waiting for the user (ms since the epoch, 0 = none);
     * [resumes] Give back resumes a Saga task (false: the user took an idle browser, nothing to resume).
     */
    data class Run(
        val state: State = State.IDLE, val task: String? = null, val goal: String = "", val anchor: String? = null,
        val step: String = "", val request: Request? = null, val result: String = "", val since: Long = 0L,
        val deadline: Long = 0L, val resumes: Boolean = false,
    )

    val IDLE = Run()
    private val LIVE = setOf(State.RUNNING, State.PAUSED, State.NEEDS_USER, State.USER_CONTROL)
    private val ENDED = setOf(State.DONE, State.ERROR, State.STOPPED)
    const val MAX_TEXT = 160
    /** How long the phone waits for the user after their own Take control (the server's
     *  SAGA_USER_CONTROL_TIMEOUT_MS default) and, when the server sends none, after Saga asked. */
    const val USER_TIMEOUT_MS = 15 * 60_000L
    const val ASK_TIMEOUT_MS = 10 * 60_000L
    /** The phone gives the server this long past a deadline to end the task itself before it does. */
    const val GRACE_MS = 30_000L

    fun live(s: State): Boolean = s in LIVE
    fun ended(s: State): Boolean = s in ENDED

    /** Only here may the user's touches, scrolls and keys reach the page. */
    fun touchesPage(s: State): Boolean = s == State.USER_CONTROL

    fun start(task: String?, goal: String, anchor: String?, now: Long): Run =
        Run(State.RUNNING, task?.take(40), clean(goal), anchor?.take(64), "", null, "", now)

    /** The chat page names the task it started ([task] id, [goal], the message [anchor] the card goes under): a
     *  task already running without a name (consent came first) keeps its state; anything else starts afresh. */
    fun named(r: Run, task: String?, goal: String, anchor: String?, now: Long): Run =
        if (live(r.state) && (r.task == null || r.task == task)) {
            r.copy(task = task?.take(40) ?: r.task, goal = clean(goal).ifEmpty { r.goal },
                anchor = anchor?.take(64) ?: r.anchor)
        } else start(task, goal, anchor, now)

    /** Saga's words for the current step ("Clicking Sign in"). */
    fun step(r: Run, text: String?): Run {
        val t = clean(text)
        return if (t.isEmpty() || !live(r.state)) r else r.copy(step = t)
    }

    /**
     * The control state the server knows about, mapped onto the card. [userStopped]: the user tapped Stop (else a
     * Manual with nothing to resume means the task ended on the server: done until its notice says otherwise).
     */
    fun fromControl(r: Run, mode: ControlState.Mode, paused: Boolean, handoff: ControlState.Handoff?,
                    resumable: ControlState.Mode?, now: Long, askTimeoutMs: Long, userStopped: Boolean): Run = when {
        mode != ControlState.Mode.MANUAL ->
            if (r.state == State.RUNNING && !paused || r.state == State.PAUSED && paused) r
            else (if (live(r.state)) r else start(null, "", null, now)).copy(
                state = if (paused) State.PAUSED else State.RUNNING, request = null, deadline = 0L, since = now)
        // The user took an idle browser: nothing on the server changes that.
        r.state == State.USER_CONTROL && !r.resumes -> r
        handoff != null -> if (r.state == State.USER_CONTROL && r.request != null) r
            else r.copy(state = State.NEEDS_USER, request = Request(clean(handoff.kind, 20), clean(handoff.message)),
                deadline = now + (if (askTimeoutMs > 0) askTimeoutMs else ASK_TIMEOUT_MS), since = now)
        resumable != null -> if (r.state == State.USER_CONTROL) r
            else r.copy(state = State.USER_CONTROL, deadline = now + USER_TIMEOUT_MS, resumes = true, since = now)
        userStopped -> end(r, "stopped", null, now)
        live(r.state) -> end(r, "done", null, now)
        else -> r
    }

    /** The user's Take control: from Saga's request, from a running or paused task, or on an idle browser. */
    fun takeControl(r: Run, now: Long): Run = when (r.state) {
        State.USER_CONTROL -> r
        State.NEEDS_USER -> r.copy(state = State.USER_CONTROL, since = now, resumes = true)
        State.RUNNING, State.PAUSED -> r.copy(state = State.USER_CONTROL, since = now, resumes = true,
            deadline = now + USER_TIMEOUT_MS)
        else -> r.copy(state = State.USER_CONTROL, since = now, resumes = false, deadline = 0L, request = null)
    }

    /** Give back to Saga (the button, or a message from the composer): Saga resumes; an idle take-over just ends. */
    fun giveBack(r: Run, now: Long): Run = when {
        r.state != State.USER_CONTROL && r.state != State.NEEDS_USER -> r
        r.resumes || r.state == State.NEEDS_USER ->
            r.copy(state = State.RUNNING, request = null, deadline = 0L, since = now, step = "")
        r.result.isNotEmpty() -> r.copy(state = State.DONE, deadline = 0L, since = now)
        else -> r.copy(state = State.IDLE, deadline = 0L, since = now)
    }

    /** The task ended: [kind] done · error · stopped (the server's notice, the chat page's poll, or the user). */
    fun end(r: Run, kind: String, text: String?, now: Long): Run {
        val state = when (kind) { "done" -> State.DONE; "stopped" -> State.STOPPED; else -> State.ERROR }
        // A later word on the same ending only refines its line (the notice after the control change).
        if (ended(r.state) && r.state != State.DONE && state == State.DONE) return r
        val line = clean(text).ifEmpty { if (ended(r.state) && r.state == state) r.result else "" }
        return r.copy(state = state, result = line, request = null, deadline = 0L, since = now)
    }

    /** A wait for the user that ran out (past its deadline and the server's grace): Saga stops cleanly. */
    fun expired(r: Run, now: Long): Boolean =
        (r.state == State.NEEDS_USER || r.state == State.USER_CONTROL) && r.deadline > 0 && now > r.deadline + GRACE_MS

    /** The step text of a task the app picked up again after it was closed. */
    const val APP_CLOSED = "app_closed"

    /**
     * After the app was closed (process death). 0.10.4: a task the server knows ([Run.task]) waits for the user: the
     * server keeps it while the phone reconnects, so Saga's request stays as it was, and a task Saga was running
     * becomes the user's turn ([APP_CLOSED]): Give back carries it on. A task the chat never named can't be
     * followed: it ends as before.
     */
    fun restore(r: Run, now: Long = System.currentTimeMillis()): Run = when {
        !live(r.state) -> r
        r.task == null -> r.copy(state = State.ERROR, result = "", request = null, deadline = 0L, step = APP_CLOSED)
        r.state == State.NEEDS_USER -> r
        r.state == State.USER_CONTROL -> r.copy(resumes = true)
        else -> r.copy(state = State.USER_CONTROL, resumes = true, request = null, step = APP_CLOSED, since = now,
            deadline = now + USER_TIMEOUT_MS)
    }

    /** The status pill: [icon] spinner · check · error · turn · pause · none. [cont] (0.10.4): the ended card's
     *  button is Continue (the chat's browser still has the page: Saga carries on there), else Retry. */
    data class Pill(val icon: String, val text: String, val takeControl: Boolean, val giveBack: Boolean,
                    val retry: Boolean, val stop: Boolean, val cont: Boolean = false)

    /** [page]: the chat's browser still has a web page open (Continue instead of Retry). [linked]: the phone's link
     *  to the server is up (else a running task says it is reconnecting: the server waits for the phone). */
    fun pill(r: Run, words: Words, page: Boolean = false, linked: Boolean = true): Pill = basePill(r, words).let {
        when {
            it.retry && page -> it.copy(cont = true)
            !linked && r.state == State.RUNNING -> it.copy(text = words.reconnecting)
            else -> it
        }
    }

    private fun basePill(r: Run, words: Words): Pill = when (r.state) {
        State.IDLE -> Pill("none", "", false, false, false, false)
        State.RUNNING -> Pill("spinner", r.step.ifEmpty { words.working }, false, false, false, true)
        State.PAUSED -> Pill("pause", words.paused, false, false, false, true)
        State.NEEDS_USER -> Pill("turn", words.needsYou(r.request?.message ?: ""), true, false, false, true)
        State.USER_CONTROL -> Pill("turn", when {
            r.step == APP_CLOSED -> words.appPaused
            r.resumes -> words.yourTurn
            else -> words.youControl
        }, false, true, false, r.resumes)
        State.DONE -> Pill("check", r.result.ifEmpty { words.done }, false, false, false, false)
        State.STOPPED -> Pill("error", r.result.ifEmpty { words.stopped }, false, false, r.goal.isNotEmpty(), false)
        State.ERROR -> Pill("error", if (r.step == APP_CLOSED) words.appClosed else r.result.ifEmpty { words.failed },
            false, false, r.goal.isNotEmpty(), false)
    }

    /** The pill's fixed words (strings.xml in the app; plain English in tests). */
    data class Words(val working: String, val paused: String, val yourTurn: String, val youControl: String,
                     val done: String, val stopped: String, val failed: String, val appClosed: String,
                     val appPaused: String = "The app closed while Saga worked. Give back to carry on",
                     val reconnecting: String = "Reconnecting to Saga…",
                     val needsYou: (String) -> String)

    fun toJson(r: Run): JSONObject = JSONObject().put("state", r.state.wire).put("task", r.task ?: JSONObject.NULL)
        .put("goal", r.goal).put("anchor", r.anchor ?: JSONObject.NULL).put("step", r.step)
        .put("request", r.request?.let { JSONObject().put("kind", it.kind).put("message", it.message) }
            ?: JSONObject.NULL)
        .put("result", r.result).put("since", r.since).put("deadline", r.deadline).put("resumes", r.resumes)

    fun fromJson(o: JSONObject?): Run {
        o ?: return IDLE
        val req = o.optJSONObject("request")
        return Run(State.from(o.optString("state")) ?: State.IDLE, o.optString("task").takeIf { o.has("task") &&
            !o.isNull("task") && it.isNotEmpty() }?.take(40), clean(o.optString("goal")),
            o.optString("anchor").takeIf { !o.isNull("anchor") && it.isNotEmpty() }?.take(64),
            o.optString("step").take(MAX_TEXT),
            req?.let { Request(clean(it.optString("kind"), 20), clean(it.optString("message"))) },
            clean(o.optString("result")), o.optLong("since"), o.optLong("deadline"), o.optBoolean("resumes"))
    }

    /** One line for a small screen (BridgeProtocol.line), at most [max] characters; "" for nothing. */
    fun clean(s: String?, max: Int = MAX_TEXT): String = BridgeProtocol.line(s, max) ?: ""
}
