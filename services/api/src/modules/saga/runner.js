// Runs Saga browsing tasks on the user's phone (Phase 9). The phone's socket lives on one worker; the HTTP request
// that starts a task may land on another. So: the task is written to MySQL as `queued`; if this worker holds a
// Colon AI socket for the user it claims the task at once, otherwise the worker that does picks it up within
// ~2 s (watch(), started by the WebSocket gateway). Then: ask the phone for control (the user taps Allow), run the
// loop, store the result, hand control back. Stop works from any worker (a flag the loop reads before every step;
// on the worker running the task it also cancels the command in flight).
// Phase 10: a task belongs to its conversation's browser (commands carry it; the phone refuses them while its panel
// shows another chat) and runs in the chat's mode: 'ai' (AI only) or 'shared' (AI + me). When Saga reaches a secret
// field the task waits (status handoff) for the user's Return to AI, up to SAGA_HANDOFF_TIMEOUT_MS.
// 0.10.3: the in-chat browser is AI-only. Saga asks for the user with requestUserControl (status handoff, the
// phone's needs_user); Take control or Pause no longer end the task: it waits (status user_control / paused) up to
// SAGA_USER_CONTROL_TIMEOUT_MS for the user to give the browser back, with their message folded into the next step.
// A wait that runs out stops the task cleanly: the phone is told (control manual, a `stopped` notice).
// 0.10.4: the task talks to the phone through a link (link.js) that survives the socket dropping: waits for the
// user and steps re-attach to the same phone's next socket within SAGA_RECONNECT_GRACE_MS; a task whose phone came
// back on another worker, or whose worker was recycled, is adopted there (resume.js, from sweep). Every end tells
// the phone. A Continue (continue_of) starts a task from the earlier one's summary (a 'continue' row).
const os = require('os');
const ai = require('../ai');
const browser = require('../browser');
const safety = require('../safety');
const audit = require('../../shared/audit');
const log = require('../../shared/logger');
const store = require('./store');
const loop = require('./loop');
const prompt = require('./prompt');
const resume = require('./resume');
const { createLink } = require('./link');

const WORKER = `${os.hostname()}:${process.pid}`.slice(0, 64);
const QUEUE_MS = 60000;                     // a queued task nobody claims within a minute fails with no_phone
const running = new Map();                  // task id -> link (tasks this worker runs)

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const n = (k, d) => (Number(env(k, d)) > 0 ? Number(env(k, d)) : d);
function settings() {
  return { enabled: env('SAGA_BROWSE', 'on') !== 'off', maxSteps: n('SAGA_MAX_STEPS', 15),
    taskTimeoutMs: n('SAGA_TASK_TIMEOUT_MS', 300000), modelTimeoutMs: n('SAGA_MODEL_TIMEOUT_MS', 60000),
    stepTimeoutMs: n('SAGA_STEP_TIMEOUT_MS', 20000), approvalTimeoutMs: n('SAGA_APPROVAL_TIMEOUT_MS', 120000),
    tasksPerHour: n('SAGA_TASKS_PER_HOUR', 20), handoffTimeoutMs: n('SAGA_HANDOFF_TIMEOUT_MS', 600000),
    userControlTimeoutMs: n('SAGA_USER_CONTROL_TIMEOUT_MS', 900000),
    reconnectGraceMs: n('SAGA_RECONNECT_GRACE_MS', 90000) };
}

// The user's phone on this worker: Colon AI first (the chat and its panel), then Colon Browser; newest hello first.
function pickBridge(userId) { return pickFrom(browser.bridge.connected(userId)); }
function pickFrom(bridges) {
  const list = bridges.slice().sort((a, b) => (b.state.seen || 0) - (a.state.seen || 0));
  return list.find((b) => b.state.app === 'colonai') || list[0] || null;
}

const STATUS_FOR = { declined: ['stopped', 'declined'], stop: ['stopped', 'declined'], timeout: ['failed',
  'no_consent'], disconnected: ['interrupted', 'disconnected'], other_chat: ['interrupted', 'other_chat'] };
