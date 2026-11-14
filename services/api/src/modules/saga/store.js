// Saga tasks and their action log in MySQL (migration 0009_saga_tasks.sql). Workers are recycled and a phone's
// socket may sit on another worker than the HTTP request, so everything about a task lives here: the worker that
// holds the phone claims a queued task, every step is appended, and Stop is a flag any worker can set.
const db = require('../../db');

const TERMINAL = ['done', 'step_limit', 'timeout', 'stopped', 'interrupted', 'failed'];
// handoff (Phase 10): Saga is waiting for the user to type a secret (password, code, card, PIN) and tap Return to AI.
// 0.10.3: while Saga waits for the user it is 'handoff' (Saga asked: needs_user), 'user_control' (the user took the
// browser) or 'paused'.
const WAITING = ['handoff', 'user_control', 'paused'];
const STATUSES = ['queued', 'consent', 'running', ...WAITING, ...TERMINAL];
const MODES = ['ai', 'shared'];

const json = (v) => (v == null ? null : JSON.stringify(v));
function parse(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

async function create({ userId, goal, language = 'en', conversationId = null, mode = 'ai' }) {
  const at = new Date();
  const r = await db.query(
    `INSERT INTO saga_tasks (user_id, goal, language, conversation_id, status, created_at, updated_at, mode)
     VALUES (?,?,?,?,?,?,?,?)`, [userId, goal, language, conversationId, 'queued', at, at,
      MODES.includes(mode) ? mode : 'ai']);
  return r.insertId;
}

const get = (id) => db.one('SELECT * FROM saga_tasks WHERE id = ?', [id]);
const getFor = (userId, id) => db.one('SELECT * FROM saga_tasks WHERE id = ? AND user_id = ?', [id, userId]);

// Atomic: exactly one worker gets a queued task.
async function claim(id, worker, deviceRef = null) {
  const r = await db.query(
    `UPDATE saga_tasks SET status = 'consent', worker = ?, device_ref = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'`,
    [worker, deviceRef, new Date(), id]);
  return Number(r.affectedRows) === 1;
}

async function setStatus(id, status, o = {}) {
  const fin = TERMINAL.includes(status);
  await db.query(
    `UPDATE saga_tasks SET status = ?, error = ?, steps = ?, answer = ?, sources = ?, updated_at = ?,
       finished_at = ? WHERE id = ?`,
    [status, o.error || null, o.steps || 0, o.answer == null ? null : String(o.answer), json(o.sources),
      new Date(), fin ? new Date() : null, id]);
}

/** Only the status (running <-> handoff / user_control / paused), keeping steps and everything else. */
const setPhase = (id, status) => db.query(
  `UPDATE saga_tasks SET status = ?, updated_at = ? WHERE id = ? AND status IN ('consent', 'running', ${
    WAITING.map((w) => `'${w}'`).join(', ')})`,
  [status, new Date(), id]);

/** A deleted conversation takes its Saga tasks and their action logs (saga_actions cascade) with it (Phase 10). */
// conv '*': every task that belongs to a conversation (all conversations were deleted).
function removeConversation(userId, conv) {
  if (!conv) return Promise.resolve();
  if (conv === '*') {
    return db.query('DELETE FROM saga_tasks WHERE user_id = ? AND conversation_id IS NOT NULL', [userId]);
  }
  return db.query('DELETE FROM saga_tasks WHERE user_id = ? AND conversation_id = ?', [userId, String(conv)]);
}

// Stop from any worker: the loop reads the flag before every step. A task still waiting for a phone ends now.
async function requestStop(userId, id) {
  await db.query('UPDATE saga_tasks SET stop_requested = 1, updated_at = ? WHERE id = ? AND user_id = ?',
    [new Date(), id, userId]);
  await db.query(
    "UPDATE saga_tasks SET status = 'stopped', finished_at = ? WHERE id = ? AND user_id = ? AND status = 'queued'",
    [new Date(), id, userId]);
}

async function isStopped(id) {
  const r = await db.one('SELECT stop_requested FROM saga_tasks WHERE id = ?', [id]);
  return !r || Boolean(Number(r.stop_requested));
}

async function addAction(taskId, userId, seq, e) {
  await db.query(
    `INSERT INTO saga_actions (task_id, user_id, seq, kind, tool, command, say, args, approval, approved, ok, error,
       url, title, page, ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [taskId, userId, seq, e.kind, e.tool || null, e.name || null, e.say || null, json(e.args || null),
      e.approval || null, e.approved || null, e.ok == null ? null : (e.ok ? 1 : 0), e.error || e.status || null,
      e.url || null, e.title || null, e.page || null, e.ms == null ? null : Math.max(0, Math.round(e.ms)),
      new Date()]);
}

async function actions(taskId, after = 0) {
  const rows = await db.query(
    `SELECT seq, kind, tool, command, say, args, approval, approved, ok, error, url, title, page, ms, created_at
       FROM saga_actions WHERE task_id = ? AND seq > ? ORDER BY seq LIMIT 200`, [taskId, after]);
  return rows.map((r) => ({ ...r, args: parse(r.args), ok: r.ok == null ? null : Boolean(Number(r.ok)) }));
}

// 0.10.3: with the conversation (the chat's task cards) and the result line (the finish step's words, the card's
// status pill); conv narrows it to one chat.
const list = (userId, limit = 20, conv = null) => db.query(
  `SELECT id, goal, status, error, steps, conversation_id, created_at, finished_at,
     (SELECT a.say FROM saga_actions a WHERE a.task_id = saga_tasks.id AND a.kind = 'finish' ORDER BY a.seq DESC
       LIMIT 1) AS result
     FROM saga_tasks WHERE user_id = ?${conv ? ' AND conversation_id = ?' : ''} ORDER BY id DESC LIMIT ?`,
  conv ? [userId, String(conv), limit] : [userId, limit]);

// Queued tasks of these users, newest first (the worker holding their phone picks them up).
async function queuedFor(userIds, since) {
  if (!userIds.length) return [];
  return db.query(
    `SELECT id, user_id, goal, language, conversation_id, mode FROM saga_tasks
      WHERE status = 'queued' AND user_id IN (?) AND created_at > ? ORDER BY id LIMIT 10`, [userIds, since]);
}

// Tasks nobody picked up: no phone with Colon AI open was connected.
const expireQueued = (before) => db.query(
  `UPDATE saga_tasks SET status = 'failed', error = 'no_phone', finished_at = ?
    WHERE status = 'queued' AND created_at < ?`,
  [new Date(), before]);

// 0.10.4: a task outlives its worker and its phone's socket. The worker running a task stamps it (touch) while it
// runs or waits; when it loses the phone it lets go (release: worker NULL) for a little while, and any worker that
// holds the user's phone then (or a worker that finds a task whose stamps stopped: its process was recycled) adopts
// it. A task nobody adopted within the grace ends as interrupted (expireOrphans).
const LIVE = ['consent', 'running', ...WAITING];
const liveIn = LIVE.map((w) => `'${w}'`).join(', ');
const touch = (id, worker) => db.query('UPDATE saga_tasks SET updated_at = ? WHERE id = ? AND worker = ?',
  [new Date(), id, worker]);
const release = (id, worker) => db.query('UPDATE saga_tasks SET worker = NULL, updated_at = ? WHERE id = ? AND '
  + 'worker = ?', [new Date(), id, worker]);

/** Takes a live task that nobody holds (or whose holder went quiet before staleBefore); true when this worker got it
 *  (atomic: one worker wins). */
async function adopt(id, worker, deviceRef, staleBefore) {
  const r = await db.query(
    `UPDATE saga_tasks SET worker = ?, device_ref = ?, updated_at = ? WHERE id = ? AND status IN (${liveIn})
      AND stop_requested = 0 AND (worker IS NULL OR updated_at < ?)`,
    [worker, deviceRef, new Date(), id, staleBefore]);
  return Number(r.affectedRows) === 1;
}

/** Live tasks of these users that nobody holds now (let go, or the holder's stamps stopped before staleBefore). */
async function orphansFor(userIds, staleBefore, since) {
  if (!userIds.length) return [];
  return db.query(
    `SELECT id, user_id, goal, language, conversation_id, mode, status, steps FROM saga_tasks
      WHERE status IN (${liveIn}) AND user_id IN (?) AND stop_requested = 0 AND (worker IS NULL OR updated_at < ?)
        AND updated_at > ?
      ORDER BY id LIMIT 10`, [userIds, staleBefore, since]);
}

/** Orphans nobody adopted since before: interrupted (the phone never came back). */
const expireOrphans = (before) => db.query(
  `UPDATE saga_tasks SET status = 'interrupted', error = 'disconnected', finished_at = ?
    WHERE status IN (${liveIn}) AND updated_at < ?`, [new Date(), before]);

/** Who holds the task now (null: nobody). */
const holder = async (id) => { const r = await db.one('SELECT worker FROM saga_tasks WHERE id = ?', [id]);
  return r ? r.worker || null : null; };

/** The task's last step number (a task adopted or continued goes on after it). */
const lastSeq = async (id) => { const r = await db.one('SELECT MAX(seq) AS seq FROM saga_actions WHERE task_id = ?',
  [id]); return r && r.seq ? Number(r.seq) : 0; };

async function adminList({ status = '', before = 0, limit = 50 } = {}) {
  const where = ['t.id < ?'];
  const p = [Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER];
  if (STATUSES.includes(status)) { where.push('t.status = ?'); p.push(status); }
  p.push(limit);
  return db.query(
    `SELECT t.id, t.user_id, u.email AS user_email, t.goal, t.status, t.error, t.steps, t.created_at, t.finished_at
       FROM saga_tasks t LEFT JOIN users u ON u.id = t.user_id WHERE ${where.join(' AND ')}
      ORDER BY t.id DESC LIMIT ?`, p);
}

// The client-facing shape of a task row.
function view(row) {
  if (!row) return null;
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return { id: Number(row.id), goal: row.goal, status: row.status, error: row.error || null, steps: Number(row.steps)
    || 0, answer: row.answer || '', sources: parse(row.sources) || [], conversation_id: row.conversation_id || null,
  mode: MODES.includes(row.mode) ? row.mode : 'ai', result: row.result ? String(row.result).slice(0, 80) : '',
  created_at: iso(row.created_at), finished_at: iso(row.finished_at) };
}

module.exports = { create, get, getFor, claim, setStatus, setPhase, removeConversation, requestStop, isStopped,
  addAction, actions, list, queuedFor, expireQueued, adminList, view, touch, release, adopt, orphansFor, expireOrphans,
  holder, lastSeq, TERMINAL, STATUSES, WAITING, LIVE, MODES };
