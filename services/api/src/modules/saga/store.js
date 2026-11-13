// Saga tasks and their action log in MySQL (migration 0009_saga_tasks.sql). Workers are recycled and a phone's
// socket may sit on another worker than the HTTP request, so everything about a task lives here: the worker that
// holds the phone claims a queued task, every step is appended, and Stop is a flag any worker can set.
const db = require('../../db');

const TERMINAL = ['done', 'step_limit', 'timeout', 'stopped', 'interrupted', 'failed'];
const STATUSES = ['queued', 'consent', 'running', ...TERMINAL];

const json = (v) => (v == null ? null : JSON.stringify(v));
function parse(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

async function create({ userId, goal, language = 'en', conversationId = null }) {
  const at = new Date();
  const r = await db.query(
    `INSERT INTO saga_tasks (user_id, goal, language, conversation_id, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`, [userId, goal, language, conversationId, 'queued', at, at]);
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

const list = (userId, limit = 20) => db.query(
  `SELECT id, goal, status, error, steps, created_at, finished_at FROM saga_tasks WHERE user_id = ?
    ORDER BY id DESC LIMIT ?`, [userId, limit]);

// Queued tasks of these users, newest first (the worker holding their phone picks them up).
async function queuedFor(userIds, since) {
  if (!userIds.length) return [];
  return db.query(
    `SELECT id, user_id, goal, language FROM saga_tasks WHERE status = 'queued' AND user_id IN (?) AND created_at > ?
      ORDER BY id LIMIT 10`, [userIds, since]);
}

// Tasks nobody picked up: no phone with Colon AI open was connected.
const expireQueued = (before) => db.query(
  `UPDATE saga_tasks SET status = 'failed', error = 'no_phone', finished_at = ?
    WHERE status = 'queued' AND created_at < ?`,
  [new Date(), before]);

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
  created_at: iso(row.created_at), finished_at: iso(row.finished_at) };
}

module.exports = { create, get, getFor, claim, setStatus, requestStop, isStopped, addAction, actions, list,
  queuedFor, expireQueued, adminList, view, TERMINAL, STATUSES };