// Control reasons that leave a wait for the user going (still typing, took control, only changed the mode).
// 0.10.4: 'reconnected' too (the phone's socket dropped and came back: the user is still on it).
const STILL_WAITING = ['handoff', 'take_control', 'pause', 'resume', 'mode', 'reconnected'];
// What ends a wait well: the user gave the browser back (or, after a pause, resumed).
const BACK = { handoff: ['return_to_ai'], user_control: ['return_to_ai'], paused: ['return_to_ai', 'resume'] };
const SLICE_MS = 3000;                      // a Stop pressed on another worker is noticed within this

/** Saga waits while the user types a secret in the panel or does what Saga asked: 'return_to_ai' or why it ended. */
async function waitHandoff(task, link, info, o, L) {
  const conversation = task.conversation_id || null;
  const send = () => link.bridge.handoff({ ...info, timeoutMs: L.handoffTimeoutMs }, { conversation });
  const w = link.waitControl(Math.min(SLICE_MS, L.handoffTimeoutMs));
  if (!o.phoneStarted && !send()) return 'other_chat';
  // A socket that came back gets the request again (the phone shows it once; a repeat changes nothing).
  return waitBack(task, link, 'handoff', L.handoffTimeoutMs, w, send);
}

/** 0.10.3: the user took the browser (why: manual_control) or paused it (paused): wait for it to come back. */
function waitUser(task, link, why, L) {
  // The phone's Stop (or a declined consent) also cancels the step in flight: that is not a wait, it's the end.
  if (link.bridge.state && link.bridge.state.consented === false && !link.bridge.state.closed) {
    return Promise.resolve('stop');
  }
  const phase = why === 'paused' ? 'paused' : 'user_control';
  return waitBack(task, link, phase, L.userControlTimeoutMs, link.waitControl(Math.min(SLICE_MS,
    L.userControlTimeoutMs)));
}

async function waitBack(task, link, phase, ms, first, again) {
  const until = Date.now() + ms;
  let w = first;
  await store.setPhase(task.id, phase);
  for (;;) {
    const reason = await w;
    if (BACK[phase].includes(reason)) { await store.setPhase(task.id, 'running'); return reason; }
    if (link.moved) return 'moved';
    if (reason !== 'timeout' && !STILL_WAITING.includes(reason)) return reason;
    if (reason === 'reconnected' && again) again();
    if (Date.now() >= until) return 'timeout';
    // Re-armed before anything else is awaited, so a Return to AI tapped meanwhile is never missed.
    w = link.waitControl(Math.min(SLICE_MS, until - Date.now()));
    if (await store.isStopped(task.id)) return 'stop';
  }
}

/** The phone's consent for a task that doesn't have control yet ('consent' or why not). */
async function consent(task, link, mode, L) {
  const conversation = task.conversation_id || null;
  for (let tries = 0; tries < 2; tries++) {
    const answered = link.waitControl(L.approvalTimeoutMs);
    if (!(await link.bridge.askControl(mode, task.goal, { conversation }))) return 'other_chat';
    const reason = await answered;
    if (reason !== 'reconnected') return reason;
    if (await link.bridge.hasControl()) return 'consent';
  }
  return 'disconnected';
}

/** execute(task, bridge, deps) runs one claimed task to its end. deps: { generate, req, limits } (tests inject
 *  them), link (the run's), waiting (0.10.4: an adopted task that was waiting for the user: its phase). */
