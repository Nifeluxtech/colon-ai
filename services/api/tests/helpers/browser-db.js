// An in-memory stand-in for src/db with just the SQL the browser module (and the rate limiter, audit log) sends.
// Install it before requiring anything under src/:  const fake = require('../helpers/browser-db').install();
// Statements it doesn't know throw, so a new query can't silently pass a test.
const path = require('path');

function create() {
  const t = { devices: [], sessions: [], tabs: [], history: [], rates: new Map(), audit: [] };
  const ids = { devices: 0, sessions: 0, tabs: 0, history: 0 };
  const calls = [];
  const sess = (id) => t.sessions.find((s) => s.id === id);

  async function query(sql, p = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    calls.push(s);
    if (/^INSERT INTO rate_limits/.test(s)) { t.rates.set(p[0], (t.rates.get(p[0]) || 0) + 1); return {}; }
    if (/^SELECT hits FROM rate_limits/.test(s)) return [{ hits: t.rates.get(p[0]) || 0 }];
    if (/^INSERT INTO audit_log/.test(s)) { t.audit.push({ action: p[1], target: p[3], meta: JSON.parse(p[5]
      || 'null') }); return {}; }
    if (/^INSERT INTO browser_devices/.test(s)) {
      let d = t.devices.find((x) => x.user_id === p[0] && x.device_id === p[1] && x.app === p[2]);
      if (!d) { d = { id: ++ids.devices, user_id: p[0], device_id: p[1], app: p[2], app_version: p[3] };
        t.devices.push(d); } else if (p[3]) d.app_version = p[3];
      d.last_seen_at = new Date();
      return { insertId: d.id };
    }
    if (/^SELECT id FROM browser_devices/.test(s)) {
      return t.devices.filter((x) => x.user_id === p[0] && x.device_id === p[1] && x.app === p[2]).map((x) => ({
        id: x.id }));
    }
    if (/FROM browser_sessions WHERE user_id = \? AND device_ref = \? AND conversation_id = \?/.test(s)
      && /^SELECT/.test(s)) {
      return t.sessions.filter((x) => x.user_id === p[0] && x.device_ref === p[1] && x.conversation_id === p[2])
        .map((x) => ({ ...x }));
    }
    if (/^SELECT tab_id, url, title, position, nav FROM browser_tabs/.test(s)) {
      return t.tabs.filter((x) => x.session_id === p[0]).sort((a, b) => a.position - b.position).map((x) => ({ ...x }));
    }
    if (/^UPDATE browser_sessions SET active_tab_id/.test(s)) {
      Object.assign(sess(p[5]), { active_tab_id: p[0], control: p[1], control_owner: p[2], paused: p[3], task: p[4],
        updated_at: new Date() });
      sess(p[5]).version++;
      return { affectedRows: 1 };
    }
    if (/^UPDATE browser_sessions SET control = \?/.test(s)) {
      const x = sess(p[4]);
      Object.assign(x, { control: p[0], control_owner: p[1], paused: p[2], updated_at: new Date() });
      if (p[3] != null) x.task = p[3];
      x.version++;
      return { affectedRows: 1 };
    }
    if (/^INSERT INTO browser_sessions/.test(s)) {
      if (t.sessions.some((x) => x.device_ref === p[1] && x.conversation_id === p[2])) {
        throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      }
      const row = { id: ++ids.sessions, user_id: p[0], device_ref: p[1], conversation_id: p[2], active_tab_id: p[3],
        control: p[4], control_owner: p[5], paused: p[6], task: p[7], version: 1, updated_at: new Date() };
      t.sessions.push(row);
      return { insertId: row.id };
    }
    if (/^DELETE FROM browser_tabs WHERE session_id/.test(s)) {
      t.tabs = t.tabs.filter((x) => x.session_id !== p[0]); return {};
    }
    if (/^INSERT INTO browser_tabs/.test(s)) {
      for (const r of p[0]) t.tabs.push({ id: ++ids.tabs, session_id: r[0], tab_id: r[1], url: r[2], title: r[3],
        position: r[4], nav: r[5], updated_at: r[6] });
      return {};
    }
    if (/^DELETE FROM browser_sessions WHERE user_id = \? AND conversation_id <> ''/.test(s)) {
      const gone = t.sessions.filter((x) => x.user_id === p[0] && x.conversation_id !== '').map((x) => x.id);
      t.sessions = t.sessions.filter((x) => !gone.includes(x.id));
      t.tabs = t.tabs.filter((x) => !gone.includes(x.session_id));
      return { affectedRows: gone.length };
    }
    if (/^DELETE FROM browser_sessions WHERE user_id = \? AND conversation_id = \?/.test(s)) {
      const gone = t.sessions.filter((x) => x.user_id === p[0] && x.conversation_id === p[1]).map((x) => x.id);
      t.sessions = t.sessions.filter((x) => !gone.includes(x.id));
      t.tabs = t.tabs.filter((x) => !gone.includes(x.session_id));
      return { affectedRows: gone.length };
    }
    if (/^DELETE FROM browser_sessions WHERE user_id/.test(s)) {
      const gone = t.sessions.filter((x) => x.user_id === p[0] && x.device_ref === p[1]
        && x.conversation_id === p[2]).map((x) => x.id);
      t.sessions = t.sessions.filter((x) => !gone.includes(x.id));
      t.tabs = t.tabs.filter((x) => !gone.includes(x.session_id));
      return {};
    }
    if (/^DELETE FROM browser_sessions WHERE updated_at/.test(s)) return {};
    if (/^SELECT d\.device_id/.test(s)) {
      return t.sessions.filter((x) => x.user_id === p[0]).map((x) => {
        const d = t.devices.find((y) => y.id === x.device_ref);
        const tabs = t.tabs.filter((y) => y.session_id === x.id);
        const a = tabs.find((y) => y.tab_id === x.active_tab_id);
        return { device_id: d.device_id, app: d.app, app_version: d.app_version, last_seen_at: d.last_seen_at,
          conversation_id: x.conversation_id, control: x.control, updated_at: x.updated_at, tab_count: tabs.length,
          active_url: a ? a.url : null, active_title: a ? a.title : null };
      });
    }
    if (/^INSERT INTO browser_history/.test(s)) {
      const row = { id: ++ids.history, user_id: p[0], device_ref: p[1], url: p[2], title: p[3],
        visited_at: new Date(Date.now() + ids.history) };
      t.history.push(row);
      return { insertId: row.id };
    }
    if (/^SELECT id, url, title, visited_at FROM browser_history/.test(s)) {
      const like = p.length > 2 ? String(p[1]).slice(1, -1).toLowerCase() : '';
      return t.history.filter((x) => x.user_id === p[0] && (!like || (x.url + ' ' + x.title).toLowerCase()
        .includes(like))).sort((a, b) => b.visited_at - a.visited_at).slice(0, p[p.length - 1]);
    }
    if (/^DELETE FROM browser_history WHERE user_id = \? AND id = \?/.test(s)) {
      t.history = t.history.filter((x) => !(x.user_id === p[0] && x.id === p[1])); return {};
    }
    if (/^DELETE FROM browser_history WHERE user_id = \? AND id </.test(s)) return {};
    if (/^DELETE FROM browser_history WHERE user_id = \?$/.test(s)) {
      t.history = t.history.filter((x) => x.user_id !== p[0]); return {};
    }
    throw new Error('fake db: unexpected SQL: ' + s.slice(0, 120));
  }
  return { query, one: async (sql, p) => (await query(sql, p))[0] || null, tables: t, calls };
}

// Puts a fresh fake in require.cache for src/db (call before requiring modules that use the database).
function install() {
  const fake = create();
  const dbPath = require.resolve('../../src/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake, paths: [path.dirname(
    dbPath)] };
  return fake;
}

module.exports = { create, install };
