// MySQL storage for the browser session manager (migration 0008_browser_sessions.sql). Workers are recycled, so
// every session lives here, never only in memory. Writes that touch a session run in one transaction and bump
// its `version` (optimistic concurrency: a writer that sends a stale version gets a conflict, not a lost update).
const db = require('../../db');

const IDLE_DAYS = 30;
const HISTORY_KEEP = 2000;
const SESSION_COLS = 'id, user_id, device_ref, active_tab_id, control, control_owner, paused, task, version, '
  + 'updated_at';

// Runs fn(q) in a transaction when a real pool exists; q(sql, params) -> rows (like db.query).
async function tx(fn) {
  const pool = typeof db.getPool === 'function' ? db.getPool() : null;
  if (!pool) return fn((sql, p) => db.query(sql, p));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(async (sql, p) => (await conn.query(sql, p))[0]);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally { conn.release(); }
}

const q0 = (sql, p) => db.query(sql, p);

/** device(userId, deviceId, app, appVersion) -> device row id (created or touched). */
async function touchDevice(userId, deviceId, app, appVersion = '', q = q0) {
  const r = await q(
    `INSERT INTO browser_devices (user_id, device_id, app, app_version, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), last_seen_at = UTC_TIMESTAMP(3),
       app_version = IF(VALUES(app_version) = '', app_version, VALUES(app_version))`,
    [userId, deviceId, app, String(appVersion || '').slice(0, 32)]);
  return r.insertId;
}

async function findDevice(userId, deviceId, app, q = q0) {
  const rows = await q('SELECT id FROM browser_devices WHERE user_id = ? AND device_id = ? AND app = ?',
    [userId, deviceId, app]);
  return rows[0] ? rows[0].id : null;
}

/** load(userId, deviceRef) -> { row, tabs } or null */
async function load(userId, deviceRef, q = q0, lock = false) {
  const rows = await q(`SELECT ${SESSION_COLS} FROM browser_sessions WHERE user_id = ? AND device_ref = ?`
    + (lock ? ' FOR UPDATE' : ''), [userId, deviceRef]);
  if (!rows[0]) return null;
  const tabs = await q('SELECT tab_id, url, title, position, nav FROM browser_tabs WHERE session_id = ? '
    + 'ORDER BY position', [rows[0].id]);
  return { row: rows[0], tabs };
}

const ownerOf = (control) => (control === 'manual' ? 'user' : 'saga');

async function writeTabs(q, sessionId, tabs) {
  await q('DELETE FROM browser_tabs WHERE session_id = ?', [sessionId]);
  if (!tabs.length) return;
  await q('INSERT INTO browser_tabs (session_id, tab_id, url, title, position, nav, updated_at) VALUES ?',
    [tabs.map((t) => [sessionId, t.tab_id, t.url, t.title, t.position, (t.back.length || t.fwd.length)
      ? JSON.stringify({ back: t.back, fwd: t.fwd }) : null, new Date()])]);
}

/**
 * save(userId, deviceRef, state, { version, control_owner }) -> { conflict: false, session } or
 * { conflict: true, session (current, may be null) }. state comes from session.normalize(). version: the version
 * the writer last saw (null/undefined = unconditional write, used by the phone's own sync).
 */