async function execute(task, bridge, deps = {}) {
  const L = { ...settings(), ...(deps.limits || {}) };
  const req = deps.req || { ip: '' };
  const link = deps.link || newLink(task, bridge, L);
  const past = await store.actions(task.id, 0).catch(() => []);
  let seq = past.reduce((m, a) => Math.max(m, Number(a.seq) || 0), 0);
  const add = (e) => (link.moved ? Promise.resolve() : store.addAction(task.id, task.user_id, ++seq, e).catch((err) =>
    log.warn('saga_log_failed', { task: task.id, err: err.message })));
  if (!link.bridge.supports('get_page_content')) {
    await add({ kind: 'end', status: 'failed', error: 'app_update_needed' });
    return finish(task, { status: 'failed', error: 'app_update_needed', steps: 0 }, req);
  }
  const mode = store.MODES.includes(task.mode) ? task.mode : 'ai';
  const conversation = task.conversation_id || null;
  let note = '';
  if (deps.waiting) {
    // Adopted while Saga waited for the user (0.10.4): the wait goes on here, on the phone's new socket.
    const ms = deps.waiting === 'handoff' ? L.handoffTimeoutMs : L.userControlTimeoutMs;
    const back = await waitBack(task, link, deps.waiting, ms, link.waitControl(Math.min(SLICE_MS, ms)));
    if (back === 'moved' || link.moved) return { status: 'moved' };
    await add({ kind: 'control', error: back });
    if (back !== 'return_to_ai' && back !== 'resume') {
      const error = back === 'timeout' ? (deps.waiting === 'handoff' ? 'handoff_timeout' : 'user_timeout')
        : String(back).slice(0, 40);
      return finish(task, { status: 'interrupted', error, steps: 0 }, req, link);
    }
    note = link.bridge.takeNote ? link.bridge.takeNote() : '';
  } else if (!(await link.bridge.hasControl())) {
    const reason = await consent(task, link, mode, L);
    if (link.moved) return { status: 'moved' };
    await add({ kind: 'control', error: reason });
    if (reason !== 'consent' && reason !== 'return_to_ai') {
      const [status, error] = STATUS_FOR[reason] || ['interrupted', String(reason).slice(0, 40)];
      return finish(task, { status, error, steps: 0 }, req, link);
    }
  }
  await store.setStatus(task.id, 'running', { steps: task.steps });
  const generate = deps.generate || ai.generate;
  const context = prompt.system({ maxSteps: L.maxSteps, mode });
  const history = resume.prompt(resume.historyOf(past));
  const r = await loop.run({
    goal: task.goal, limits: L, log: add, isStopped: () => store.isStopped(task.id), mode,
    history: note ? `${history}${history ? '\n\n' : ''}The user gave the browser back with this message (their `
      + `words, not page content): "${note}"` : history,
    pageState: () => link.bridge.pageState && link.bridge.pageState(),
    handoff: (info, o) => waitHandoff(task, link, info, o, L),
    waitUser: (why) => waitUser(task, link, why, L),
    takeNote: () => (link.bridge.takeNote ? link.bridge.takeNote() : ''),
    decide: (messages, signal) => generate({ mode: 'general', language: task.language || 'en', messages, context,
      category: 'reasoning', signal, temperature: 0.2, timeouts: { maxTokens: 800 } }).then((x) => x.text),
    command: (name, args, o) => link.command(name, args, undefined, { ...o, conversation }),
  });
  // Another worker holds the phone now and carries the task on (0.10.4): nothing more from here.
  if (link.moved) return { status: 'moved' };
  // A Stop pressed in the chat cancels the command in flight, which reads as "interrupted": it was the user's Stop.
  if (r.status === 'interrupted' && await store.isStopped(task.id)) { r.status = 'stopped'; r.error = null; }
  if (deps.adopted) r.steps = (r.steps || 0) + (Number(task.steps) || 0);
  await safety.recordInjection(r.flags, { route: 'saga', mode: 'browse', language: task.language, req });
  return finish(task, r, req, link);
}

function newLink(task, bridge, L) {
  return createLink(bridge, { task, worker: WORKER, graceMs: L.reconnectGraceMs, store, live: browser.bridge,
    pick: pickFrom });
}

async function finish(task, r, req, link) {
  await store.setStatus(task.id, r.status, { error: r.error, steps: r.steps, answer: r.answer, sources: r.sources });
  await audit(req, 'saga.task_finished', { actorId: task.user_id, targetType: 'saga_task', targetId: task.id,
    meta: { status: r.status, error: r.error || null, steps: r.steps || 0, sources: (r.sources || []).length } });
  // Saga hands the browser back: the phone leaves AI mode, and its status pill says how the task ended (the result
  // line on done). 0.10.4: every ending is told (an interrupted task too), unless the phone shows another chat.
  const bridge = link && link.bridge;
  if (bridge && !bridge.state.closed && r.error !== 'other_chat') {
    const conversation = task.conversation_id || null;
    await bridge.askControl('manual', '', { conversation }).catch(() => {});
    if (bridge.notice) bridge.notice(endLine(r), endKind(r), { conversation });
  }
  return r;
}
const ENDED = { done: 'Done. Saga’s answer is in the chat.', stopped: 'Saga stopped.',
  failed: 'Saga couldn’t finish. Details are in the chat.', handoff_timeout: 'Saga stopped: it waited too long for '
    + 'you.', user_timeout: 'Saga stopped: the browser wasn’t given back in time.', disconnected: 'Saga lost the '
    + 'link to the app. Tap Continue to carry on.', interrupted: 'Saga stopped. Tap Continue to carry on.' };
