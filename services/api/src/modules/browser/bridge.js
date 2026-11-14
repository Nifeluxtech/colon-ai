// Session manager on the WebSocket bridge (Phase 8; docs/phase8-backend-contract.md §2, docs/android-bridge.md).
// One bridge per socket: answers `hello` (with `app`) with `session: 1`, stores `session_sync` (one write per 2 s,
// latest wins; private tabs, long URLs and extra tabs dropped; frames over 64 KB refused), asks for the session on
// demand (`session_request`) and keeps the control-owner rules (control.js). Every control change is audited.
// Phase 9: command(), waitControl(), hello `capabilities` (supports()). Phase 10: sessions and control per device AND
// conversation, `other_chat`, `handoff`, the latest `page_state` in memory. 0.10.2: `say` and notice() (frames.js).
// 0.10.3: the user's hand-back message (control `note`, takeNote()) and the handoff's `timeout_ms`.
// 0.10.4: hello `resumable` (the phone still holds a Saga task the user can give back: consent stands on the new
// socket), `state.closed`, and the registry of connected phones in live.js (onConnect for Saga's re-attach).
const store = require('./store');
const S = require('./session');
const C = require('./control');
const F = require('./frames');
const live = require('./live');

const MAX_FRAME = 64 * 1024;
const PHONE_APPS = ['colonai', 'colonbrowser'];
const LOW_RAM_TABS = 10;

/**
 * createBridge({ send(obj), user, req, audit, throttleMs = 2000, ackTimeoutMs = 20000, now })
 *   -> { handle(raw), requestSession(), command(name, args, tabId, o), askControl(mode, task), waitControl(ms),
 *        hasControl(), supports(name), handoff(info, o), notice(text, kind, o), close(), state } */
