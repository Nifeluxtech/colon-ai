// Billing admin persistence (v0.14.0, Blueprint step A7): the statements behind Admin › Plans, Credits, Payments and
// Costs that the credit engine itself never runs. sqlAdminStore(db) for MySQL; memoryAdminStore(base) adds the same
// methods to a billing memoryStore() for tests (sharing its plans, subscriptions, wallets and ledger).
// Costs read ai_calls (pruned after 30 days by the overview handler), grouped by UTC day.

function sqlAdminStore(db = require('../../db')) {
  return {
    async updatePlan(code, f) {
      const keys = ['name', 'price_minor', 'active', 'sort'].filter((k) => f[k] !== undefined);
      if (!keys.length) return;
      await db.query(`UPDATE plans SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE code = ?`,
        [...keys.map((k) => f[k]), code]);
    },
    async setEntitlement(code, feature, e) {
      await db.query(`INSERT INTO plan_entitlements (plan_code, feature, enabled, limit_value) VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), limit_value = VALUES(limit_value)`,
      [code, feature, e.enabled ? 1 : 0, e.limit]);
    },
    async user(key) {
      const byId = /^\d+$/.test(String(key));
      return db.one(`SELECT id, email, name, role FROM users WHERE ${byId ? 'id' : 'email'} = ?`,
        [byId ? Number(key) : String(key).toLowerCase()]);
    },
    async subscriptionRow(userId) {
      return db.one('SELECT plan_code, status, period_start, period_end, provider, provider_ref FROM subscriptions '
        + 'WHERE user_id = ?', [userId]);
    },
    async payments({ status = '', userId = null, limit = 50 } = {}) {
      return db.query(`SELECT p.reference, p.user_id, u.email, p.plan_code, p.amount_minor, p.currency, p.status,
        p.method, p.failure, p.created_at, p.paid_at FROM payments p LEFT JOIN users u ON u.id = p.user_id
        WHERE (? = '' OR p.status = ?) AND (? IS NULL OR p.user_id = ?) ORDER BY p.id DESC LIMIT ?`,
      [status, status, userId, userId, limit]);
    },
    async costs({ since, today }) {
      const base = 'FROM ai_calls c WHERE c.created_at >= ?';
      const sums = 'COUNT(*) AS calls, COALESCE(SUM(c.input_tokens), 0) AS input_tokens, '
        + 'COALESCE(SUM(c.output_tokens), 0) AS output_tokens, COALESCE(SUM(c.cost_minor), 0) AS cost_minor';
      const byDay = await db.query(`SELECT DATE_FORMAT(c.created_at, '%Y-%m-%d') AS day, ${sums} ${base}
        GROUP BY day ORDER BY day`, [since]);
      const byModel = await db.query(`SELECT c.provider, c.model, ${sums} ${base} AND c.provider <> ''
        GROUP BY c.provider, c.model ORDER BY cost_minor DESC, calls DESC LIMIT 50`, [since]);
      const byPlan = await db.query(`SELECT CASE WHEN c.guest = 1 THEN 'guest' WHEN c.plan_code = '' THEN 'none'
        ELSE c.plan_code END AS plan, ${sums} ${base} GROUP BY plan ORDER BY cost_minor DESC, calls DESC`, [since]);
      const topUsers = await db.query(`SELECT c.user_id, u.email, ${sums} FROM ai_calls c
        LEFT JOIN users u ON u.id = c.user_id WHERE c.created_at >= ? AND c.user_id IS NOT NULL
        GROUP BY c.user_id, u.email ORDER BY cost_minor DESC, (input_tokens + output_tokens) DESC LIMIT 10`, [since]);
      const t = await db.one(`SELECT ${sums} ${base}`, [today]);
      return { byDay, byModel, byPlan, topUsers, today: t };
    },
  };
}

const DAY = 86400000;
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

// The same four groupings as the SQL above, over call rows in memory (also documents what the SQL returns).
function aggregateCalls(calls, { since, today, users = new Map() }) {
  const from = new Date(String(since).replace(' ', 'T') + 'Z').getTime();
  const todayFrom = new Date(String(today).replace(' ', 'T') + 'Z').getTime();
  const rows = calls.filter((c) => new Date(c.created_at).getTime() >= from);
  const group = (list, keyOf, extra) => {
    const m = new Map();
    for (const c of list) {
      const k = keyOf(c);
      if (k == null) continue;
      const g = m.get(k) || { ...extra(c), calls: 0, input_tokens: 0, output_tokens: 0, cost_minor: 0 };
      g.calls += 1; g.input_tokens += Number(c.input_tokens) || 0; g.output_tokens += Number(c.output_tokens) || 0;
      g.cost_minor += Number(c.cost_minor) || 0;
      m.set(k, g);
    }
    return [...m.values()];
  };
  const byCost = (a, b) => b.cost_minor - a.cost_minor || b.calls - a.calls;
  const planOf = (c) => (c.guest ? 'guest' : c.plan_code || 'none');
  return {
    byDay: group(rows, (c) => dayOf(c.created_at), (c) => ({ day: dayOf(c.created_at) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byModel: group(rows, (c) => (c.provider ? `${c.provider}|${c.model}` : null),
      (c) => ({ provider: c.provider, model: c.model })).sort(byCost).slice(0, 50),
    byPlan: group(rows, planOf, (c) => ({ plan: planOf(c) })).sort(byCost),
    topUsers: group(rows, (c) => (c.user_id ? String(c.user_id) : null), (c) => ({ user_id: c.user_id,
      email: (users.get(String(c.user_id)) || {}).email || null }))
      .sort((a, b) => b.cost_minor - a.cost_minor || (b.input_tokens + b.output_tokens)
        - (a.input_tokens + a.output_tokens)).slice(0, 10),
    today: group(rows.filter((c) => new Date(c.created_at).getTime() >= todayFrom), () => 'all', () => ({}))[0]
      || { calls: 0, input_tokens: 0, output_tokens: 0, cost_minor: 0 },
  };
}

function memoryAdminStore(base, seed = {}) {
  const s = base._s;
  s.users = new Map((seed.users || []).map((u) => [String(u.id), u]));
  s.payments = seed.payments || [];
  s.calls = seed.calls || [];
  return Object.assign(base, {
    async updatePlan(code, f) {
      const p = s.plans.find((x) => x.code === code);
      if (p) Object.keys(f).forEach((k) => { if (f[k] !== undefined) p[k] = f[k]; });
    },
    async setEntitlement(code, feature, e) {
      const row = s.entitlements.find((x) => x.plan_code === code && x.feature === feature);
      const next = { plan_code: code, feature, enabled: e.enabled ? 1 : 0, limit_value: e.limit };
      if (row) Object.assign(row, next); else s.entitlements.push(next);
    },
    async user(key) {
      const k = String(key);
      return s.users.get(k) || [...s.users.values()].find((u) => u.email === k.toLowerCase()) || null;
    },
    async subscriptionRow(userId) { return s.subs.get(String(userId)) || null; },
    async payments({ status = '', userId = null, limit = 50 } = {}) {
      return s.payments.filter((p) => (!status || p.status === status)
        && (userId == null || String(p.user_id) === String(userId))).slice().reverse().slice(0, limit);
    },
    async costs(range) { return aggregateCalls(s.calls, { ...range, users: s.users }); },
  });
}

module.exports = { sqlAdminStore, memoryAdminStore, aggregateCalls, DAY };