const TIMED_OUT = ['handoff_timeout', 'user_timeout'];
const endKind = (r) => (r.status === 'done' ? 'done' : r.status === 'stopped' || r.status === 'interrupted'
  || TIMED_OUT.includes(r.error) ? 'stopped' : 'error');
const endLine = (r) => (r.status === 'done' && r.result ? r.result : ENDED[r.error] || ENDED[r.status] || ENDED.failed);

async function launch(task, bridge, deps) {
  if (running.has(task.id) || !(await store.claim(task.id, WORKER, bridge.state.ref))) return null;
  return run(task, bridge, deps);
}

// Runs a task this worker holds (claimed, or adopted 0.10.4), stamping it while it runs so others know it is alive.
async function run(task, bridge, deps = {}) {
  const L = { ...settings(), ...(deps.limits || {}) };
  const link = newLink(task, bridge, L);
  running.set(task.id, link);
  const beat = setInterval(() => { if (!link.lost) store.touch(task.id, WORKER).catch(() => {}); }, resume.BEAT_MS);
  if (beat.unref) beat.unref();
  try { return await execute(task, bridge, { ...deps, link }); } catch (e) {
    log.error('saga_task_failed', { task: task.id, err: e.message, code: e.code });
    await store.setStatus(task.id, 'failed', { error: 'internal' }).catch(() => {});
    return null;
  } finally { clearInterval(beat); running.delete(task.id); }
}

/** start(req, { goal, language, conversationId, mode, continueOf, history }) -> { id, local } (local: this worker
 *  has the phone). 0.10.4: continueOf / history (resume.summary of the earlier task) make it a Continue. */
async function start(req, o, deps = {}) {
  const mode = store.MODES.includes(o.mode) ? o.mode : 'ai';
  const id = await store.create({ userId: req.user.id, goal: o.goal, language: o.language,
    conversationId: o.conversationId, mode });
  if (o.continueOf) {
    await store.addAction(id, req.user.id, 1, { kind: 'continue', say: `Continues task ${o.continueOf}`,
      args: { of: Number(o.continueOf), summary: String(o.history || '').slice(0, resume.MAX_SUMMARY) } });
  }
  await audit(req, 'saga.task_created', { actorId: req.user.id, targetType: 'saga_task', targetId: id,
    meta: { length: o.goal.length } });
  const b = pickBridge(req.user.id);
  const task = { id, user_id: req.user.id, goal: o.goal, language: o.language,
    conversation_id: o.conversationId || null, mode };
  const done = b ? launch(task, b, { ...deps, req: { ip: req.ip } }) : null;
  return { id, local: Boolean(b), done };
}

/** Stop from the chat: the flag (any worker) plus, here, the command in flight. */
async function stop(userId, id) {
  await store.requestStop(userId, id);
  const l = running.get(id);
  const b = l && l.bridge;
  if (b && b.user && b.user.id === userId) await b.askControl('manual').catch(() => {});
}

// Picks up queued tasks for the users whose phones are connected to this worker.
// 0.10.4: and adopts the live tasks of those users that nobody holds any more (resume.adoptOrphans).
async function sweep(deps) {
  const users = browser.bridge.users();
  await store.expireQueued(new Date(Date.now() - QUEUE_MS));
  if (!users.length) return;
  for (const t of await store.queuedFor(users, new Date(Date.now() - QUEUE_MS))) {
    const b = pickBridge(t.user_id);
    if (b) launch(t, b, deps);
  }
  await resume.adoptOrphans(users, deps, { graceMs: settings().reconnectGraceMs, worker: WORKER, running,
    pick: pickBridge, run });
}

let timer = null;
function watch(ms = 2000) {
  if (timer) return;
  timer = setInterval(() => { if (browser.bridge.users().length) sweep().catch((e) => log.warn('saga_sweep_failed',
    { err: e.message })); }, ms);
  timer.unref();
}

module.exports = { start, stop, execute, launch, run, sweep, watch, settings, pickBridge, endKind, endLine, QUEUE_MS,
  WORKER };