async function save(userId, deviceRef, state, o = {}) {
  return tx(async (q) => {
    const cur = await load(userId, deviceRef, q, true);
    const want = o.version == null || o.version === '' ? null : Number(o.version);
    if (cur && want != null && want !== Number(cur.row.version)) return { conflict: true, session: cur };
    if (!cur && want != null && want !== 0) return { conflict: true, session: null };
    const owner = o.control_owner || ownerOf(state.control);
    let id;
    if (cur) {
      id = cur.row.id;
      await q(`UPDATE browser_sessions SET active_tab_id = ?, control = ?, control_owner = ?, paused = ?, task = ?,
         version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [state.active_tab_id, state.control, owner, state.paused ? 1 : 0, state.task, id]);
    } else {
      const r = await q(`INSERT INTO browser_sessions (user_id, device_ref, active_tab_id, control, control_owner,
         paused, task, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(3))`,
      [userId, deviceRef, state.active_tab_id, state.control, owner, state.paused ? 1 : 0, state.task]);
      id = r.insertId;
    }
    await writeTabs(q, id, state.tabs);
    return { conflict: false, session: await load(userId, deviceRef, q) };
  });
}

/** setControl(userId, deviceRef, { control, control_owner, paused, task? }) -> the session after the change. */
async function setControl(userId, deviceRef, c) {
  const cur = await load(userId, deviceRef);
  if (!cur) {
    return save(userId, deviceRef, { tabs: [], active_tab_id: null, control: c.control, paused: c.paused,
      task: c.task || '' }, { control_owner: c.control_owner }).then((r) => r.session);
  }
  await db.query(`UPDATE browser_sessions SET control = ?, control_owner = ?, paused = ?,
     task = COALESCE(?, task), version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE id = ?`,
  [c.control, c.control_owner, c.paused ? 1 : 0, c.task == null ? null : c.task, cur.row.id]);
  return load(userId, deviceRef);
}

const remove = (userId, deviceRef) => db.query('DELETE FROM browser_sessions WHERE user_id = ? AND device_ref = ?',
  [userId, deviceRef]);

/** list(userId) -> every session of the user with its device, active tab and tab count (newest first). */
function list(userId) {
  return db.query(
    `SELECT d.device_id, d.app, d.app_version, d.last_seen_at, s.control, s.updated_at,
            (SELECT COUNT(*) FROM browser_tabs t WHERE t.session_id = s.id) AS tab_count,
            a.url AS active_url, a.title AS active_title
       FROM browser_sessions s JOIN browser_devices d ON d.id = s.device_ref
       LEFT JOIN browser_tabs a ON a.session_id = s.id AND a.tab_id = s.active_tab_id
      WHERE s.user_id = ? ORDER BY s.updated_at DESC LIMIT 50`, [userId]);
}

// Idle sessions (30 days) are deleted; runs at most once an hour per worker.
let lastPrune = 0;
async function prune(now = Date.now()) {
  if (now - lastPrune < 60 * 60 * 1000) return false;
  lastPrune = now;
  await db.query('DELETE FROM browser_sessions WHERE updated_at < UTC_TIMESTAMP(3) - INTERVAL ? DAY', [IDLE_DAYS]);
  return true;
}

/* ---------- History (opt-in web clients only) ---------- */
const like = (s) => '%' + String(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';

function listHistory(userId, { q = '', limit = 500 } = {}) {
  const n = Math.max(1, Math.min(1000, Number(limit) || 500));
  const where = q ? ' AND (url LIKE ? OR title LIKE ?)' : '';
  return db.query(`SELECT id, url, title, visited_at FROM browser_history WHERE user_id = ?${where}
     ORDER BY visited_at DESC, id DESC LIMIT ?`, q ? [userId, like(q), like(q), n] : [userId, n]);
}

async function addHistory(userId, { url, title, deviceRef = null }) {
  const r = await db.query(`INSERT INTO browser_history (user_id, device_ref, url, title, visited_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`, [userId, deviceRef, url, title]);
  // Keep the newest 2000 per user, like the device store (a cheap check on roughly one insert in 20).
  if (Number(r.insertId) % 20 === 0) {
    await db.query(`DELETE FROM browser_history WHERE user_id = ? AND id < (SELECT id FROM (SELECT id FROM
       browser_history WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?) AS keep_from)`,
    [userId, userId, HISTORY_KEEP - 1]).catch(() => {});
  }
  return { id: r.insertId, url, title, visited_at: new Date().toISOString() };
}

const removeHistory = (userId, id) => db.query('DELETE FROM browser_history WHERE user_id = ? AND id = ?',
  [userId, id]);
const clearHistory = (userId) => db.query('DELETE FROM browser_history WHERE user_id = ?', [userId]);

module.exports = { tx, touchDevice, findDevice, load, save, setControl, remove, list, prune, ownerOf,
  listHistory, addHistory, removeHistory, clearHistory, IDLE_DAYS, _resetPrune: () => { lastPrune = 0; } };
