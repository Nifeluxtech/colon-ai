// The phones connected to this worker (Phase 9), per user, for Saga. 0.10.4: onConnect() lets a Saga task that
// lost its phone's socket (mobile data drops one easily, e.g. while the user switches to a password manager) pick
// up the same phone's next socket instead of ending (modules/saga/link.js).
const live = new Map();                          // user id -> Set of bridges on this worker
const listeners = new Set();                     // fn(bridge), called after a signed-in bridge's hello

function add(userId, b) {
  if (!live.has(userId)) live.set(userId, new Set());
  live.get(userId).add(b);
  for (const fn of [...listeners]) { try { fn(b); } catch { /* a listener's error is its own */ } }
}

function remove(userId, b) {
  const mine = live.get(userId);
  if (mine) { mine.delete(b); if (!mine.size) live.delete(userId); }
}

/** connected(userId) -> this worker's bridges for that user (after hello, not closed). */
const connected = (userId) => [...(live.get(userId) || [])].filter((b) => b.state.ref && !b.state.closed);

/** users() -> ids of the users with a phone connected to this worker (Saga's queue sweep, Phase 9). */
const users = () => [...live.keys()].filter((id) => connected(id).length);

/** onConnect(fn) -> unsubscribe: fn(bridge) after every hello of a signed-in phone on this worker. */
function onConnect(fn) { listeners.add(fn); return () => listeners.delete(fn); }

module.exports = { add, remove, connected, users, onConnect };
