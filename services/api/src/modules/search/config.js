// Web search settings: Admin › System › Web search (Super Admin), stored in app_settings and cached ~30 s.
//   "search"       { enabled, order[], results, pages, searxngUrl }
//   "search_keys"  { brave: { enc, last4 }, tavily: { enc, last4 }, searxng: { enc, last4 } }  (AES-256-GCM, APP_SECRET)
// Environment fallbacks (a stored value wins): WEB_SEARCH=off, BRAVE_SEARCH_API_KEY, TAVILY_API_KEY,
// SEARXNG_URL, SEARXNG_API_KEY. Nothing is required: with no keys the chain is DuckDuckGo → Wikipedia.
const settings = require('../../shared/settings');
const { PROVIDERS } = require('./providers');

const ORDER = ['brave', 'tavily', 'searxng', 'duckduckgo', 'wikipedia'];
const DEFAULT = { enabled: true, order: ORDER, results: 5, pages: 3, searxngUrl: '' };
const ENV_KEYS = { brave: 'BRAVE_SEARCH_API_KEY', tavily: 'TAVILY_API_KEY', searxng: 'SEARXNG_API_KEY' };
const env = (k) => (process.env[k] || '').trim();

const clamp = (n, lo, hi, d) => { n = Math.round(Number(n)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function merge(v) {
  const s = v && typeof v === 'object' ? v : {};
  const order = Array.isArray(s.order) ? s.order.filter((id, i, a) => ORDER.includes(id) && a.indexOf(id) === i) : [];
  for (const id of ORDER) if (!order.includes(id)) order.push(id);   // a provider left out is appended, never lost
  return {
    enabled: s.enabled === undefined ? env('WEB_SEARCH') !== 'off' : Boolean(s.enabled),
    order,
    disabled: Array.isArray(s.disabled) ? s.disabled.filter(id => ORDER.includes(id)) : [],
    results: clamp(s.results, 3, 8, DEFAULT.results),
    pages: clamp(s.pages, 0, 5, DEFAULT.pages),
    searxngUrl: typeof s.searxngUrl === 'string' ? s.searxngUrl.trim() : '',
  };
}

/**
 * load(db, { decrypt }) -> { enabled, order, disabled, results, pages, searxngUrl, providers: [{ id, name, ready, key, baseUrl, keySource }] }
 * Never throws: a database problem means the defaults (DuckDuckGo → Wikipedia).
 */
async function load(db, { decrypt } = {}) {
  let s = null, keys = null;
  try { [s, keys] = await Promise.all([settings.get('search', db), settings.get('search_keys', db)]); } catch { /* defaults */ }
  const cfg = merge(s);
  if (!decrypt) { try { decrypt = require('../../shared/crypto').decrypt; } catch { decrypt = null; } }
  const stored = (id) => {
    const k = keys && keys[id];
    if (!k || !k.enc || !decrypt) return '';
    try { return decrypt(k.enc); } catch { return ''; }
  };
  cfg.providers = cfg.order.map((id) => {
    const p = PROVIDERS[id];
    const dbKey = stored(id);
    const key = dbKey || (ENV_KEYS[id] ? env(ENV_KEYS[id]) : '');
    const baseUrl = id === 'searxng' ? (cfg.searxngUrl || env('SEARXNG_URL')) : '';
    const ready = !cfg.disabled.includes(id) && (p.needs === 'key' ? Boolean(key) : p.needs === 'url' ? /^https?:\/\//i.test(baseUrl) : true);
    return { id, name: p.name, needs: p.needs || null, ready, key, baseUrl, keySource: dbKey ? 'database' : key ? 'environment' : 'none', last4: dbKey && keys[id].last4 };
  });
  return cfg;
}

module.exports = { load, merge, DEFAULT, ORDER, ENV_KEYS };
