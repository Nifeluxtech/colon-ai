// Admin Dashboard (Phase 4): African AI registry, voice engine settings and system settings.
// Phase 5: Web search for Research mode (System › Web search, Super Admin; keys stored encrypted, shown masked).
const Router = require('../router');
const db = require('../../db');
const audit = require('../../shared/audit');
const v = require('../../shared/validate');
const settings = require('../../shared/settings');
const { requireRole, deny } = require('../../modules/auth/guards');
const searchConfig = require('../../modules/search/config');
const { encrypt } = require('../../shared/crypto');

const r = new Router();

/* ---------- African AI registry: language models and datasets, with licence fields ---------- */
const KINDS = ['model', 'dataset'];
const COMMERCIAL = ['yes', 'no', 'unknown'];
const STATUSES = ['candidate', 'approved', 'in_use', 'rejected'];
const url = (s, field) => {
  s = String(s || '').trim();
  if (s && (!/^https?:\/\/\S+$/i.test(s) || s.length > 500)) v.fail(field, 'Use a full http(s):// link.');
  return s;
};

function cleanEntry(b, partial) {
  const out = {};
  if (!partial || b.kind !== undefined) { if (!KINDS.includes(b.kind)) v.fail('kind', 'Choose model or dataset.'); out.kind = b.kind; }
  if (!partial || b.name !== undefined) { const nm = String(b.name || '').trim().slice(0, 120); if (!nm) v.fail('name', 'Enter a name.'); out.name = nm; }
  if (b.languages !== undefined) out.languages = String(b.languages || '').trim().slice(0, 200);
  if (b.licence !== undefined) out.licence = String(b.licence || '').trim().slice(0, 80);
  if (b.licence_url !== undefined) out.licence_url = url(b.licence_url, 'licence_url');
  if (b.source_url !== undefined) out.source_url = url(b.source_url, 'source_url');
  if (b.commercial !== undefined) { if (!COMMERCIAL.includes(b.commercial)) v.fail('commercial', 'Choose yes, no or unknown.'); out.commercial = b.commercial; }
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) v.fail('status', 'Choose a status.'); out.status = b.status; }
  if (b.notes !== undefined) out.notes = b.notes ? String(b.notes).slice(0, 1000) : null;
  return out;
}

r.get('/admin/registry', requireRole('admin'), async (req) => {
  const kind = KINDS.includes(req.query.get('kind')) ? req.query.get('kind') : '';
  const rows = await db.query('SELECT * FROM african_registry WHERE (? = \'\' OR kind = ?) ORDER BY kind, name LIMIT 500', [kind, kind]);
  return [200, { entries: rows }];
});

r.post('/admin/registry', requireRole('admin'), async (req) => {
  const e = cleanEntry(req.body, false);
  const keys = Object.keys(e);
  const res = await db.query(`INSERT INTO african_registry (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => e[k]));
  await audit(req, 'admin.registry_created', { actorId: req.user.id, targetType: 'registry', targetId: res.insertId, meta: { kind: e.kind, name: e.name } });
  return [201, { ok: true, id: res.insertId }];
});

r.patch('/admin/registry/:id', requireRole('admin'), async (req) => {
  const id = Number(req.params.id);
  if (!(await db.one('SELECT id FROM african_registry WHERE id = ?', [id]))) deny(404, 'not_found', 'Entry not found.');
  const e = cleanEntry(req.body, true);
  const keys = Object.keys(e);
  if (keys.length) await db.query(`UPDATE african_registry SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => e[k]), id]);
  await audit(req, 'admin.registry_updated', { actorId: req.user.id, targetType: 'registry', targetId: id, meta: e });
  return [200, { ok: true }];
});

r.delete('/admin/registry/:id', requireRole('admin'), async (req) => {
  const res = await db.query('DELETE FROM african_registry WHERE id = ?', [Number(req.params.id)]);
  if (!res.affectedRows) deny(404, 'not_found', 'Entry not found.');
  await audit(req, 'admin.registry_deleted', { actorId: req.user.id, targetType: 'registry', targetId: req.params.id });
  return [200, { ok: true }];
});

