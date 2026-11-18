// Billing persistence: every SQL statement the credit engine runs, in one place.
// sqlStore(db) talks to MySQL (db.transaction from src/db); memoryStore() is the same interface in memory for
// tests. All wallet and usage changes run inside store.tx(fn), with the wallet row locked (SELECT … FOR UPDATE).

function sqlStore(db = require('../../db')) {
  const repo = (q) => ({
    async plans() {
      const plans = await q.query('SELECT code, name, price_minor, currency, active, sort FROM plans ORDER BY sort');
      const ents = await q.query('SELECT plan_code, feature, enabled, limit_value FROM plan_entitlements');
      return { plans, entitlements: ents };
    },
    async subscription(userId) {
      return q.one(`SELECT plan_code, status, period_end FROM subscriptions WHERE user_id = ? AND status = 'active'
        AND (period_end IS NULL OR period_end > UTC_TIMESTAMP())`, [userId]);
    },
    async lockWallet(userId) {
      return q.one('SELECT user_id, balance, period, plan_code FROM credit_wallets WHERE user_id = ? FOR UPDATE',
        [userId]);
    },
    async wallet(userId) {
      return q.one('SELECT user_id, balance, period, plan_code FROM credit_wallets WHERE user_id = ?', [userId]);
    },
    async saveWallet(w) {
      await q.query(`INSERT INTO credit_wallets (user_id, balance, period, plan_code) VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE balance = VALUES(balance), period = VALUES(period), plan_code = VALUES(plan_code)`,
      [w.user_id, w.balance, w.period, w.plan_code]);
    },
    async addLedger(e) {
      await q.query(`INSERT INTO credit_ledger (ref, user_id, amount, balance_after, kind, period, description,
        created_by) VALUES (?,?,?,?,?,?,?,?)`, [e.ref, e.user_id, e.amount, e.balance_after, e.kind, e.period,
        (e.description || '').slice(0, 255), e.created_by || null]);
    },
    async ledger(userId, limit) {
      return q.query(`SELECT ref, amount, balance_after, kind, period, description, created_at FROM credit_ledger
        WHERE user_id = ? ORDER BY id DESC LIMIT ?`, [userId, limit]);
    },
    async usage(requestId, lock) {
      return q.one(`SELECT * FROM usage_events WHERE request_id = ?${lock ? ' FOR UPDATE' : ''}`, [requestId]);
    },
    async addUsage(u) {
      await q.query(`INSERT INTO usage_events (request_id, user_id, feature, mode, plan_code, credits_reserved,
        status, enforced) VALUES (?,?,?,?,?,?,?,?)`, [u.request_id, u.user_id, u.feature, u.mode || '', u.plan_code,
        u.credits_reserved, 'reserved', u.enforced ? 1 : 0]);
    },
    async updateUsage(requestId, f) {
      await q.query(`UPDATE usage_events SET status = ?, credits_charged = ?, provider = ?, model = ?,
        input_tokens = ?, output_tokens = ?, settled_at = CURRENT_TIMESTAMP(3) WHERE request_id = ?`,
      [f.status, f.credits_charged, f.provider || '', f.model || '', f.input_tokens || 0, f.output_tokens || 0,
        requestId]);
    },
    async saveSubscription(x) {
      await q.query(`INSERT INTO subscriptions (user_id, plan_code, status, period_start, period_end, provider,
        provider_ref) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE plan_code = VALUES(plan_code),
        status = VALUES(status), period_start = VALUES(period_start), period_end = VALUES(period_end),
        provider = VALUES(provider), provider_ref = VALUES(provider_ref)`,
      [x.user_id, x.plan_code, x.status, x.period_start, x.period_end, x.provider, x.provider_ref]);
    },
    async ledgerRef(ref) { return q.one('SELECT ref, amount, balance_after FROM credit_ledger WHERE ref = ?', [ref]); },
    // 0.16.0 (chat.reconcile job): reservations still open long after their reply should have ended.
    async staleReservations(before, prefix, limit) {
      return q.query(`SELECT request_id, user_id, feature, credits_reserved FROM usage_events WHERE status = 'reserved'
        AND created_at < ? AND request_id LIKE ? ORDER BY id LIMIT ?`, [before, `${prefix}%`, limit]);
    },
    async monthCount(userId, feature, period) {
      const r = await q.one(`SELECT COUNT(*) AS n FROM usage_events WHERE user_id = ? AND feature = ?
        AND status <> 'refunded' AND created_at >= ? AND created_at < ?`, [userId, feature, ...monthRange(period)]);
      return r ? Number(r.n) : 0;
    },
  });
  return { ...repo(db), tx: (fn) => db.transaction((t) => fn(repo(t))) };
}

