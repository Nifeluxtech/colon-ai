// Admin: Safety (handlers for src/http/routes/admin/safety.js). Read-only list of safety events with filters, and
// the live settings: categories per audience (signed-in adults vs guests) and provider moderation on/off.
// Stored like the other platform settings (app_settings key "safety"), audited, live within ~30 s.
const audit = require('../../../shared/audit');
const v = require('../../../shared/validate');
const settings = require('../../../shared/settings');
const config = require('../../../config');
const safety = require('../../safety');

const policy = safety.policy;

function settingsOut(cfg) {
  const env = config.safety;
  return {
    categories: policy.ORDER.map((id) => ({ id, label: policy.CATEGORIES[id].label,
      locked: Boolean(policy.CATEGORIES[id].locked), user: cfg.categories[id].user, guest: cfg.categories[id].guest })),
    provider: { setting: cfg.provider, effective: policy.providerOn(cfg), env: Boolean(env.providerModeration),
      keyConfigured: Boolean(env.moderationKey), model: env.moderationModel },
    rules: env.enabled !== false,
    logText: env.logText,
  };
}

// GET /admin/safety?category=&action=&stage=&days=&before=
const getAdminSafety = async (req) => {
  const q = (k) => req.query.get(k) || '';
  const out = await safety.events.list({ category: q('category'), action: q('action'), stage: q('stage'),
    days: q('days'), before: q('before') });
  return [200, { ...out, categories: [...policy.ORDER, 'prompt_injection', 'prompt_leak', 'provider'],
    actions: safety.events.ACTIONS, stages: safety.events.STAGES }];
};

// GET /admin/safety/settings
const getAdminSafetySettings = async () => [200, { safety: settingsOut(await policy.load()) }];

// PATCH /admin/safety/settings  { categories?: { <id>: { user?, guest? } }, provider?: true | false | null }
const patchAdminSafetySettings = async (req) => {
  const cur = policy.merge(await settings.get('safety'));
  const b = req.body;
  if (b.categories !== undefined) {
    if (!b.categories || typeof b.categories !== 'object' || Array.isArray(b.categories)) v.fail('categories',
      'Send the categories as an object.');
    for (const [id, val] of Object.entries(b.categories)) {
      if (!policy.CATEGORIES[id]) v.fail('categories', `Unknown category: ${String(id).slice(0, 40)}.`);
      if (policy.CATEGORIES[id].locked) {
        if (val && (val.user === false || val.guest === false)) v.fail('categories',
          'Child-safety rules can’t be switched off.');
        continue;
      }
      for (const aud of ['user', 'guest']) {
        if (val && val[aud] !== undefined) {
          if (typeof val[aud] !== 'boolean') v.fail('categories', 'Use on or off.');
          cur.categories[id][aud] = val[aud];
        }
      }
    }
  }
  if (b.provider !== undefined) {
    if (b.provider !== null && typeof b.provider !== 'boolean') v.fail('provider', 'Use on, off or default.');
    cur.provider = b.provider;
  }
  await settings.set('safety', cur, req.user.id);
  await audit(req, 'admin.safety_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'safety',
    meta: cur });
  return [200, { ok: true, safety: settingsOut(policy.merge(cur)) }];
};

module.exports = { getAdminSafety, getAdminSafetySettings, patchAdminSafetySettings, settingsOut };
