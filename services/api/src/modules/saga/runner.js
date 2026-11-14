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
const os = require('os');
const ai = require('../ai');
const browser = require('../browser');
const safety = require('../safety');
const audit = require('../../shared/audit');
const log = require('../../shared/logger');
const store = require('./store');
const loop = require('./loop');
const prompt = require('./prompt');

const WORKER = `${os.hostname()}:${process.pid}`.slice(0, 64);
const QUEUE_MS = 60000;                     // a queued task nobody claims within a minute fails with no_phone
const running = new Map();                  // task id -> bridge (tasks this worker runs)

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const n = (k, d) => (Number(env(k, d)) > 0 ? Number(env(k, d)) : d);
function settings() {
  return { enabled: env('SAGA_BROWSE', 'on') !== 'off', maxSteps: n('SAGA_MAX_STEPS', 15),
    taskTimeoutMs: n('SAGA_TASK_TIMEOUT_MS', 300000), modelTimeoutMs: n('SAGA_MODEL_TIMEOUT_MS', 60000),
    stepTimeoutMs: n('SAGA_STEP_TIMEOUT_MS', 20000), approvalTimeoutMs: n('SAGA_APPROVAL_TIMEOUT_MS', 120000),
    tasksPerHour: n('SAGA_TASKS_PER_HOUR', 20), handoffTimeoutMs: n('SAGA_HANDOFF_TIMEOUT_MS', 600000),
    userControlTimeoutMs: n('SAGA_USER_CONTROL_TIMEOUT_MS', 900000) };
}

// The user's phone on this worker: Colon AI first (the chat and its panel), then Colon Browser; newest hello first.
function pickBridge(userId) {
  const list = browser.bridge.connected(userId).sort((a, b) => (b.state.seen || 0) - (a.state.seen || 0));
  return list.find((b) => b.state.app === 'colonai') || list[0] || null;
}

const STATUS_FOR = { declined: ['stopped', 'declined'], stop: ['stopped', 'declined'], timeout: ['failed',
  'no_consent'], disconnected: ['interrupted', 'disconnected'], other_chat: ['interrupted', 'other_chat'] };
// Control reasons that leave a wait for the user going (still typing, took control, only changed the mode).
const STILL_WAITING = ['handoff', 'take_control', 'pause', 'resume', 'mode'];
// What ends a wait well: the user gave the browser back (or, after a pause, resumed).
const BACK = { handoff: ['return_to_ai'], user_control: ['return_to_ai'], paused: ['return_to_ai', 'resume'] };
const SLICE_MS = 3000;                      // a Stop pressed on another worker is noticed within this

/** Saga waits while the user types a secret in the panel or does what Saga asked: 'return_to_ai' or why it ended. */
async function waitHandoff(task, bridge, info, o, L) {
  const conversation = task.conversation_id || null;
  const w = bridge.waitControl(Math.min(SLICE_MS, L.handoffTimeoutMs));
  if (!o.phoneStarted && !bridge.handoff({ ...info, timeoutMs: L.handoffTimeoutMs }, { conversation })) {
    return 'other_chat';
  }
  return waitBack(task, bridge, 'handoff', L.handoffTimeoutMs, w);
}

/** 0.10.3: the user took the browser (why: manual_control) or paused it (paused): wait for it to come back. */
function waitUser(task, bridge, why, L) {
  // The phone's Stop (or a declined consent) also cancels the step in flight: that is not a wait, it's the end.
  if (bridge.state && bridge.state.consented === false) return Promise.resolve('stop');
  const phase = why === 'paused' ? 'paused' : 'user_control';
  return waitBack(task, bridge, phase, L.userControlTimeoutMs, bridge.waitControl(Math.min(SLICE_MS,
    L.userControlTimeoutMs)));
}

async function waitBack(task, bridge, phase, ms, first) {
  const until = Date.now() + ms;
  let w = first;
  await store.setPhase(task.id, phase);
  for (;;) {
    const reason = await w;
    if (BACK[phase].includes(reason)) { await store.setPhase(task.id, 'running'); return reason; }
    if (reason !== 'timeout' && !STILL_WAITING.includes(reason)) return reason;
    if (Date.now() >= until) return 'timeout';
    // Re-armed before anything else is awaited, so a Return to AI tapped meanwhile is never missed.
    w = bridge.waitControl(Math.min(SLICE_MS, until - Date.now()));
    if (await store.isStopped(task.id)) return 'stop';
  }
}

