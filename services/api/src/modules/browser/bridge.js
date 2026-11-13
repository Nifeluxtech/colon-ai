// Session manager on the WebSocket bridge (Phase 8; docs/phase8-backend-contract.md §2, docs/android-bridge.md).
// One bridge per socket. It answers the phone's `hello` (with `app`) with `session: 1`, stores `session_sync`
// (throttled to one write per 2 s, latest wins; private tabs, long URLs and extra tabs dropped; frames over 64 KB
// refused), asks for the session on demand (`session_request`, answered by `ack`), and keeps the control-owner
// rules: exactly one owner; `ai`/`shared` only after the phone's `control` with reason `consent`; `take_control`,
// `pause`, `stop` or `declined` win at once and cancel pending Saga commands (ack error `manual_control`). Every
// control change goes to the audit log. Only signed-in sockets get any of this.
const store = require('./store');
const S = require('./session');

const MAX_FRAME = 64 * 1024;
const PHONE_APPS = ['colonai', 'colonbrowser'];
const LOW_RAM_TABS = 10;
const live = new Map();                          // user id -> Set of bridges on this worker (for Saga, Phase 9)

/**
 * createBridge({ send(obj), user, req, audit, throttleMs = 2000, ackTimeoutMs = 20000, now })
 *   -> { handle(raw), requestSession(), command(name, args, tabId), askControl(mode, task), close(), state }
 */
