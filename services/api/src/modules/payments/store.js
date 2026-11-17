// Payments persistence (payments, payment_events, subscriptions). sqlStore(db) for MySQL, memoryStore() for tests.
function sqlStore(db = require('../../db')) {
  const repo = (q) => ({
    async plan(code) {
      return q.one('SELECT code, name, price_minor, currency, active FROM plans WHERE code = ?', [code]);
    },
    async addPayment(p) {
      await q.query(`INSERT INTO payments (reference, user_id, plan_code, amount_minor, currency, provider, status)
        VALUES (?,?,?,?,?,?, 'pending')`, [p.reference, p.user_id, p.plan_code, p.amount_minor, p.currency,
        p.provider || 'korapay']);
    },
    async payment(reference, lock) {
      return q.one(`SELECT * FROM payments WHERE reference = ?${lock ? ' FOR UPDATE' : ''}`, [reference]);
    },
    async updatePayment(reference, f) {
      const keys = Object.keys(f).filter((k) => f[k] !== undefined);
      if (!keys.length) return;
      const sets = keys.map((k) => (k === 'paid_at' && f[k] === 'now' ? 'paid_at = UTC_TIMESTAMP(3)' : `${k} = ?`));
      const vals = keys.filter((k) => !(k === 'paid_at' && f[k] === 'now')).map((k) => f[k]);
      await q.query(`UPDATE payments SET ${sets.join(', ')} WHERE reference = ?`, [...vals, reference]);
    },
    async subscription(userId) {
      return q.one('SELECT * FROM subscriptions WHERE user_id = ? FOR UPDATE', [userId]);
    },
    async saveSubscription(s) {
      await q.query(`INSERT INTO subscriptions (user_id, plan_code, status, period_start, period_end, provider,
        provider_ref) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE plan_code = VALUES(plan_code),
        status = VALUES(status), period_start = VALUES(period_start), period_end = VALUES(period_end),
        provider = VALUES(provider), provider_ref = VALUES(provider_ref)`,
      [s.user_id, s.plan_code, s.status, s.period_start, s.period_end, s.provider, s.provider_ref]);
    },
    async addEvent(e) {
      await q.query(`INSERT INTO payment_events (provider, event, reference, signature_ok, outcome, payload)
        VALUES (?,?,?,?,?,?)`, [e.provider || 'korapay', String(e.event || '').slice(0, 40),
        String(e.reference || '').slice(0, 64), e.signature_ok ? 1 : 0, String(e.outcome || '').slice(0, 40),
        e.payload == null ? null : String(e.payload).slice(0, 8000)]);
    },
    async payments(userId, limit) {
      return q.query(`SELECT reference, plan_code, amount_minor, currency, status, created_at, paid_at FROM payments
        WHERE user_id = ? ORDER BY id DESC LIMIT ?`, [userId, limit]);
    },
  });
  return { ...repo(db), tx: (fn) => db.transaction((q) => fn(repo(q))) };
}

function memoryStore(seed = {}) {
  const s = { plans: new Map((seed.plans || []).map((p) => [p.code, p])), payments: new Map(), subs: new Map(),
    events: [] };
  const api = {
    _s: s,
    async plan(code) { return s.plans.get(code) || null; },
    async addPayment(p) {
      if (s.payments.has(p.reference)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      s.payments.set(p.reference, { ...p, status: 'pending', created_at: new Date(), paid_at: null });
    },
    async payment(reference) { const p = s.payments.get(reference); return p ? { ...p } : null; },
    async updatePayment(reference, f) {
      const p = s.payments.get(reference); if (!p) return;
      const g = { ...f }; if (g.paid_at === 'now') g.paid_at = new Date();
      Object.keys(g).forEach((k) => g[k] === undefined && delete g[k]);
      s.payments.set(reference, { ...p, ...g });
    },
    async subscription(userId) { const x = s.subs.get(String(userId)); return x ? { ...x } : null; },
    async saveSubscription(x) { s.subs.set(String(x.user_id), { ...x }); },
    async addEvent(e) { s.events.push({ ...e }); },
    async payments(userId, limit) {
      return [...s.payments.values()].filter((p) => String(p.user_id) === String(userId)).reverse().slice(0, limit);
    },
    async tx(fn) {
      const snap = { payments: new Map([...s.payments].map(([k, v]) => [k, { ...v }])),
        subs: new Map([...s.subs].map(([k, v]) => [k, { ...v }])) };
      try { return await fn(api); } catch (e) { s.payments = snap.payments; s.subs = snap.subs; throw e; }
    },
  };
  return api;
}

module.exports = { sqlStore, memoryStore };
