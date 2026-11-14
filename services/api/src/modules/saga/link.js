// 0.10.4: a Saga task's link to the user's phone that survives the socket dropping (docs/decisions/0006, addendum).
// On mobile data a socket drops easily (the user switches to a password manager, the network changes, the app is
// backgrounded for a moment). Up to 0.10.3 that ended the task at once ("disconnected"), even while Saga only waited
// for the user to log in. Now the task lets go of its row (store.release) and waits up to SAGA_RECONNECT_GRACE_MS
// for the same user's Colon AI app to connect again: on this worker it re-attaches here (the new bridge takes over);
// on another worker that worker adopts the task (resume.js) and this run ends quietly ('moved').
//   createLink(bridge, { task, worker, graceMs, store, live, pick }) -> {
//     bridge,                 the phone's bridge now
//     reattach() -> bridge | null (moved: true when another worker took the task over),
//     command(name, args, tabId, o) -> ack     a dropped read is sent again; a dropped action answers 'reconnected'
//     waitControl(ms) -> reason                'disconnected' becomes 'reconnected' when the phone came back }
const READS = new Set(['get_page_content', 'get_links', 'get_tabs', 'get_page_state', 'screenshot']);
const LOST = ['disconnected', 'not_ready'];
const POLL_MS = 1000;

function createLink(first, o) {
  const link = { bridge: first, moved: false, lost: false };
    const usable = (b) => b && !b.state.closed && b.state.ref && b.state.app !== 'colonbrowser';

  // A phone of this user that connected after the old socket closed (the same device first).
  function fresh() {
    const list = o.live.connected(o.task.user_id).filter((b) => b !== link.bridge && usable(b));
    const dev = link.bridge && link.bridge.state.deviceId;
    return list.find((b) => b.state.deviceId === dev) || (o.pick ? o.pick(list) : list[0]) || null;
  }

  link.reattach = async function reattach() {
    if (usable(link.bridge)) return link.bridge;
    link.lost = true;
    await o.store.release(o.task.id, o.worker).catch(() => {});
    const until = Date.now() + o.graceMs;
    let got = null, wake = null;
    const off = o.live.onConnect((b) => {
      if (!got && b.user && b.user.id === o.task.user_id && usable(b)) { got = b; if (wake) wake(); }
    });
    try {
      for (;;) {
        const b = got || fresh();
        if (b) {
          // Ours again only if no other worker adopted it meanwhile.
          if (!(await o.store.adopt(o.task.id, o.worker, b.state.ref, new Date(0)))) {
            const h = await o.store.holder(o.task.id).catch(() => null);
            if (h && h !== o.worker) { link.moved = true; return null; }
          }
          link.bridge = b; link.lost = false;
          return b;
        }
        if (Date.now() >= until) return null;
        const h = await o.store.holder(o.task.id).catch(() => null);
        if (h && h !== o.worker) { link.moved = true; return null; }
        await new Promise((r) => { wake = r; setTimeout(r, Math.min(POLL_MS, Math.max(1, until - Date.now()))); });
        wake = null;
      }
    } finally { off(); }
  };

  link.command = async function command(name, args, tabId, opt) {
    const ack = await link.bridge.command(name, args, tabId, opt);
    if (!ack || !LOST.includes(ack.error)) return ack;
    if (!(await link.reattach())) return ack;
    // A read is safe to send again; an action may or may not have run on the phone: Saga looks before going on.
    if (READS.has(name)) return link.bridge.command(name, args, tabId, opt);
    return { ok: false, error: 'reconnected' };
  };

  link.waitControl = async function waitControl(ms) {
    const r = usable(link.bridge) ? await link.bridge.waitControl(ms) : 'disconnected';
    if (r !== 'disconnected') return r;
    const b = await link.reattach();
    // What the user did on the new socket before Saga was back on it (a Give back right after reconnecting).
    return b ? b.state.lastReason || 'reconnected' : 'disconnected';
  };

  return link;
}

module.exports = { createLink, READS };
