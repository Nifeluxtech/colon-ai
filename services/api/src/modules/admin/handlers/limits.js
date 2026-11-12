// Admin: usage limits (handlers for src/http/routes/admin/limits.js).

const db = require('../../../db');
const audit = require('../../../shared/audit');
const v = require('../../../shared/validate');
const settings = require('../../../shared/settings');
const config = require('../../../config');
const limits = require('../../ai').limits;

/* ---------- Usage and limits ---------- */
// GET /admin/limits
const getAdminLimits = async () => {
  const eff = await limits.effective();
  const overrides = await db.query((
    'SELECT l.user_id, l.daily_limit, u.email, u.name FROM user_limits l JOIN users u ON u.id = l.user_id ORDER BY '
    + 'l.updated_at DESC LIMIT 100'));
  const usage = await db.query(
    `SELECT CASE WHEN subject LIKE 'u:%' THEN 'users' WHEN subject LIKE 'gi:%' THEN 'guest_ips'
                 ELSE 'guests' END AS kind,
            COUNT(*) AS subjects, SUM(requests) AS requests
       FROM chat_usage WHERE day = UTC_DATE() AND subject NOT LIKE '%:%:%' GROUP BY kind`);
  return [200, {
    limits: { user: eff.dailyLimit, guest: eff.guestDailyLimit, guestIp: eff.guestIpDailyLimit, modes: eff.modes },
    defaults: { user: config.chat.dailyLimit, guest: config.chat.guestDailyLimit,
      guestIp: config.chat.guestIpDailyLimit },
    overrides, today: Object.fromEntries(usage.map(u => [u.kind, { subjects: Number(u.subjects), requests: Number(
      u.requests || 0) }])),
  }];
};

// PATCH /admin/limits
const patchAdminLimits = async (req) => {
  const b = req.body;
  const int = (x, field) => { const k = Number(x); if (!Number.isInteger(k) || k < 0 || k > 1000000) v.fail(field,
    'Use a whole number (0 or more).'); return k; };
  const cur = (await settings.get('limits')) || {};
  const next = { ...cur };
  for (const k of ['user', 'guest', 'guestIp']) if (b[k] !== undefined) next[k] = int(b[k], k);
  if (b.modes && typeof b.modes === 'object') {
    next.modes = { ...(cur.modes || {}) };
    for (const m of ['general', 'study', 'developer', 'research']) {
      if (b.modes[m] === undefined) continue;
      if (b.modes[m] === null || b.modes[m] === '') delete next.modes[m];
      else next.modes[m] = int(b.modes[m], `modes.${m}`);
    }
  }
  await settings.set('limits', next, req.user.id);
  await audit(req, 'admin.limits_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'limits',
    meta: next });
  return [200, { ok: true }];
};

module.exports = { getAdminLimits, patchAdminLimits };