function createBridge(o) {
  const send = (m) => { try { o.send({ ...m, ts: Date.now() }); } catch { /* socket gone */ } };
  const user = o.user || null;
  const now = o.now || Date.now;
  const throttleMs = o.throttleMs == null ? 2000 : o.throttleMs;
  const ackTimeoutMs = o.ackTimeoutMs || 20000;
  const audit = o.audit || (async () => {});
  const st = { ref: null, deviceId: null, app: null, maxTabs: S.MAX_TABS, consented: false, lastSync: 0,
    queued: null, timer: null, pending: new Map(), seq: 0, writing: Promise.resolve(), capabilities: [],
    watchers: new Set(), seen: 0, conv: '', page: null, note: '', closed: false };
  const api = { handle, requestSession, command, askControl, waitControl, hasControl, supports, close, handoff,
    notice, pageState: () => st.page, takeNote, state: st, user };
  const sk = () => ({ ref: st.ref, conv: st.conv });

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
    st.capabilities = Array.isArray(m.capabilities) ? m.capabilities.filter((c) => typeof c === 'string'
      && c.length <= 40).slice(0, 40) : [];
    st.seen = now();
    st.conv = store.convId(m.conversation_id);
    st.ref = await store.touchDevice(user.id, deviceId, st.app, m.app_version);
    const cur = await store.load(user.id, sk());
    const said = S.CONTROLS.includes(m.control) ? m.control : 'manual';
    if (cur && cur.row.control !== 'manual' && (said === 'manual' || said !== cur.row.control)) {
      // The phone is back in manual (or in another mode we never saw consent for): the user wins.
      await record('hello', (await store.setControl(user.id, sk(), { control: 'manual', control_owner: 'user',
        paused: false })).row);
    } else if (cur && said !== 'manual' && cur.row.control === said) st.consented = true;
    // 0.10.4: the user took the browser (or Saga asked for them) before the socket dropped: their Give back on this
    // socket resumes the same task, so the consent they gave stands here too.
    if (said === 'manual' && C.MODES.includes(m.resumable)) st.consented = true;
    send({ type: 'hello', service: 'colon-ai', bridge: 1, session: 1 });
    live.add(user.id, api);
    store.prune().catch(() => {});
  }

  // Writes one device snapshot. The frame can't raise control (that needs consent): its control and paused only
  // count when they are more restrictive than what is stored.
  async function write(m) {
    const state = S.normalize(m, { from: 'device', maxTabs: st.maxTabs });
    const cur = await store.load(user.id, sk());
    const stored = cur ? cur.row : { control: 'manual', paused: 0, task: '' };
    state.control = m.control === 'manual' ? 'manual' : stored.control;
    state.paused = Boolean(stored.paused) || Boolean(m.paused);
    state.task = state.control === 'manual' ? '' : stored.task || '';
    const r = await store.save(user.id, sk(), state, { control_owner: store.ownerOf(state.control) });
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

  async function onSync(m) {
    if (!st.ref) return error('no_hello', 'Send hello first.');
    if (m.conversation_id !== undefined && store.convId(m.conversation_id) !== st.conv) {
      await flush();                               // the old chat's snapshot is written under the old chat
      switchChat(m.conversation_id);
    }
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
    const cur = await store.load(user.id, sk());
    const d = C.next(m.reason, cur ? cur.row : null, { mode: m.mode, consented: st.consented });
    if (d.error === 'needs_consent') return error('needs_consent', 'Saga needs the user\'s consent first.');
    if (d.error) return error('bad_control', 'Unknown control reason.');
    st.consented = d.consented;
    // 0.10.3: the user's words when they give the browser back ("I've logged in, continue"), for Saga's next step.
    if (m.reason === 'return_to_ai') st.note = F.note(m.note);
    st.lastReason = m.reason;                    // 0.10.4: for a Saga task that re-attaches to this socket
    if (d.cancel) cancelPending();
    const after = d.next ? await store.setControl(user.id, sk(), d.next) : cur;
    await record(m.reason, after && after.row);
    for (const w of [...st.watchers]) w(m.reason);
  }

  // The phone's panel now shows another chat (Phase 10): its own session; Saga must ask that chat for consent.
  function switchChat(conv) {
    const next = store.convId(conv);
    if (next === st.conv) return;
    cancelPending();
    st.conv = next; st.consented = false; st.page = null;
    for (const w of [...st.watchers]) w('other_chat');
  }

  // Saga's view of the page while it has control (memory only; manual browsing is never reported by the phone).
  function onPageState(m) {
    if (!st.ref) return undefined;
    if (m.conversation_id !== undefined && store.convId(m.conversation_id) !== st.conv) return undefined;
    st.page = { url: S.okUrl(m.url) || '', title: String(m.title || '').slice(0, 200), tab_id: String(m.tab_id || '')
      .slice(0, 40), at: now() };
    return undefined;
  }

  /** 0.10.3: the user's hand-back message (frames.note: secrets hidden), once; '' when there was none. */
  function takeNote() { const n = st.note; st.note = ''; return n; }

  /** Resolves with the phone's next control reason (consent, declined, stop, ...) or 'timeout' / 'disconnected'. */
  function waitControl(ms = 120000) {
    return new Promise((resolve) => {
      const done = (reason) => { clearTimeout(timer); st.watchers.delete(done); resolve(reason); };
      const timer = setTimeout(() => done('timeout'), ms);
      st.watchers.add(done);
    });
  }

  /** True while the stored session gives Saga AI/Shared control, not paused, after consent on this socket. */
  async function hasControl() {
    if (!user || !st.ref || !st.consented) return false;
    const c = await currentControl();
    return c.control !== 'manual' && c.control_owner === 'saga' && !c.paused;
  }

  /** Phase 10: is the phone's panel on this conversation now? ('' = any: a task without a conversation). */
  function onChat(conv) {
    return !conv || store.convId(conv) === st.conv;
  }

  function supports(name) { return st.capabilities.includes(name); }

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

  function pend(kind, frame, timeoutMs = ackTimeoutMs) {
    const id = `${kind[0]}${++st.seq}-${now().toString(36)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { st.pending.delete(id); resolve({ ok: false, error: 'timeout', ref: id }); },
        timeoutMs);
      st.pending.set(id, { kind, resolve, timer });
      send({ ...frame, id });
    });
  }

  /** Asks the phone for its session now; resolves { ok, result: { tabs, active_tab_id, control, paused } }. */
  function requestSession() {
    if (!user || !st.ref) return Promise.resolve({ ok: false, error: 'not_ready' });
    return pend('session', { type: 'session_request' });
  }

  /** A Saga command (Phase 9); refused at once unless Saga has AI/Shared control and is not paused. o.timeoutMs:
   *  how long to wait for the ack (longer when the phone must ask the user to approve). Resolves with the ack. */
  async function command(name, args = {}, tabId, o = {}) {
    if (!user || !st.ref) return { ok: false, error: 'not_ready' };
    if (st.closed) return { ok: false, error: 'disconnected' };
    if (!onChat(o.conversation)) return { ok: false, error: 'other_chat' };
    const cur = await store.load(user.id, sk());
    if (!cur || cur.row.control === 'manual' || cur.row.control_owner !== 'saga') return { ok: false,
      error: 'manual_control' };
    if (cur.row.paused) return { ok: false, error: 'paused' };
    return pend('command', { type: 'command', name, args, ...(tabId ? { tab_id: tabId } : {}),
      ...(o.conversation ? { conversation_id: store.convId(o.conversation) } : {}), ...F.say(o.say) },
    o.timeoutMs || ackTimeoutMs);
  }

  /** 0.10.2: a line for the user on the phone's page (frames.notice), e.g. that Saga finished; not another chat's. */
  function notice(text, kind, o = {}) {
    const f = user && st.ref && onChat(o.conversation) && F.notice(text, kind, store.convId(o.conversation || ''));
    return f ? (send(f), true) : false;
  }

  /** Phase 10: Saga hands the page to the user for a secret field (password, code, card, PIN, sign-in, payment).
   *  The phone switches to Manual, shows the prompt and answers control `handoff`; Return to AI resumes. */
  function handoff(info = {}, o = {}) {
    if (!user || !st.ref || !onChat(o.conversation)) return false;
    cancelPending();
    send({ type: 'handoff', kind: String(info.kind || 'secret').slice(0, 20), message: String(info.message || '')
      .slice(0, 200), ...(info.timeoutMs > 0 ? { timeout_ms: Math.round(info.timeoutMs) } : {}),
    ...(o.conversation ? { conversation_id: store.convId(o.conversation) } : {}) });
    return true;
  }

  /** Saga asks for control; nothing changes on the server until the phone answers with consent. */
  async function askControl(mode, task = '', o = {}) {
    if (!user || !st.ref) return false;
    if (!onChat(o.conversation)) return false;
    const t = String(task || '').slice(0, 200);
    if (mode === 'manual') {
      cancelPending();
      await record('saga_release', (await store.setControl(user.id, sk(), { control: 'manual',
        control_owner: 'user', paused: false, task: '' })).row);
    } else if (!S.CONTROLS.includes(mode)) return false;
    else await store.setControl(user.id, sk(), { ...(await currentControl()), task: t });
    send({ type: 'control', mode, task: t, ...(o.conversation ? { conversation_id: store.convId(o.conversation) }
      : {}) });
    return true;
  }

  async function currentControl() {
    const cur = await store.load(user.id, sk());
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
    if (!['session_sync', 'control', 'ack', 'chat', 'page_state'].includes(m.type)) return undefined;
    if (!user) return error('unauthenticated', 'Sign in to sync the browser session.');
    if (m.type === 'session_sync') return onSync(m);
    if (m.type === 'control') return onControl(m);
    if (m.type === 'page_state') return onPageState(m);
    if (m.type === 'chat') {
      if (!st.ref) return error('no_hello', 'Send hello first.');
      await flush();
      return switchChat(m.conversation_id);
    }
    return onAck(m);
  }

  function close() {
    if (st.timer) { clearTimeout(st.timer); flush(); }
    for (const [id, p] of st.pending) {
      clearTimeout(p.timer); p.resolve({ ok: false, error: 'disconnected', ref: id });
    }
    st.pending.clear();
    st.closed = true;
    for (const w of [...st.watchers]) w('disconnected');
    if (user) live.remove(user.id, api);
  }

  return api;
}

module.exports = { createBridge, connected: live.connected, users: live.users, onConnect: live.onConnect, MAX_FRAME };