/** execute(task, bridge, deps) runs one claimed task to its end. deps: { generate, req } (tests inject them). */
async function execute(task, bridge, deps = {}) {
  const L = { ...settings(), ...(deps.limits || {}) };
  const req = deps.req || { ip: '' };
  let seq = 0;
  const add = (e) => store.addAction(task.id, task.user_id, ++seq, e).catch((err) => log.warn('saga_log_failed',
    { task: task.id, err: err.message }));
  if (!bridge.supports('get_page_content')) {
    await add({ kind: 'end', status: 'failed', error: 'app_update_needed' });
    return finish(task, { status: 'failed', error: 'app_update_needed', steps: 0 }, req);
  }
  const mode = store.MODES.includes(task.mode) ? task.mode : 'ai';
  const conversation = task.conversation_id || null;
  if (!(await bridge.hasControl())) {
    const answered = bridge.waitControl(L.approvalTimeoutMs);
    if (!(await bridge.askControl(mode, task.goal, { conversation }))) {
      await add({ kind: 'control', error: 'other_chat' });
      return finish(task, { status: 'interrupted', error: 'other_chat', steps: 0 }, req);
    }
    const reason = await answered;
    await add({ kind: 'control', error: reason });
    if (reason !== 'consent' && reason !== 'return_to_ai') {
      const [status, error] = STATUS_FOR[reason] || ['interrupted', String(reason).slice(0, 40)];
      return finish(task, { status, error, steps: 0 }, req, bridge);
    }
  }
  await store.setStatus(task.id, 'running');
  const generate = deps.generate || ai.generate;
  const context = prompt.system({ maxSteps: L.maxSteps, mode });
  const r = await loop.run({
    goal: task.goal, limits: L, log: add, isStopped: () => store.isStopped(task.id), mode,
    pageState: () => bridge.pageState && bridge.pageState(),
    handoff: (info, o) => waitHandoff(task, bridge, info, o, L),
    waitUser: (why) => waitUser(task, bridge, why, L),
    takeNote: () => (bridge.takeNote ? bridge.takeNote() : ''),
    decide: (messages, signal) => generate({ mode: 'general', language: task.language || 'en', messages, context,
      category: 'reasoning', signal, temperature: 0.2, timeouts: { maxTokens: 800 } }).then((x) => x.text),
    command: (name, args, o) => bridge.command(name, args, undefined, { ...o, conversation }),
  });
  // A Stop pressed in the chat cancels the command in flight, which reads as "interrupted": it was the user's Stop.
  if (r.status === 'interrupted' && await store.isStopped(task.id)) { r.status = 'stopped'; r.error = null; }
  await safety.recordInjection(r.flags, { route: 'saga', mode: 'browse', language: task.language, req });
  return finish(task, r, req, bridge);
}

async function finish(task, r, req, bridge) {
  await store.setStatus(task.id, r.status, { error: r.error, steps: r.steps, answer: r.answer, sources: r.sources });
  await audit(req, 'saga.task_finished', { actorId: task.user_id, targetType: 'saga_task', targetId: task.id,
    meta: { status: r.status, error: r.error || null, steps: r.steps || 0, sources: (r.sources || []).length } });
  // Saga hands the browser back: the phone leaves AI mode. Then (0.10.2) a word on the page; 0.10.3: the phone's
  // status pill shows it (the result line on done) and a wait for the user that ran out ends cleanly there too.
  if (bridge && (r.status !== 'interrupted' || TIMED_OUT.includes(r.error))) {
    const conversation = task.conversation_id || null;
    await bridge.askControl('manual', '', { conversation }).catch(() => {});
    if (bridge.notice) bridge.notice(endLine(r), endKind(r), { conversation });
  }
  return r;
}
const ENDED = { done: 'Done. Saga’s answer is in the chat.', stopped: 'Saga stopped.',
  failed: 'Saga couldn’t finish. Details are in the chat.', handoff_timeout: 'Saga stopped: it waited too long for '
    + 'you.', user_timeout: 'Saga stopped: the browser wasn’t given back in time.' };
const TIMED_OUT = ['handoff_timeout', 'user_timeout'];
const endKind = (r) => (r.status === 'done' ? 'done' : r.status === 'stopped' || TIMED_OUT.includes(r.error)
  ? 'stopped' : 'error');
const endLine = (r) => (r.status === 'done' && r.result ? r.result : ENDED[r.error] || ENDED[r.status] || ENDED.failed);

async function launch(task, bridge, deps) {
  if (running.has(task.id) || !(await store.claim(task.id, WORKER, bridge.state.ref))) return null;
  running.set(task.id, bridge);
  try { return await execute(task, bridge, deps); } catch (e) {
    log.error('saga_task_failed', { task: task.id, err: e.message, code: e.code });
    await store.setStatus(task.id, 'failed', { error: 'internal' }).catch(() => {});
    return null;
  } finally { running.delete(task.id); }
}

/** start(req, { goal, language, conversationId, mode }) -> { id, local } (local: this worker has the phone). */
async function start(req, o, deps = {}) {
  const mode = store.MODES.includes(o.mode) ? o.mode : 'ai';
  const id = await store.create({ userId: req.user.id, goal: o.goal, language: o.language,
    conversationId: o.conversationId, mode });
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
  const b = running.get(id);
  if (b && b.user && b.user.id === userId) await b.askControl('manual').catch(() => {});
}

// Picks up queued tasks for the users whose phones are connected to this worker.
async function sweep(deps) {
  const users = browser.bridge.users();
  await store.expireQueued(new Date(Date.now() - QUEUE_MS));
  if (!users.length) return;
  for (const t of await store.queuedFor(users, new Date(Date.now() - QUEUE_MS))) {
    const b = pickBridge(t.user_id);
    if (b) launch(t, b, deps);
  }
}

let timer = null;
function watch(ms = 2000) {
  if (timer) return;
  timer = setInterval(() => { if (browser.bridge.users().length) sweep().catch((e) => log.warn('saga_sweep_failed',
    { err: e.message })); }, ms);
  timer.unref();
}

module.exports = { start, stop, execute, launch, sweep, watch, settings, pickBridge, endKind, endLine, QUEUE_MS,
  WORKER };
