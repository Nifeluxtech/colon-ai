// Live routing (Phase 4): builds the routing config from the database (ai_providers, ai_models and the
// "routing" setting) on top of the built-in table in routing.js. Cached ~30 s per worker, so a change in
// the Admin Dashboard reaches every worker within half a minute, no redeploy.
//
// Never breaks chat: an empty or broken database, an unreadable key, or a config that leaves no usable
// provider all fall back to routing.js (environment keys) for that part, or entirely.
const routingDefault = require('./routing');
const log = require('../../shared/logger');

const TTL_MS = 30 * 1000;
const MODES = Object.keys(routingDefault.routes);   // african, general, study, research, developer
let cache = null, at = 0;

function parseJson(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

function usable(cfg) {
  const p = cfg.providers();
  const ok = (id) => p[id] && p[id].apiKey && (!p[id].needsBaseUrl || p[id].baseUrl);
  return Object.values(cfg.targets()).some(list => list.some(t => ok(t.provider) && t.model));
}

/**
 * compose({ providerRows, modelRows, routing, decrypt }, base) -> routing config (same shape as routing.js,
 * plus .hedge and .source). Pure: no database, so it is unit-tested directly.
 */
function compose({ providerRows = [], modelRows = [], routing = null, decrypt = null } = {}, base = routingDefault) {
  const envProviders = base.providers();
  const providers = { ...envProviders };
  for (const row of providerRows) {
    const b = envProviders[row.id] || { needsBaseUrl: true };
    let key = '';
    if (row.api_key_enc && decrypt) {
      try { key = decrypt(row.api_key_enc); } catch (e) { log.warn('provider_key_unreadable', { provider: row.id }); }
    }
    providers[row.id] = {
      ...b,
      name: row.name || b.name || row.id,
      baseUrl: row.base_url || b.baseUrl || '',
      native: row.native || b.native,
      apiKey: Number(row.enabled) ? (key || b.apiKey || '') : '',   // a stored key wins; the env key is the fallback
      disabled: !Number(row.enabled),
    };
  }

  let targets = base.targets();
  const enabledRows = modelRows.filter(r => Number(r.enabled) && r.model && r.target && r.provider_id);
  if (modelRows.length) {
    const t = {};
    for (const r of [...enabledRows].sort((a, b) => (a.priority - b.priority) || (a.id - b.id))) {
      (t[r.target] = t[r.target] || []).push({ provider: r.provider_id, model: r.model, vision: Boolean(Number(
        r.vision)), body: parseJson(r.body) });
    }
    targets = t;
  }

  const routes = { ...base.routes };
  const want = routing && routing.routes && typeof routing.routes === 'object' ? routing.routes : {};
  for (const mode of MODES) {
    const list = Array.isArray(want[mode]) ? want[mode].filter(n => typeof n === 'string') : null;
    // A route only counts when it names at least one model slot that exists; otherwise keep the default.
    if (list && list.some(n => targets[n] && targets[n].length)) routes[mode] = list;
    else if (!(routes[mode] || []).some(n => targets[n] && targets[n].length)) routes[mode] = Object.keys(targets);
  }
  // Pinned model chains (e.g. Saga Fast) only keep slots that exist.
  const models = base.models.map(m => (m.route ? { ...m, route: m.route.some(n => targets[n])
    ? m.route : routes.general } : m));

  const h = routing && Number(routing.hedge);
  const cfg = {
    providers: () => providers, targets: () => targets, routes, africanLanguages: base.africanLanguages, models,
    hedge: h >= 1 && h <= 4 ? Math.round(h) : undefined,
    source: providerRows.length || modelRows.length || routing ? 'database' : 'default',
  };
  if (!usable(cfg) && usable(base)) return { ...base, hedge: cfg.hedge,
    source: 'default (database config had no usable model)' };
  return cfg;
}

async function build(db) {
  const settings = require('../../shared/settings');
  const { decrypt } = require('../../shared/crypto');
  const [providerRows, modelRows, routing] = await Promise.all([
    db.query('SELECT id, name, base_url, native, api_key_enc, enabled FROM ai_providers'),
    db.query('SELECT id, target, provider_id, model, vision, body, enabled, priority FROM ai_models'),
    settings.get('routing', db),
  ]);
  return compose({ providerRows, modelRows, routing, decrypt });
}

// The current routing config. Never throws.
async function load(db, now = Date.now()) {
  if (cache && now - at < TTL_MS) return cache;
  try {
    cache = await build(db || require('../../db'));
  } catch (e) {
    if (!cache || cache.source !== 'default') log.warn('routing_db_fallback', { err: String(e.message).slice(0, 160) });
    cache = { ...routingDefault, source: 'default' };
  }
  at = now;
  return cache;
}

const clear = () => { cache = null; at = 0; };

module.exports = { load, compose, clear, MODES, TTL_MS };
