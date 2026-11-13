// Browser session shapes (Phase 8, docs/phase8-backend-contract.md §2): what a client may store and what it gets
// back. One place for the rules every path shares (REST from the web, session_sync and session_request from the
// phone): private (incognito) tabs are dropped, URLs over 2048 characters are dropped, at most 30 tabs, tab ids up
// to 40 characters, titles up to 200, task up to 200.

const MAX_TABS = 30;
const MAX_URL = 2048;
const MAX_STACK = 50;                       // back / forward entries kept per tab (web clients)
const CONTROLS = ['manual', 'ai', 'shared'];
const APPS = ['colonai', 'colonbrowser', 'web-chat', 'web-browser'];
const TAB_ID = /^[\w.:-]{1,40}$/;
const DEVICE_ID = /^[\w-]{1,64}$/;

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

// A URL a session may hold: http(s), or the browser's own colon:// and about:blank pages; ≤ 2048 characters.
function okUrl(u) {
  const s = String(u == null ? '' : u);
  return s.length > 0 && s.length <= MAX_URL && /^(https?:\/\/|colon:\/\/|about:blank$)/i.test(s) ? s : null;
}

const cleanTitle = (t) => String(t == null ? '' : t).replace(/[\u0000-\u001f]+/g, ' ').trim()
  .slice(0, 200);
const isPrivate = (t) => Boolean(t && (t.private || t.incognito || t.is_private));

function stack(list) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => okUrl(typeof x === 'string' ? x : x && x.url)).filter(Boolean).slice(-MAX_STACK);
}

/**
 * normalize(raw, { from: 'rest'|'device', maxTabs }) -> { tabs: [{ tab_id, url, title, position, back, fwd }],
 * active_tab_id, control, paused, task }. Web sends { tabs:[{ id, url, title, back, fwd }], active_id }; the
 * phone sends { tabs:[{ tab_id, url, title, active }], active_tab_id }. Both shapes are accepted.
 */
function normalize(raw, o = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const tabs = [];
  const seen = new Set();
  let activeFromFlag = null;
  for (const t of Array.isArray(s.tabs) ? s.tabs : []) {
    if (!t || typeof t !== 'object' || isPrivate(t)) continue;
    const id = String(t.tab_id != null ? t.tab_id : t.id != null ? t.id : '');
    const url = okUrl(t.url);
    if (!TAB_ID.test(id) || !url || seen.has(id)) continue;
    seen.add(id);
    tabs.push({ tab_id: id, url, title: cleanTitle(t.title), position: tabs.length,
      back: o.from === 'device' ? [] : stack(t.back), fwd: o.from === 'device' ? [] : stack(t.fwd) });
    if (t.active && !activeFromFlag) activeFromFlag = id;
    if (tabs.length >= Math.min(MAX_TABS, o.maxTabs || MAX_TABS)) break;
  }
  const wanted = String(s.active_tab_id != null ? s.active_tab_id : s.active_id != null ? s.active_id
    : activeFromFlag || '');
  // A named active tab that was dropped (private, bad URL) leaves no active tab rather than pointing at another one.
  const active = tabs.some((t) => t.tab_id === wanted) ? wanted : (!wanted && tabs[0] ? tabs[0].tab_id : null);
  const control = CONTROLS.includes(s.control) ? s.control : 'manual';
  return { tabs, active_tab_id: active, control, paused: Boolean(s.paused), task: cleanTitle(s.task) };
}

// Stored rows -> the REST shape the web clients use (RemoteBrowserData).
function toClient(row, tabs) {
  if (!row) return null;
  return {
    tabs: tabs.map((t) => ({ id: t.tab_id, url: t.url, title: t.title || '', back: parseStack(t.nav, 'back'),
      fwd: parseStack(t.nav, 'fwd') })),
    active_id: row.active_tab_id || null, conversation_id: row.conversation_id || null, control: row.control,
    control_owner: row.control_owner,
    paused: Boolean(row.paused), task: row.task || '', version: Number(row.version),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

// Stored rows -> the session_sync / session_request result shape (phone side).
function toDevice(row, tabs) {
  return { tabs: tabs.map((t) => ({ tab_id: t.tab_id, url: t.url, title: t.title || '',
    active: t.tab_id === row.active_tab_id })), active_tab_id: row.active_tab_id || null, control: row.control,
  paused: Boolean(row.paused) };
}

function parseStack(nav, key) {
  if (!nav) return [];
  try { const v = typeof nav === 'string' ? JSON.parse(nav) : nav; return stack(v && v[key]); } catch { return []; }
}

function deviceId(v) {
  const s = String(v == null ? '' : v);
  if (!DEVICE_ID.test(s)) throw fail(400, 'bad_device', 'Send a device_id (letters, digits, _ or -, up to 64).');
  return s;
}

// The web app a REST call comes from: an explicit ?app=, else the X-Colon-Client header (browser -> web-browser).
function webApp(req) {
  const asked = String((req.query && req.query.get && req.query.get('app')) || (req.body && req.body.app) || '');
  if (asked === 'web-chat' || asked === 'web-browser') return asked;
  return String(req.headers['x-colon-client'] || '').toLowerCase() === 'browser' ? 'web-browser' : 'web-chat';
}

module.exports = { normalize, toClient, toDevice, okUrl, deviceId, webApp, isPrivate, MAX_TABS, MAX_URL, CONTROLS,
  APPS, TAB_ID };
