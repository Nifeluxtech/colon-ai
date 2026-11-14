// The in-memory database of tests/helpers/browser-db.js plus the SQL of Saga's tasks and action log
// (modules/saga/store.js) and the safety settings / events Saga's input check touches.
// Install it before requiring anything under src/:  const fake = require('../helpers/saga-db').install();
const path = require('path');
const browserDb = require('./browser-db');

function create() {
  const base = browserDb.create();
  const t = Object.assign(base.tables, { tasks: [], actions: [], safety: [] });
  let ids = 0;
  const task = (id) => t.tasks.find((x) => x.id === Number(id));

  async function query(sql, p = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/FROM app_settings/.test(s)) return [];
    if (/^INSERT INTO safety_events/.test(s)) { t.safety.push(p); return {}; }
    if (/^INSERT INTO saga_tasks/.test(s)) {
      const row = { id: ++ids, user_id: p[0], goal: p[1], language: p[2], conversation_id: p[3], status: p[4],
        created_at: p[5], updated_at: p[6], steps: 0, stop_requested: 0, error: null, answer: null, sources: null,
        worker: null, device_ref: null, finished_at: null, mode: p[7] || 'ai' };
      t.tasks.push(row);
      return { insertId: row.id };
    }
    if (/^SELECT \* FROM saga_tasks WHERE id = \? AND user_id = \?/.test(s)) {
      const x = task(p[0]); return x && x.user_id === p[1] ? [{ ...x }] : [];
    }
    if (/^SELECT \* FROM saga_tasks WHERE id = \?/.test(s)) { const x = task(p[0]); return x ? [{ ...x }] : []; }
    if (/^UPDATE saga_tasks SET status = 'consent'/.test(s)) {
      const x = task(p[3]);
      if (!x || x.status !== 'queued') return { affectedRows: 0 };
      Object.assign(x, { status: 'consent', worker: p[0], device_ref: p[1], updated_at: p[2] });
      return { affectedRows: 1 };
    }
    if (/^UPDATE saga_tasks SET status = \?, error/.test(s)) {
      Object.assign(task(p[7]), { status: p[0], error: p[1], steps: p[2], answer: p[3], sources: p[4],
        updated_at: p[5], finished_at: p[6] });
      return { affectedRows: 1 };
    }
    if (/^UPDATE saga_tasks SET status = \?, updated_at = \? WHERE id = \? AND status IN/.test(s)) {
      const x = task(p[2]);
      if (x && ['consent', 'running', 'handoff', 'user_control', 'paused'].includes(x.status)) {
        x.status = p[0]; x.updated_at = p[1];
      }
      return {};
    }
    if (/^DELETE FROM saga_tasks WHERE user_id = \? AND conversation_id = \?/.test(s)) {
      const gone = t.tasks.filter((x) => x.user_id === p[0] && x.conversation_id === p[1]).map((x) => x.id);
      t.tasks = t.tasks.filter((x) => !gone.includes(x.id));
      t.actions = t.actions.filter((a) => !gone.includes(a.task_id));
      return { affectedRows: gone.length };
    }
    if (/^UPDATE saga_tasks SET stop_requested = 1/.test(s)) {
      const x = task(p[1]); if (x && x.user_id === p[2]) x.stop_requested = 1; return {};
    }
    if (/^UPDATE saga_tasks SET status = 'stopped'/.test(s)) {
      const x = task(p[1]); if (x && x.user_id === p[2] && x.status === 'queued') x.status = 'stopped'; return {};
    }
    if (/^UPDATE saga_tasks SET status = 'failed', error = 'no_phone'/.test(s)) {
      for (const x of t.tasks) if (x.status === 'queued' && x.created_at < p[1]) Object.assign(x, { status: 'failed',
        error: 'no_phone', finished_at: p[0] });
      return {};
    }
    if (/^SELECT stop_requested FROM saga_tasks/.test(s)) { const x = task(p[0]); return x ? [{ ...x }] : []; }
    if (/^INSERT INTO saga_actions/.test(s)) {
      if (t.actions.some((a) => a.task_id === p[0] && a.seq === p[2])) {
        throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      }
      t.actions.push({ task_id: p[0], user_id: p[1], seq: p[2], kind: p[3], tool: p[4], command: p[5], say: p[6],
        args: p[7], approval: p[8], approved: p[9], ok: p[10], error: p[11], url: p[12], title: p[13], page: p[14],
        ms: p[15], created_at: p[16] });
      return {};
    }
    if (/^SELECT seq, kind, tool, command/.test(s)) {
      return t.actions.filter((a) => a.task_id === p[0] && a.seq > p[1]).sort((a, b) => a.seq - b.seq)
        .map((a) => ({ ...a }));
    }
    if (/^SELECT id, goal, status, error, steps, conversation_id, created_at, finished_at,/.test(s)) {
      const conv = p.length === 3 ? p[1] : null;
      const finish = (id) => t.actions.filter((a) => a.task_id === id && a.kind === 'finish').sort((a, b) => b.seq
        - a.seq)[0];
      return t.tasks.filter((x) => x.user_id === p[0] && (conv === null || x.conversation_id === conv))
        .sort((a, b) => b.id - a.id).slice(0, p[p.length - 1])
        .map((x) => ({ ...x, result: finish(x.id) ? finish(x.id).say : null }));
    }
    if (/^SELECT id, user_id, goal, language, conversation_id, mode FROM saga_tasks WHERE status = 'queued'/.test(s)) {
      return t.tasks.filter((x) => x.status === 'queued' && p[0].includes(x.user_id) && x.created_at > p[1]);
    }
    if (/^SELECT t\.id, t\.user_id, u\.email/.test(s)) {
      const status = p.length === 3 ? p[1] : null;
      return t.tasks.filter((x) => x.id < p[0] && (!status || x.status === status)).sort((a, b) => b.id - a.id)
        .slice(0, p[p.length - 1]).map((x) => ({ ...x, user_email: `u${x.user_id}@example.com` }));
    }
    return base.query(sql, p);
  }
  return { query, one: async (sql, p) => (await query(sql, p))[0] || null, tables: t, calls: base.calls };
}

function install() {
  const fake = create();
  const dbPath = require.resolve('../../src/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake, paths: [path.dirname(
    dbPath)] };
  return fake;
}

module.exports = { create, install };