function createBridge(o) {
  const send = (m) => { try { o.send({ ...m, ts: Date.now() }); } catch { /* socket gone */ } };
  const user = o.user || null;
  const now = o.now || Date.now;
  const throttleMs = o.throttleMs == null ? 2000 : o.throttleMs;
  const ackTimeoutMs = o.ackTimeoutMs || 20000;
  const audit = o.audit || (async () => {});
  const st = { ref: null, deviceId: null, app: null, maxTabs: S.MAX_TABS, consented: false, lastSync: 0,
    queued: null, timer: null, pending: new Map(), seq: 0, writing: Promise.resolve() };
  const api = { handle, requestSession, command, askControl, close, state: st, user };

  const error = (code, message, extra = {}) => send({ type: 'error', code, message, ...extra });

  function record(reason, row) {
    return audit(o.req || {}, 'browser.control', { actorId: user.id, targetType: 'browser_session',
      targetId: row && row.id, meta: { reason, control: row && row.control, owner: row && row.control_owner,
        paused: Boolean(row && row.paused), app: st.app } }).catch(() => {});
  }

  async function onHello(m) {
    if (!user) return send({ type: 'hello', service: 'colon-ai' });
    let deviceId;
    try { deviceId = S.deviceId(m.device_id); } catch (e) { return error('bad_device', e.message); }
    st.app = PHONE_APPS.includes(m.app) ? m.app : 'colonai';     // apps older than v0.8.1 send no `app`
    st.deviceId = deviceId;
    st.maxTabs = m.low_ram ? LOW_RAM_TABS : S.MAX_TABS;
    st.ref = await store.touchDevice(user.id, deviceId, st.app, m.app_version);
    const cur = await store.load(user.id, st.ref);
    const said = S.CONTROLS.includes(m.control) ? m.control : 'manual';
    if (cur && cur.row.control !== 'manual' && (said === 'manual' || said !== cur.row.control)) {
      // The phone is back in manual (or in another mode we never saw consent for): the user wins.
      await record('hello', (await store.setControl(user.id, st.ref, { control: 'manual', control_owner: 'user',
        paused: false })).row);
    } else if (cur && said !== 'manual' && cur.row.control === said) st.consented = true;
    if (!live.has(user.id)) live.set(user.id, new Set());
    live.get(user.id).add(api);
    send({ type: 'hello', service: 'colon-ai', bridge: 1, session: 1 });
    store.prune().catch(() => {});
  }

  // Writes one device snapshot. The frame can't raise control (that needs consent): its control and paused only
  // count when they are more restrictive than what is stored.
  async function write(m) {
    const state = S.normalize(m, { from: 'device', maxTabs: st.maxTabs });
    const cur = await store.load(user.id, st.ref);
    const stored = cur ? cur.row : { control: 'manual', paused: 0, task: '' };
    state.control = m.control === 'manual' ? 'manual' : stored.control;
    state.paused = Boolean(stored.paused) || Boolean(m.paused);
    state.task = state.control === 'manual' ? '' : stored.task || '';
    const r = await store.save(user.id, st.ref, state, { control_owner: store.ownerOf(state.control) });
    if (stored.control !== 'manual' && state.control === 'manual') {
      cancelPending();
      await record('sync', r.session.row);
    }
    return state;
  }

  function flush() {
    st.timer = null;
    const m = st.queued;
    st.queued = null;
    if (!m) return st.writing;
    st.lastSync = now();
    st.writing = st.writing.then(() => write(m)).catch((e) => error('sync_failed', 'Could not save the session.',
      { detail: e.code || undefined }));
    return st.writing;
  }

  function onSync(m) {
    if (!st.ref) return error('no_hello', 'Send hello first.');
    st.queued = m;                                 // latest wins inside the throttle window
    const wait = st.lastSync + throttleMs - now();
    if (wait <= 0 && !st.timer) return flush();
    if (!st.timer) st.timer = setTimeout(flush, Math.max(0, wait));
    return st.writing;
  }

  function cancelPending() {
    for (const [id, p] of st.pending) {
      if (p.kind !== 'command') continue;
      clearTimeout(p.timer); st.pending.delete(id);
      p.resolve({ type: 'ack', ref: id, ok: false, error: 'manual_control' });
    }
  }

  async function onControl(m) {
    if (!st.ref) return error('no_hello', 'Send hello first.');
    const cur = await store.load(user.id, st.ref);
    const row = cur ? cur.row : { control: 'manual', paused: 0 };
    let next = null;
    const mode = S.CONTROLS.includes(m.mode) && m.mode !== 'manual' ? m.mode : 'ai';
    switch (m.reason) {
      case 'consent': st.consented = true; next = { control: mode, control_owner: 'saga', paused: false }; break;
      case 'return_to_ai':
        if (!st.consented) return error('needs_consent', 'Saga needs the user\'s consent first.');
        next = { control: mode, control_owner: 'saga', paused: false }; break;
      case 'declined': case 'stop':
        st.consented = false; cancelPending();
        next = { control: 'manual', control_owner: 'user', paused: false, task: '' }; break;
      case 'take_control':
        cancelPending(); next = { control: 'manual', control_owner: 'user', paused: Boolean(row.paused) }; break;
      case 'pause':
        cancelPending();
        next = { control: row.control, control_owner: store.ownerOf(row.control), paused: true }; break;
      case 'resume':
        next = { control: row.control, control_owner: store.ownerOf(row.control), paused: false }; break;
      default: return error('bad_control', 'Unknown control reason.');
    }
    const after = await store.setControl(user.id, st.ref, next);
    await record(m.reason, after && after.row);
  }

  function onAck(m) {
    const p = st.pending.get(String(m.ref || ''));
    if (!p) return;
    clearTimeout(p.timer); st.pending.delete(String(m.ref));
    if (p.kind !== 'session') return p.resolve(m);
    if (!m.ok || !m.result) return p.resolve({ ok: false, error: m.error || 'no_session' });
    // Same rules as session_sync: never private tabs, limits applied, control can't be raised by the phone.
    st.writing = st.writing.then(() => write(m.result)).then((state) => p.resolve({ ok: true, result: S.toDevice(
      { active_tab_id: state.active_tab_id, control: state.control, paused: state.paused }, state.tabs) }),
    (e) => p.resolve({ ok: false, error: e.code || 'store_failed' }));
  }

  function pend(kind, frame) {
    const id = `${kind[0]}${++st.seq}-${now().toString(36)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { st.pending.delete(id); resolve({ ok: false, error: 'timeout', ref: id }); },
        ackTimeoutMs);
      st.pending.set(id, { kind, resolve, timer });
      send({ ...frame, id });
    });
  }

  /** Asks the phone for its session now; resolves { ok, result: { tabs, active_tab_id, control, paused } }. */
  function requestSession() {
    if (!user || !st.ref) return Promise.resolve({ ok: false, error: 'not_ready' });
    return pend('session', { type: 'session_request' });
  }

  /** A Saga command (Phase 9 routing); refused at once unless Saga has AI/Shared control and is not paused. */
  async function command(name, args = {}, tabId) {
    if (!user || !st.ref) return { ok: false, error: 'not_ready' };
    const cur = await store.load(user.id, st.ref);
    if (!cur || cur.row.control === 'manual' || cur.row.control_owner !== 'saga') return { ok: false,
      error: 'manual_control' };
    if (cur.row.paused) return { ok: false, error: 'paused' };
    return pend('command', { type: 'command', name, args, ...(tabId ? { tab_id: tabId } : {}) });
  }

  /** Saga asks for control; nothing changes on the server until the phone answers with consent. */
  async function askControl(mode, task = '') {
    if (!user || !st.ref) return false;
    const t = String(task || '').slice(0, 200);
    if (mode === 'manual') {
      cancelPending();
      await record('saga_release', (await store.setControl(user.id, st.ref, { control: 'manual',
        control_owner: 'user', paused: false, task: '' })).row);
    } else if (!S.CONTROLS.includes(mode)) return false;
    else await store.setControl(user.id, st.ref, { ...(await currentControl()), task: t });
    send({ type: 'control', mode, task: t });
    return true;
  }

  async function currentControl() {
    const cur = await store.load(user.id, st.ref);
    const r = cur ? cur.row : { control: 'manual', control_owner: 'user', paused: 0 };
    return { control: r.control, control_owner: r.control_owner, paused: Boolean(r.paused) };
  }

  /** handle(raw frame) -> a promise that settles when the frame is processed. */
  async function handle(raw) {
    const size = typeof raw === 'string' ? Buffer.byteLength(raw) : raw ? raw.length : 0;
    if (size > MAX_FRAME) return error('frame_too_large', 'Frames are limited to 64 KB.');
    let m;
    try { m = JSON.parse(raw); } catch { return undefined; }
    if (!m || typeof m !== 'object') return undefined;
    if (m.type === 'ping') return send({ type: 'pong' });
    if (m.type === 'hello') return onHello(m);
    if (!['session_sync', 'control', 'ack'].includes(m.type)) return undefined;
    if (!user) return error('unauthenticated', 'Sign in to sync the browser session.');
    if (m.type === 'session_sync') return onSync(m);
    if (m.type === 'control') return onControl(m);
    return onAck(m);
  }

  function close() {
    if (st.timer) { clearTimeout(st.timer); flush(); }
    for (const [id, p] of st.pending) {
      clearTimeout(p.timer); p.resolve({ ok: false, error: 'disconnected', ref: id });
    }
    st.pending.clear();
    const mine = user && live.get(user.id);
    if (mine) { mine.delete(api); if (!mine.size) live.delete(user.id); }
  }

  return api;
}

/** connected(userId) -> this worker's bridges for that user (Saga picks a phone from these in Phase 9). */
const connected = (userId) => [...(live.get(userId) || [])].filter((b) => b.state.ref);

module.exports = { createBridge, connected, MAX_FRAME };