/* ---------- Voice: STT/TTS engine settings (stored only; Phase 6 uses them) ---------- */
const VOICE_DEFAULT = {
  stt: { enabled: false, engine: 'browser', model: '', endpoint: '', languages: 'en-NG,pcm,yo,ha,ig' },
  tts: { enabled: false, engine: 'browser', voice: '', endpoint: '', languages: 'en-NG' },
};
const ENGINES = { stt: ['browser', 'whisper', 'naijavox', 'eko', 'other'], tts: ['browser', 'openai-compatible', 'other'] };

function mergeVoice(s) {
  s = s && typeof s === 'object' ? s : {};
  return { stt: { ...VOICE_DEFAULT.stt, ...(s.stt || {}) }, tts: { ...VOICE_DEFAULT.tts, ...(s.tts || {}) } };
}

r.get('/admin/voice', requireRole('admin'), async () => [200, { voice: mergeVoice(await settings.get('voice')), engines: ENGINES }]);

r.patch('/admin/voice', requireRole('admin'), async (req) => {
  const cur = mergeVoice(await settings.get('voice'));
  for (const part of ['stt', 'tts']) {
    const b = req.body[part];
    if (!b || typeof b !== 'object') continue;
    if (b.enabled !== undefined) cur[part].enabled = Boolean(b.enabled);
    if (b.engine !== undefined) { if (!ENGINES[part].includes(b.engine)) v.fail(`${part}.engine`, 'Choose an engine from the list.'); cur[part].engine = b.engine; }
    for (const k of ['model', 'voice', 'languages']) if (b[k] !== undefined && k in cur[part]) cur[part][k] = String(b[k] || '').trim().slice(0, 120);
    if (b.endpoint !== undefined) cur[part].endpoint = url(b.endpoint, `${part}.endpoint`);
  }
  await settings.set('voice', cur, req.user.id);
  await audit(req, 'admin.voice_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'voice', meta: cur });
  return [200, { ok: true, voice: cur }];
});

/* ---------- System settings: Super Admin only ---------- */
r.get('/admin/system', requireRole('super_admin'), async () => [200, { system: await settings.system(), features: settings.FEATURES }]);

r.patch('/admin/system', requireRole('super_admin'), async (req) => {
  const cur = await settings.system();
  const b = req.body;
  if (b.brandName !== undefined) {
    const nm = String(b.brandName || '').replace(/\s+/g, ' ').trim();
    if (!nm || nm.length > 40) v.fail('brandName', 'Use 1 to 40 characters.');
    cur.brandName = nm;
  }
  if (b.features && typeof b.features === 'object') {
    for (const k of Object.keys(settings.FEATURES)) if (b.features[k] !== undefined) cur.features[k] = Boolean(b.features[k]);
  }
  if (b.maintenance && typeof b.maintenance === 'object') {
    if (b.maintenance.on !== undefined) cur.maintenance.on = Boolean(b.maintenance.on);
    if (b.maintenance.message !== undefined) {
      const m = String(b.maintenance.message || '').trim();
      if (m.length > 300) v.fail('maintenance.message', 'Keep the message under 300 characters.');
      cur.maintenance.message = m || settings.SYSTEM_DEFAULT.maintenance.message;
    }
  }
  if (b.announcement && typeof b.announcement === 'object') {
    if (b.announcement.on !== undefined) cur.announcement.on = Boolean(b.announcement.on);
    if (b.announcement.text !== undefined) {
      const t = String(b.announcement.text || '').trim();
      if (t.length > 300) v.fail('announcement.text', 'Keep the announcement under 300 characters.');
      cur.announcement.text = t;
    }
    if (b.announcement.tone !== undefined) {
      if (!['info', 'warn'].includes(b.announcement.tone)) v.fail('announcement.tone', 'Choose info or warning.');
      cur.announcement.tone = b.announcement.tone;
    }
    if (cur.announcement.on && !cur.announcement.text) v.fail('announcement.text', 'Write the announcement first.');
  }
  await settings.set('system', cur, req.user.id);
  await audit(req, 'admin.system_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'system', meta: cur });
  return [200, { ok: true, system: cur }];
});

/* ---------- Web search (Research mode): Super Admin only ---------- */
function searchOut(cfg) {
  return {
    enabled: cfg.enabled, order: cfg.order, disabled: cfg.disabled, results: cfg.results, pages: cfg.pages, searxngUrl: cfg.searxngUrl,
    providers: cfg.providers.map(p => ({
      id: p.id, name: p.name, needs: p.needs, ready: p.ready,
      key: p.needs === 'key' || p.id === 'searxng' ? { source: p.keySource, masked: p.keySource === 'database' && p.last4 ? `••••${p.last4}` : p.keySource === 'environment' ? '••••••••' : null } : null,
      baseUrl: p.id === 'searxng' ? p.baseUrl : undefined,
    })),
  };
}

r.get('/admin/search', requireRole('super_admin'), async () => [200, { search: searchOut(await searchConfig.load()) }]);

r.patch('/admin/search', requireRole('super_admin'), async (req) => {
  const cur = searchConfig.merge(await settings.get('search'));
  const b = req.body;
  if (b.enabled !== undefined) cur.enabled = Boolean(b.enabled);
  if (b.order !== undefined) {
    if (!Array.isArray(b.order) || b.order.some(id => !searchConfig.ORDER.includes(id))) v.fail('order', 'Use the providers from the list.');
    cur.order = searchConfig.merge({ order: b.order }).order;
  }
  if (b.disabled !== undefined) {
    if (!Array.isArray(b.disabled) || b.disabled.some(id => !searchConfig.ORDER.includes(id))) v.fail('disabled', 'Use the providers from the list.');
    cur.disabled = [...new Set(b.disabled)];
  }
  if (b.results !== undefined) { const n = Number(b.results); if (!(n >= 3 && n <= 8)) v.fail('results', 'Use 3 to 8 results.'); cur.results = Math.round(n); }
  if (b.pages !== undefined) { const n = Number(b.pages); if (!(n >= 0 && n <= 5)) v.fail('pages', 'Read 0 to 5 pages.'); cur.pages = Math.round(n); }
  if (b.searxngUrl !== undefined) cur.searxngUrl = url(b.searxngUrl, 'searxngUrl').replace(/\/+$/, '');
  if (cur.disabled.length >= searchConfig.ORDER.length) v.fail('disabled', 'Keep at least one search provider on.');
  await settings.set('search', cur, req.user.id);
  await audit(req, 'admin.search_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'search', meta: cur });
  return [200, { ok: true, search: searchOut(await searchConfig.load()) }];
});

// Keys for Brave, Tavily (and an optional SearXNG token): encrypted with APP_SECRET; only the last 4 kept in clear.
r.post('/admin/search/key', requireRole('super_admin'), async (req) => {
  const provider = String(req.body.provider || '');
  if (!Object.keys(searchConfig.ENV_KEYS).includes(provider)) v.fail('provider', 'Choose Brave, Tavily or SearXNG.');
  const keys = (await settings.get('search_keys')) || {};
  const key = req.body.api_key == null ? '' : String(req.body.api_key).trim();
  if (!key) {
    delete keys[provider];
    await settings.set('search_keys', keys, req.user.id);
    await audit(req, 'admin.search_key_cleared', { actorId: req.user.id, targetType: 'search_provider', targetId: provider });
  } else {
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) v.fail('api_key', 'That doesn’t look like an API key.');
    keys[provider] = { enc: encrypt(key), last4: key.slice(-4) };
    await settings.set('search_keys', keys, req.user.id);
    await audit(req, 'admin.search_key_set', { actorId: req.user.id, targetType: 'search_provider', targetId: provider });
  }
  return [200, { ok: true }];
});

module.exports = r;
module.exports.mergeVoice = mergeVoice;
module.exports.searchOut = searchOut;
