// Crash Predictor step 4 (v0.36.0): running the analysis engine for one user, with a small per-user cache.
//   analyzer({ store, clock }) -> { run(userId, game, target, { limit }) -> analysis, clear() }
// The cache key is the user's round count and newest round id plus the target and limit, so a new round, an import
// or a changed target recomputes at once; entries also expire after TTL_MS. At most MAX_ENTRIES users are kept.
const E = require('./engine');

const MAX_ROUNDS = 5000;
const DEFAULT_ROUNDS = 5000;
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

const limitOf = (v) => Math.max(100, Math.min(MAX_ROUNDS, Math.round(Number(v) || DEFAULT_ROUNDS)));

function analyzer({ store, clock = () => new Date() }) {
  const cache = new Map();
  async function run(userId, game, target, { limit } = {}) {
    const lim = limitOf(limit);
    const meta = await store.roundsMeta(userId, game);
    const key = [meta.n, meta.max_id, Number(target), lim].join(':');
    const slot = `${userId}:${game}:${lim}`;
    const now = clock().getTime();
    const hit = cache.get(slot);
    if (hit && hit.key === key && now - hit.at < TTL_MS) return hit.value;
    const rows = meta.n ? await store.recentMultipliers(userId, game, lim) : [];
    const xs = rows.map((r) => Number(r.multiplier)).reverse(); // oldest first
    const value = { limit: lim, analysed: xs.length, total_rounds: meta.n, ...E.analyse(xs, target) };
    cache.delete(slot);
    cache.set(slot, { key, at: now, value });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    return value;
  }
  return { run, clear: () => cache.clear() };
}

module.exports = { analyzer, limitOf, MAX_ROUNDS, TTL_MS };
