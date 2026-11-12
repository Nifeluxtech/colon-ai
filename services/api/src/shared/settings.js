// Live platform settings (Phase 4): JSON values in app_settings, edited from the Admin Dashboard.
// Each worker caches a value for ~30 s, so every LiteSpeed/Passenger worker picks up a change within
// half a minute without a redeploy. A database error never throws: callers get the last good value or null,
// and fall back to their built-in defaults.
const TTL_MS = 30 * 1000;
const cache = new Map(); // key -> { v, at }

const loadDb = (db) => db || require('../db');

async function get(key, db, now = Date.now()) {
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.v;
  try {
    const row = await loadDb(db).one('SELECT v FROM app_settings WHERE k = ?', [key]);
    let v = null;
    if (row && row.v != null) { try { v = JSON.parse(row.v); } catch { v = null; } }
    cache.set(key, { v, at: now });
    return v;
  } catch {
    // Keep serving the last good value for another TTL instead of hammering a broken database.
    const v = hit ? hit.v : null;
    cache.set(key, { v, at: now });
    return v;
  }
}

async function set(key, value, actorId = null, db) {
  await loadDb(db).query(
    `INSERT INTO app_settings (k, v, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE v = VALUES(v), updated_by = VALUES(updated_by)`,
    [key, JSON.stringify(value), actorId]
  );
  cache.delete(key);
}

async function remove(key, db) {
  await loadDb(db).query('DELETE FROM app_settings WHERE k = ?', [key]);
  cache.delete(key);
}

const clear = () => cache.clear();

/* ---------- System settings: branding, feature flags, maintenance, announcement ---------- */
const FEATURES = {
  registration: 'New accounts can sign up',
  guestChat: 'Signed-out visitors can chat',
  uploads: 'File and image uploads',
  sharing: 'Share links for conversations',
};
const SYSTEM_DEFAULT = {
  brandName: 'Colon AI',
  features: { registration: true, guestChat: true, uploads: true, sharing: true },
  maintenance: { on: false, message: 'Colon AI is down for a short maintenance. Please try again in a few minutes.' },
  announcement: { on: false, text: '', tone: 'info' },
};

function mergeSystem(v) {
  const s = v && typeof v === 'object' ? v : {};
  return {
    brandName: typeof s.brandName === 'string' && s.brandName.trim() ? s.brandName.trim() : SYSTEM_DEFAULT.brandName,
    features: { ...SYSTEM_DEFAULT.features, ...(s.features && typeof s.features === 'object' ? s.features : {}) },
    maintenance: { ...SYSTEM_DEFAULT.maintenance, ...(s.maintenance || {}) },
    announcement: { ...SYSTEM_DEFAULT.announcement, ...(s.announcement || {}) },
  };
}

async function system(db) { return mergeSystem(await get('system', db)); }

// Route guard: refuses the request when a feature flag is switched off. Staff are never blocked.
const STAFF = new Set(['moderator', 'admin', 'super_admin']);
const MESSAGES = {
  registration: 'New sign-ups are paused right now. Please try again later.',
  guestChat: 'Log in or sign up to chat with Colon.',
  uploads: 'File uploads are switched off right now.',
  sharing: 'Share links are switched off right now.',
};
const feature = (name, { guestsOnly = false } = {}) => async (req) => {
  if (req.user && STAFF.has(req.user.role)) return;
  if (guestsOnly && req.user) return;
  const s = await system();
  if (s.features[name] === false) throw Object.assign(new Error(MESSAGES[name]), { status: 403, code: 'feature_off' });
};

module.exports = { get, set, remove, clear, TTL_MS, FEATURES, SYSTEM_DEFAULT, mergeSystem, system, feature, STAFF };
