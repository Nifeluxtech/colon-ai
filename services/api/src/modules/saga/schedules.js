// Scheduled browsing (0.11.0, ADR 0007, migration 0011): the schedules a user keeps per chat, the claim of a due
// time (claimDue) and the report posted in the chat when a run ends. 0.16.0: each due time is a 'saga.schedule' job
// in colon_jobs (schedule-jobs.js), kept in step on create, pause / resume, run now and delete, so a schedule no longer
// depends on an in-process timer. The phone must be online with Colon AI connected: a schedule that came due while it
// wasn't runs when it next connects (its job is still due), once, and its message says it ran late. The run itself is
// an ordinary Saga task on that chat's browser (schedule_id set), with every approval and secret rule of any task.
const db = require('../../db');
const S = require('./schedule');
const jobsOf = require('./schedule-jobs');

const LATE_MS = 10 * 60e3;                      // a run this long after its time is reported as late
const MAX_PER_USER = () => { const n = Number(process.env.SAGA_SCHEDULES_MAX); return n > 0 ? Math.min(n, 50) : 10; };
const STATUSES = ['active', 'paused'];
const json = (v) => (v == null ? null : JSON.stringify(v));
const parse = (v) => { if (v == null || typeof v !== 'string') return v == null ? null : v;
  try { return JSON.parse(v); } catch { return null; } };

function view(r) {
  if (!r) return null;
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return { id: Number(r.id), name: r.name, goal: r.goal, conversation_id: r.conversation_id || null,
    cadence: r.cadence, at_minute: Number(r.at_minute), weekday: r.weekday == null ? null : Number(r.weekday),
    tz_offset: Number(r.tz_offset) || 0, status: r.status, when: S.describe(r), next_run_at: iso(r.next_run_at),
    last_run_at: iso(r.last_run_at), late: Boolean(r.late_since), runs: Number(r.runs) || 0 };
}

