// Admin: web search settings (handlers for src/http/routes/admin/web-search.js).

const audit = require('../../../shared/audit');
const v = require('../../../shared/validate');
const settings = require('../../../shared/settings');
const searchConfig = require('../../search').config;
const { encrypt } = require('../../../shared/crypto');
const { url } = require('./platform-common');

/* ---------- Web search (Research mode): Super Admin only ---------- */
function searchOut(cfg) {
  return {
    enabled: cfg.enabled, order: cfg.order, disabled: cfg.disabled, results: cfg.results, pages: cfg.pages,
      searxngUrl: cfg.searxngUrl,
    providers: cfg.providers.map(p => ({
      id: p.id, name: p.name, needs: p.needs, ready: p.ready,
      key: p.needs === 'key' || p.id === 'searxng' ? { source: p.keySource, masked: p.keySource === 'database'
        && p.last4 ? `••••${p.last4}` : p.keySource === 'environment' ? '••••••••' : null } : null,
      baseUrl: p.id === 'searxng' ? p.baseUrl : undefined,
    })),
  };
}

// GET /admin/search
const getAdminSearch = async () => [200, { search: searchOut(await searchConfig.load()) }];

// PATCH /admin/search
const patchAdminSearch = async (req) => {
  const cur = searchConfig.merge(await settings.get('search'));
  const b = req.body;
  if (b.enabled !== undefined) cur.enabled = Boolean(b.enabled);
  if (b.order !== undefined) {
    if (!Array.isArray(b.order) || b.order.some(id => !searchConfig.ORDER.includes(id))) v.fail('order',
      'Use the providers from the list.');
    cur.order = searchConfig.merge({ order: b.order }).order;
  }
  if (b.disabled !== undefined) {
    if (!Array.isArray(b.disabled) || b.disabled.some(id => !searchConfig.ORDER.includes(id))) v.fail('disabled',
      'Use the providers from the list.');
    cur.disabled = [...new Set(b.disabled)];
  }
  if (b.results !== undefined) { const n = Number(b.results); if (!(n >= 3 && n <= 8)) v.fail('results',
    'Use 3 to 8 results.'); cur.results = Math.round(n); }
  if (b.pages !== undefined) { const n = Number(b.pages); if (!(n >= 0 && n <= 5)) v.fail('pages',
    'Read 0 to 5 pages.'); cur.pages = Math.round(n); }
  if (b.searxngUrl !== undefined) cur.searxngUrl = url(b.searxngUrl, 'searxngUrl').replace(/\/+$/, '');
  if (cur.disabled.length >= searchConfig.ORDER.length) v.fail('disabled', 'Keep at least one search provider on.');
  await settings.set('search', cur, req.user.id);
  await audit(req, 'admin.search_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'search',
    meta: cur });
  return [200, { ok: true, search: searchOut(await searchConfig.load()) }];
};

// Keys for Brave, Tavily (and an optional SearXNG token): encrypted with APP_SECRET; only the last 4 kept in clear.
// POST /admin/search/key
const postAdminSearchKey = async (req) => {
  const provider = String(req.body.provider || '');
  if (!Object.keys(searchConfig.ENV_KEYS).includes(provider)) v.fail('provider', 'Choose Brave, Tavily or SearXNG.');
  const keys = (await settings.get('search_keys')) || {};
  const key = req.body.api_key == null ? '' : String(req.body.api_key).trim();
  if (!key) {
    delete keys[provider];
    await settings.set('search_keys', keys, req.user.id);
    await audit(req, 'admin.search_key_cleared', { actorId: req.user.id, targetType: 'search_provider',
      targetId: provider });
  } else {
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) v.fail('api_key', 'That doesn’t look like an API key.');
    keys[provider] = { enc: encrypt(key), last4: key.slice(-4) };
    await settings.set('search_keys', keys, req.user.id);
    await audit(req, 'admin.search_key_set', { actorId: req.user.id, targetType: 'search_provider',
      targetId: provider });
  }
  return [200, { ok: true }];
};

module.exports = { getAdminSearch, patchAdminSearch, postAdminSearchKey, searchOut };
