// The job store of store.js in memory, for tests (same interface, same semantics). Each method runs to completion
// without awaiting in the middle, so a claim is atomic exactly as the single UPDATE is in MySQL. `shared` lets two
// "processes" (two service instances) use one table, which is how the overlap and restart tests work.
const { LIVE } = require('./store');

function memoryStore(shared) {
  const t = shared || { jobs: [], runs: [], ids: 0 };
  const due = (j, now) => (['queued', 'failed'].includes(j.status) && j.run_at <= now)
    || (j.status === 'running' && j.lease_until < now);
  const copy = (j) => ({ ...j, payload: JSON.stringify(j.payload) });
  return {
    tables: t,
    async insert(j) {
      if (j.key) {
        const old = t.jobs.find((x) => x.idempotency_key === j.key);
        if (old) return { id: old.id, created: false };
      }
      const row = { id: ++t.ids, type: j.type, user_id: j.user_id, payload: j.payload == null ? {} : j.payload,
        status: 'queued', run_at: j.run_at, attempts: 0, max_attempts: j.max_attempts, lease_token: null,
        lease_until: null, last_error: null, idempotency_key: j.key || null, ref: j.ref || null, started_at: null,
        finished_at: null, created_at: j.now, updated_at: j.now };
      t.jobs.push(row);
      return { id: row.id, created: true };
    },
    async claim(o) {
      if (o.users && !o.users.length) return [];
      const rows = t.jobs.filter((j) => due(j, o.now) && (!o.types || !o.types.length || o.types.includes(j.type))
        && (!o.users || o.users.includes(j.user_id)))
        .sort((a, b) => a.run_at - b.run_at || a.id - b.id).slice(0, o.limit);
      for (const j of rows) {
        Object.assign(j, { status: 'running', lease_token: o.token, lease_until: o.leaseUntil,
          attempts: j.attempts + 1, started_at: o.now, updated_at: o.now });
      }
      return rows.map(copy);
    },
    async finish(id, token, s) {
      const j = t.jobs.find((x) => x.id === Number(id));
      if (!j || j.lease_token !== token) return false;
      Object.assign(j, { status: s.status, run_at: s.run_at || j.run_at, last_error: s.error == null ? null
        : String(s.error).slice(0, 500), lease_token: null, lease_until: null, finished_at: s.now, updated_at: s.now,
      attempts: s.giveBack ? Math.max(0, j.attempts - 1) : j.attempts });
      return true;
    },
    async get(id) { const j = t.jobs.find((x) => x.id === Number(id)); return j ? copy(j) : null; },
    async setStatus(id, from, s) {
      const j = t.jobs.find((x) => x.id === Number(id));
      if (!j || !from.includes(j.status)) return false;
      Object.assign(j, { status: s.status, run_at: s.run_at || j.run_at, attempts: s.attempts == null ? j.attempts
        : s.attempts, lease_token: null, lease_until: null, updated_at: s.now });
      return true;
    },
    async cancelRef(ref, keep, now) {
      let n = 0;
      for (const j of t.jobs) {
        if (j.ref === ref && ['queued', 'failed'].includes(j.status) && (!keep || j.idempotency_key !== keep)) {
          Object.assign(j, { status: 'cancelled', lease_token: null, lease_until: null, updated_at: now }); n++;
        }
      }
      return n;
    },
    async liveRefs(refs) {
      return [...new Set(t.jobs.filter((j) => refs.includes(j.ref) && LIVE.includes(j.status)).map((j) => j.ref))];
    },
    async counts(now) {
      const m = new Map();
      for (const j of t.jobs) { const k = `${j.type}\n${j.status}`; m.set(k, (m.get(k) || 0) + 1); }
      return { rows: [...m].map(([k, n]) => ({ type: k.split('\n')[0], status: k.split('\n')[1], n })),
        stale: t.jobs.filter((j) => j.status === 'running' && j.lease_until < now).length };
    },
    async list(o) {
      return t.jobs.filter((j) => (o.status === 'stale' ? j.status === 'running' && j.lease_until < o.now
        : !o.status || j.status === o.status) && (!o.type || j.type === o.type))
        .sort((a, b) => b.id - a.id).slice(0, o.limit).map(copy);
    },
    async prune(before) {
      const n = t.jobs.length, r = t.runs.length;
      t.jobs = t.jobs.filter((j) => !(['done', 'cancelled'].includes(j.status) && j.updated_at < before));
      t.runs = t.runs.filter((x) => x.started_at >= before);
      return { jobs: n - t.jobs.length, runs: r - t.runs.length };
    },
    async recordRun(x) { t.runs.push({ id: t.runs.length + 1, ...x }); },
    async lastRun() { return t.runs.slice().sort((a, b) => b.started_at - a.started_at)[0] || null; },
    async recentRuns(n) { return t.runs.slice().sort((a, b) => b.started_at - a.started_at).slice(0, n); },
    async ready() { return true; },
  };
}

module.exports = { memoryStore };