async function create(userId, o) {
  const n = await db.one('SELECT COUNT(*) AS n FROM saga_schedules WHERE user_id = ?', [userId]);
  if (n && Number(n.n) >= MAX_PER_USER()) {
    throw Object.assign(new Error(`You can keep up to ${MAX_PER_USER()} scheduled checks. Delete one first.`),
      { status: 422, code: 'limit' });
  }
  const at = new Date();
  const row = { cadence: o.cadence, at_minute: o.at_minute, weekday: o.weekday, tz_offset: o.tz_offset };
  const r = await db.query(
    `INSERT INTO saga_schedules (user_id, conversation_id, name, goal, language, cadence, at_minute, weekday,
       tz_offset, status, next_run_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, o.conversationId || null, o.name, o.goal, o.language || 'en', o.cadence, o.at_minute,
      o.weekday == null ? null : o.weekday, o.tz_offset, 'active', S.nextRun(row, at), at, at]);
  await jobsOf.sync(await get(r.insertId));
  return r.insertId;
}

const getFor = (userId, id) => db.one('SELECT * FROM saga_schedules WHERE id = ? AND user_id = ?', [id, userId]);
const get = (id) => db.one('SELECT * FROM saga_schedules WHERE id = ?', [id]);
const list = (userId, conv = null) => db.query(
  `SELECT * FROM saga_schedules WHERE user_id = ?${conv ? ' AND conversation_id = ?' : ''} ORDER BY id DESC LIMIT 50`,
  conv ? [userId, String(conv)] : [userId]);
async function remove(userId, id) {
  const r = await db.query('DELETE FROM saga_schedules WHERE id = ? AND user_id = ?', [id, userId]);
  await jobsOf.drop(id);
  return r;
}

/** Pause or resume; a resumed schedule's next run is recomputed from now (no burst of missed runs). */
async function setStatus(userId, id, status) {
  const r = await getFor(userId, id);
  if (!r) return null;
  await db.query('UPDATE saga_schedules SET status = ?, next_run_at = ?, late_since = NULL, updated_at = ? '
    + 'WHERE id = ? AND user_id = ?', [status, S.nextRun(r, new Date()), new Date(), id, userId]);
  const after = await getFor(userId, id);
  await jobsOf.sync(after);
  return after;
}

/** Run now (the chat's "run it now"): due at once. */
async function runNow(userId, id) {
  const r = await db.query('UPDATE saga_schedules SET next_run_at = ?, updated_at = ? WHERE id = ? AND '
    + "user_id = ? AND status = 'active'", [new Date(Date.now() - 1000), new Date(), id, userId]);
  await jobsOf.sync(await getFor(userId, id));
  return r;
}

/** A deleted chat takes its schedules with it ('*': every chat's), and their waiting jobs. */
async function removeConversation(userId, conv) {
  if (!conv) return;
  const all = conv === '*';
  const ids = (await list(userId, all ? null : conv)).filter((x) => all ? x.conversation_id
    : x.conversation_id === String(conv)).map((x) => x.id);
  if (all) await db.query('DELETE FROM saga_schedules WHERE user_id = ? AND conversation_id IS NOT NULL', [userId]);
  else await db.query('DELETE FROM saga_schedules WHERE user_id = ? AND conversation_id = ?', [userId, String(conv)]);
  for (const id of ids) await jobsOf.drop(id);
}

/**
 * claimDue(s, now) -> { late } | null: takes this due time of schedule `s` (moves next_run_at on, counts the run).
 * Atomic on next_run_at, so a due time runs once even when two workers (or an old and a new release) try it.
 */
async function claimDue(s, now = new Date()) {
  const late = now.getTime() - new Date(s.next_run_at).getTime() > LATE_MS ? new Date(s.next_run_at) : null;
  const r = await db.query(
    `UPDATE saga_schedules SET next_run_at = ?, last_run_at = ?, late_since = ?, runs = runs + 1, updated_at = ?
      WHERE id = ? AND next_run_at = ?`, [S.nextRun(s, now), now, late, now, s.id, s.next_run_at]);
  return Number(r.affectedRows) === 1 ? { late } : null;
}

/** The active schedules (of these users, or everyone's when users is null), for schedule-jobs.ensure. */
function active(users = null, limit = 500) {
  if (users && !users.length) return Promise.resolve([]);
  return db.query(`SELECT * FROM saga_schedules WHERE status = 'active'${users ? ' AND user_id IN (?)' : ''}
    ORDER BY id LIMIT ?`, users ? [users, limit] : [limit]);
}

/**
 * complete(task, r, deps): a scheduled task ended. Posts the report in the schedule's chat (deps.post(userId, conv,
 * content, sources)) with what is new since the last run, then keeps this run's items for the next one.
 */
async function complete(task, r, deps) {
  const s = await get(task.schedule_id);
  if (!s) return null;
  const found = S.items(r.answer, r.tables);
  const prev = parse(s.last_items);
  const d = r.status === 'done' ? S.diff(prev, found) : { first: false, fresh: [] };
  const content = S.message(s, r, { late: s.late_since, ranAt: s.last_run_at || new Date(), ...d });
  if (s.conversation_id) {
    try { await deps.post(s.user_id, s.conversation_id, content, r.sources || []); } catch (e) {
      if (e && (e.status === 404 || e.code === 'not_found')) await setStatus(s.user_id, s.id, 'paused');
    }
  }
  await db.query('UPDATE saga_schedules SET last_items = ?, last_task_id = ?, late_since = NULL, updated_at = ? '
    + 'WHERE id = ?', [r.status === 'done' ? json(found) : s.last_items, task.id, new Date(), s.id]);
  return { content, fresh: d.fresh };
}

module.exports = { create, get, getFor, list, remove, setStatus, runNow, removeConversation, claimDue, active, complete,
  view, STATUSES, LATE_MS, MAX_PER_USER };
