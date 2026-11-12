// Safety settings and the decision per audience. Stored like the other platform settings: JSON in app_settings
// (key "safety"), edited from Admin › Safety, cached ~30 s per worker (shared/settings.js).
//   { categories: { <category>: { user: bool, guest: bool } }, provider: true | false | null (null = env) }
// "user" = signed-in accounts (Colon has no age check; signed-in users are treated as adults), "guest" = signed-out
// visitors. A category switched off for an audience lets those messages through untouched. csam can't be
// switched off: it is enforced for everyone whatever the settings or SAFETY say.
const settings = require('../../shared/settings');
const config = require('../../config');

const CATEGORIES = {
  csam: { label: 'Child sexual content', locked: true },
  self_harm: { label: 'Self-harm and suicide (supportive reply + helplines)' },
  violence: { label: 'Weapons, explosives and violent harm' },
  drugs: { label: 'Illegal drug making' },
  hate: { label: 'Hate and harassment' },
  sexual: { label: 'Explicit sexual content (guests refused, adults non-graphic)' },
  fraud: { label: 'Fraud and scams (Yahoo-yahoo, BVN/OTP phishing)' },
  privacy: { label: 'Personal data exposure' },
};
const ORDER = Object.keys(CATEGORIES);

function merge(v) {
  const s = v && typeof v === 'object' ? v : {};
  const cats = {};
  for (const id of ORDER) {
    const c = s.categories && s.categories[id] && typeof s.categories[id] === 'object' ? s.categories[id] : {};
    cats[id] = CATEGORIES[id].locked ? { user: true, guest: true }
      : { user: c.user !== false, guest: c.guest !== false };
  }
  return { categories: cats, provider: typeof s.provider === 'boolean' ? s.provider : null };
}

async function load(db) { return merge(await settings.get('safety', db)); }

const audienceOf = (req) => (req && req.user ? 'user' : 'guest');

// Effective switches for one request: SAFETY=off leaves only csam on.
function enabledFor(cfg, audience, env = config.safety) {
  const on = {};
  for (const id of ORDER) on[id] = id === 'csam' || (env.enabled !== false && cfg.categories[id][audience] !== false);
  return on;
}

// Provider moderation runs when the admin setting (or, when unset, SAFETY_PROVIDER_MODERATION) says on and a key
// is configured.
function providerOn(cfg, env = config.safety) {
  const wanted = cfg.provider === null ? Boolean(env.providerModeration) : cfg.provider;
  return Boolean(wanted && env.moderationKey && env.moderationUrl);
}

// Audience-specific outcome for a rule hit. Sexual content: guests refused; signed-in adults answered with care.
function adjust(hit, audience) {
  if (!hit) return hit;
  if (hit.category === 'sexual' && hit.action === 'refuse' && audience === 'user') {
    return { ...hit, action: 'allow_with_care', care: 'adult_sexual' };
  }
  return hit;
}

module.exports = { CATEGORIES, ORDER, merge, load, audienceOf, enabledFor, providerOn, adjust };