// '2026-11' -> ['2026-11-01 00:00:00', '2026-12-01 00:00:00'] (UTC; the pool runs with timezone 'Z').
function monthRange(period) {
  const [y, m] = period.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  return [`${period}-01 00:00:00`, `${next}-01 00:00:00`];
}

// Same interface, in memory. tx() snapshots and restores on throw, like a rollback.
function memoryStore(seed = {}) {
  const s = {
    plans: seed.plans || [], entitlements: seed.entitlements || [], subs: new Map(Object.entries(seed.subs || {})),
    wallets: new Map(), ledger: [], usage: new Map(),
  };
  const api = {
    _s: s,
    async plans() { return { plans: s.plans, entitlements: s.entitlements }; },
    async subscription(userId) {
      const x = s.subs.get(String(userId));
      return x && (!x.status || x.status === 'active') && (!x.period_end || new Date(x.period_end) > new Date())
        ? x : null;
    },
    async lockWallet(userId) { const w = s.wallets.get(String(userId)); return w ? { ...w } : null; },
    async wallet(userId) { return api.lockWallet(userId); },
    async saveWallet(w) { s.wallets.set(String(w.user_id), { ...w }); },
    async addLedger(e) {
      if (s.ledger.some((x) => x.ref === e.ref)) throw Object.assign(new Error('dup ref'), { code: 'ER_DUP_ENTRY' });
      s.ledger.push({ ...e, created_at: new Date() });
    },
    async ledger(userId, limit) { return s.ledger.filter((e) => String(e.user_id) === String(userId)).reverse()
      .slice(0, limit); },
    async usage(requestId) { const u = s.usage.get(requestId); return u ? { ...u } : null; },
    async addUsage(u) {
      if (s.usage.has(u.request_id)) throw Object.assign(new Error('dup request'), { code: 'ER_DUP_ENTRY' });
      s.usage.set(u.request_id, { ...u, status: 'reserved', credits_charged: 0, created_at: new Date() });
    },
    async updateUsage(requestId, f) { s.usage.set(requestId, { ...s.usage.get(requestId), ...f }); },
    async saveSubscription(x) { s.subs.set(String(x.user_id), { ...x }); },
    async ledgerRef(ref) { return s.ledger.find((e) => e.ref === ref) || null; },
    async staleReservations(before, prefix, limit) {
      return [...s.usage.values()].filter((u) => u.status === 'reserved' && u.created_at < before
        && String(u.request_id).startsWith(prefix)).slice(0, limit).map((u) => ({ ...u }));
    },
    async monthCount(userId, feature) {
      return [...s.usage.values()].filter((u) => String(u.user_id) === String(userId) && u.feature === feature
        && u.status !== 'refunded').length;
    },
    async tx(fn) {
      const snap = { w: new Map([...s.wallets].map(([k, v]) => [k, { ...v }])), l: [...s.ledger],
        u: new Map([...s.usage].map(([k, v]) => [k, { ...v }])), s: new Map(s.subs) };
      try { return await fn(api); } catch (e) {
        s.wallets = snap.w; s.ledger = snap.l; s.usage = snap.u; s.subs = snap.s; throw e;
      }
    },
  };
  return api;
}

module.exports = { sqlStore, memoryStore, monthRange };
