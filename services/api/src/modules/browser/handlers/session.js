// /browser/session and /browser/sessions: the web clients' side of the session manager (RemoteBrowserData;
// contract §2). One session per user and device; the web device is ?device_id= (a random id the web app keeps in
// localStorage) and the app is web-browser or web-chat (from ?app= or X-Colon-Client). Older web builds that send
// no device_id share one "web" device per app. PUT checks `version` (optimistic concurrency): a stale one gets
// 409 conflict with the current session so the client can merge and retry.
// Phase 10: ?conversation_id= (or body.conversation_id) selects that chat's own session on the device (the in-chat
// browser keeps one browser per conversation); without it the device-wide session is used, as before.
const store = require('../store');
const S = require('../session');

const WEB_DEFAULT = 'web';

function device(req) {
  const raw = (req.query && req.query.get('device_id')) || (req.body && req.body.device_id) || WEB_DEFAULT;
  const conv = (req.query && req.query.get('conversation_id')) || (req.body && req.body.conversation_id) || '';
  if (conv && store.convId(conv) !== String(conv)) {
    throw Object.assign(new Error('conversation_id is letters, digits, _ or - (up to 64).'), { status: 400,
      code: 'bad_conversation' });
  }
  return { deviceId: S.deviceId(raw), app: S.webApp(req), conv: String(conv) };
}
const keyOf = (ref, d) => ({ ref, conv: d.conv });

async function getSession(req) {
  const d = device(req);
  const ref = await store.findDevice(req.user.id, d.deviceId, d.app);
  const cur = ref ? await store.load(req.user.id, keyOf(ref, d)) : null;
  if (ref) await store.touchDevice(req.user.id, d.deviceId, d.app);
  return [200, { session: cur ? S.toClient(cur.row, cur.tabs) : null }];
}

async function putSession(req) {
  const body = req.body || {};
  if (!body.session || typeof body.session !== 'object' || Array.isArray(body.session)) {
    throw Object.assign(new Error('Send { session, version }.'), { status: 400, code: 'bad_session' });
  }
  const d = device(req);
  const version = body.version != null ? body.version : body.session.version;
  if (version != null && !(Number.isInteger(Number(version)) && Number(version) >= 0)) {
    throw Object.assign(new Error('version must be a whole number.'), { status: 400, code: 'bad_version' });
  }
  const state = S.normalize(body.session, { from: 'rest' });
  const ref = await store.touchDevice(req.user.id, d.deviceId, d.app, String(req.headers['x-colon-version'] || ''));
  const r = await store.save(req.user.id, keyOf(ref, d), state, { version });
  store.prune().catch(() => {});
  const session = r.session ? S.toClient(r.session.row, r.session.tabs) : null;
  if (r.conflict) {
    throw Object.assign(new Error('This session changed on another device. Reload it and try again.'),
      { status: 409, code: 'conflict', extra: { session } });
  }
  return [200, { session }];
}

async function deleteSession(req) {
  const d = device(req);
  const ref = await store.findDevice(req.user.id, d.deviceId, d.app);
  if (ref) await store.remove(req.user.id, keyOf(ref, d));
  return [200, { ok: true }];
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

async function listSessions(req) {
  const rows = await store.list(req.user.id);
  return [200, { sessions: rows.map((r) => ({
    device: { device_id: r.device_id, app: r.app, app_version: r.app_version || '', last_seen_at: iso(r.last_seen_at) },
    conversation_id: r.conversation_id || null,
    active: r.active_url ? { url: r.active_url, title: r.active_title || '' } : null,
    tabs: Number(r.tab_count) || 0, control: r.control, updated_at: iso(r.updated_at),
  })) }];
}

module.exports = { getSession, putSession, deleteSession, listSessions };
