// Admin: AI providers and models (handlers for src/http/routes/admin/ai.js).
// Admin Dashboard (Phase 4): providers, models, routing, usage limits and evaluation.
// Changes are stored in MySQL and reach every worker within ~30 s (src/modules/ai/dynamic.js, src/shared/settings.js).
// Provider API keys are super_admin only, stored AES-256-GCM encrypted, and never sent back (masked only).
const db = require('../../../db');
const audit = require('../../../shared/audit');
const v = require('../../../shared/validate');
const routingDefault = require('../../ai').routing;
const dynamic = require('../../ai').dynamic;
const ai = require('../../ai');
const { encrypt } = require('../../../shared/crypto');
const benchGate = require('../../bench').gate;
const { deny } = require('../../auth').guards;
const { isSuper, ID_RE, changed, gateModel } = require('./ai-common');

function cleanUrl(u, field) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (!/^https:\/\/[^\s]+$/i.test(s) || s.length > 255) v.fail(field, 'Use a full https:// address.');
  return s.replace(/\/+$/, '');
}

async function upsertProvider(id, fields) {
  const env = routingDefault.providers()[id] || {};
  await db.query(
    `INSERT INTO ai_providers (id, name, base_url, native, enabled) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE id = id`, [
      id,
      fields.name || env.name || id,
      fields.base_url != null ? fields.base_url : (env.baseUrl || ''),
      fields.native != null ? fields.native : (env.native || ''),
      1,
    ]);
}

/* ---------- Models (slots like "qwen", "deepseek": provider + model id, in order) ---------- */
function defaultModelRows() {
  const out = [];
  for (const [target, list] of Object.entries(routingDefault.targets())) {
    list.forEach((t, i) => { if (t.model) out.push({ target, provider_id: t.provider, model: t.model, vision: t.vision
      ? 1 : 0, body: t.body ? JSON.stringify(t.body) : null, enabled: 1, priority: i }); });
  }
  return out;
}

async function seedModels(req) {
  const [{ c }] = await db.query('SELECT COUNT(*) AS c FROM ai_models');
  if (Number(c)) return false;
  for (const m of defaultModelRows()) {
    await db.query(
      'INSERT INTO ai_models (target, provider_id, model, vision, body, enabled, priority) VALUES (?,?,?,?,?,?,?)',
      [m.target, m.provider_id, m.model, m.vision, m.body, m.enabled, m.priority]);
  }
  await audit(req, 'admin.models_seeded', { actorId: req.user.id });
  return true;
}

async function cleanModel(b, partial = false) {
  const out = {};
  if (!partial || b.target !== undefined) {
    const t = String(b.target || '').trim().toLowerCase();
    if (!ID_RE.test(t)) v.fail('target', 'Use a short slot name like “qwen” (letters, numbers, - or _).');
    out.target = t;
  }
  if (!partial || b.provider_id !== undefined) {
    const p = String(b.provider_id || '');
    const known = routingDefault.providers()[p] || await db.one('SELECT id FROM ai_providers WHERE id = ?', [p]);
    if (!known) v.fail('provider_id', 'Choose a provider from the list.');
    out.provider_id = p;
  }
  if (!partial || b.model !== undefined) {
    const m = String(b.model || '').trim();
    if (!m || m.length > 128 || /\s/.test(m)) v.fail('model', 'Enter the provider’s model id.');
    out.model = m;
  }
  if (b.vision !== undefined) out.vision = b.vision ? 1 : 0;
  if (b.enabled !== undefined) out.enabled = b.enabled ? 1 : 0;
  if (b.priority !== undefined) { const p = Number(b.priority); if (!Number.isInteger(p) || p < 0 || p > 99) v.fail(
    'priority', 'Use 0–99 (lower is tried first).'); out.priority = p; }
  if (b.body !== undefined) {
    if (b.body === null || b.body === '') out.body = null;
    else {
      let parsed = b.body;
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { v.fail('body',
        'Request options must be valid JSON.'); } }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) v.fail('body',
        'Request options must be a JSON object.');
      const s = JSON.stringify(parsed);
      if (s.length > 2000) v.fail('body', 'Request options are too long.');
      out.body = s;
    }
  }
  return out;
}

/* ---------- Providers ---------- */
// The list merges the built-in providers (routing.js, keys from env) with database rows (overrides and new ones).
// GET /admin/providers
const getAdminProviders = async (req) => {
  const env = routingDefault.providers();
  const rows = await db.query((
    'SELECT id, name, base_url, native, key_last4, api_key_enc IS NOT NULL AS has_key, enabled, updated_at FROM '
    + 'ai_providers'));
  const byId = Object.fromEntries(rows.map(x => [x.id, x]));
  const live = ai.enabledProviders(await dynamic.load());
  const ids = [...new Set([...Object.keys(env), ...rows.map(x => x.id)])];
  const providers = ids.map((id) => {
    const e = env[id] || {}, row = byId[id];
    const keySource = row && Number(row.has_key) ? 'database' : e.apiKey ? 'environment' : 'none';
    return {
      id, name: (row && row.name) || e.name || id, base_url: (row && row.base_url) || e.baseUrl || '', native: (row
        && row.native) || e.native || '',
      enabled: row ? Boolean(Number(row.enabled)) : true, builtin: Boolean(env[id]), in_db: Boolean(row), live: Boolean(
        live[id]),
      key: { source: keySource, masked: keySource === 'database' && isSuper(req) && row.key_last4
        ? `••••${row.key_last4}` : keySource === 'none' ? null : '••••••••' },
      updated_at: row ? row.updated_at : null,
    };
  });
  return [200, { providers, can_edit_keys: isSuper(req) }];
};

// POST /admin/providers
const postAdminProviders = async (req) => {
  const id = String(req.body.id || '').trim().toLowerCase();
  if (!ID_RE.test(id)) v.fail('id', 'Use 1–32 lowercase letters, numbers, - or _.');
  if (routingDefault.providers()[id] || await db.one('SELECT id FROM ai_providers WHERE id = ?', [id])) v.fail('id',
    'A provider with this id already exists.');
  const name = String(req.body.name || '').trim().slice(0, 80) || id;
  const base = cleanUrl(req.body.base_url, 'base_url');
  if (!base) v.fail('base_url', 'Enter the provider’s OpenAI-compatible base URL.');
  const native = req.body.native === 'gemini' ? 'gemini' : '';
  await db.query('INSERT INTO ai_providers (id, name, base_url, native, enabled) VALUES (?,?,?,?,1)', [id, name, base,
    native]);
  changed();
  await audit(req, 'admin.provider_created', { actorId: req.user.id, targetType: 'provider', targetId: id,
    meta: { name, base_url: base } });
  return [201, { ok: true }];
};

// PATCH /admin/providers/:id
const patchAdminProvidersById = async (req) => {
  const id = String(req.params.id);
  if (!ID_RE.test(id)) deny(404, 'not_found', 'Provider not found.');
  const builtin = Boolean(routingDefault.providers()[id]);
  if (!builtin && !(await db.one('SELECT id FROM ai_providers WHERE id = ?', [id]))) deny(404, 'not_found',
    'Provider not found.');
  await upsertProvider(id, {});
  const sets = [], params = [], meta = {};
  if (req.body.name !== undefined) { const nm = String(req.body.name || '').trim().slice(0, 80);
    if (!nm) v.fail('name', 'Enter a name.'); sets.push('name = ?'); params.push(nm); meta.name = nm; }
  if (req.body.base_url !== undefined) { const b = cleanUrl(req.body.base_url, 'base_url'); sets.push('base_url = ?');
    params.push(b); meta.base_url = b; }
  if (req.body.enabled !== undefined) { sets.push('enabled = ?'); params.push(req.body.enabled ? 1 : 0);
    meta.enabled = Boolean(req.body.enabled); }
  if (req.body.native !== undefined) { const nt = req.body.native === 'gemini' ? 'gemini' : '';
    sets.push('native = ?'); params.push(nt); meta.native = nt; }
  if (sets.length) await db.query(`UPDATE ai_providers SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  changed();
  await audit(req, 'admin.provider_updated', { actorId: req.user.id, targetType: 'provider', targetId: id, meta });
  return [200, { ok: true }];
};

// API keys: Super Admin only. Stored encrypted; only the last 4 characters are kept in clear for the mask.
// POST /admin/providers/:id/key
const postAdminProvidersByIdKey = async (req) => {
  const id = String(req.params.id);
  if (!ID_RE.test(id)) deny(404, 'not_found', 'Provider not found.');
  if (!routingDefault.providers()[id] && !(await db.one('SELECT id FROM ai_providers WHERE id = ?', [id]))) deny(404,
    'not_found', 'Provider not found.');
  await upsertProvider(id, {});
  const key = req.body.api_key == null ? '' : String(req.body.api_key).trim();
  if (!key) {
    await db.query('UPDATE ai_providers SET api_key_enc = NULL, key_last4 = NULL WHERE id = ?', [id]);
    await audit(req, 'admin.provider_key_cleared', { actorId: req.user.id, targetType: 'provider', targetId: id });
  } else {
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) v.fail('api_key', 'That doesn’t look like an API key.');
    await db.query('UPDATE ai_providers SET api_key_enc = ?, key_last4 = ? WHERE id = ?', [encrypt(key), key.slice(-4),
      id]);
    await audit(req, 'admin.provider_key_set', { actorId: req.user.id, targetType: 'provider', targetId: id });
  }
  changed();
  return [200, { ok: true }];
};

// Removes the database row: a built-in provider goes back to its environment settings; a custom one is gone.
// DELETE /admin/providers/:id
const deleteAdminProvidersById = async (req) => {
  const id = String(req.params.id);
  const row = await db.one('SELECT id, api_key_enc IS NOT NULL AS has_key FROM ai_providers WHERE id = ?', [id]);
  if (!row) deny(404, 'not_found', 'Nothing to reset for this provider.');
  if (Number(row.has_key) && !isSuper(req)) deny(403, 'forbidden',
    'This provider has a stored API key. Only a Super Admin can remove it.');
  await db.query('DELETE FROM ai_providers WHERE id = ?', [id]);
  changed();
  await audit(req, 'admin.provider_deleted', { actorId: req.user.id, targetType: 'provider', targetId: id });
  return [200, { ok: true }];
};

// GET /admin/models
const getAdminModels = async () => {
  const rows = await db.query((
    'SELECT id, target, provider_id, model, vision, body, enabled, priority, updated_at FROM ai_models ORDER BY '
    + 'target, priority, id'));
  const out = rows.length ? rows : defaultModelRows().map((x, i) => ({ id: null, key: i, ...x }));
  let bench = [];
  try {
    bench = await db.query((
      "SELECT provider, model, score, status, created_at FROM eval_runs WHERE kind = 'bench' ORDER BY created_at "
      + "DESC LIMIT 500"));
  } catch { /* before migration 0005 */ }
  const latest = {};
  for (const b of bench) { const k = `${b.provider}:${b.model}`; if (!latest[k]) latest[k] = { score: b.score == null
    ? null : Number(b.score), status: b.status, at: b.created_at }; }
  return [200, {
    bench_gate: { enabled: benchGate.enabled(), max_age_days: benchGate.maxAgeDays() },
    source: rows.length ? 'database' : 'default',
    models: out.map(m => ({ ...m, vision: Boolean(Number(m.vision)), enabled: Boolean(Number(m.enabled)),
      benchmark: latest[`${m.provider_id}:${m.model}`] || null })),
    providers: Object.keys({ ...routingDefault.providers(), ...Object.fromEntries((await db.query(
      'SELECT id FROM ai_providers')).map(p => [p.id, 1])) }),
  }];
};

// POST /admin/models/seed
const postAdminModelsSeed = async (req) => {
  const seeded = await seedModels(req);
  changed();
  return [200, { ok: true, seeded }];
};

// POST /admin/models
const postAdminModels = async (req) => {
  await seedModels(req);  // the first edit copies the built-in table into the database
  const m = await cleanModel(req.body);
  if (m.enabled === undefined || m.enabled) await gateModel(req, m.provider_id, m.model);
  const res = await db.query(
    'INSERT INTO ai_models (target, provider_id, model, vision, body, enabled, priority) VALUES (?,?,?,?,?,?,?)',
    [m.target, m.provider_id, m.model, m.vision || 0, m.body || null, m.enabled === undefined ? 1 : m.enabled,
      m.priority || 0]);
  changed();
  await audit(req, 'admin.model_created', { actorId: req.user.id, targetType: 'model', targetId: res.insertId,
    meta: { target: m.target, provider: m.provider_id, model: m.model } });
  return [201, { ok: true, id: res.insertId }];
};

// PATCH /admin/models/:id
const patchAdminModelsById = async (req) => {
  const id = Number(req.params.id);
  const cur = await db.one('SELECT id, provider_id, model, enabled FROM ai_models WHERE id = ?', [id]);
  if (!cur) deny(404, 'not_found', 'Model not found.');
  const m = await cleanModel(req.body, true);
  // A new model id or host, or switching a model back on, is a model change: it must be benchmarked first.
  const provider = m.provider_id || cur.provider_id, model = m.model || cur.model;
  const enabledAfter = m.enabled !== undefined ? m.enabled : Number(cur.enabled);
  const isChange = provider !== cur.provider_id || model !== cur.model || (m.enabled === 1 && !Number(cur.enabled));
  if (enabledAfter && isChange) await gateModel(req, provider, model);
  const keys = Object.keys(m);
  if (keys.length) await db.query(`UPDATE ai_models SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map(k => m[k]), id]);
  changed();
  await audit(req, 'admin.model_updated', { actorId: req.user.id, targetType: 'model', targetId: id, meta: m });
  return [200, { ok: true }];
};

// DELETE /admin/models/:id
const deleteAdminModelsById = async (req) => {
  const id = Number(req.params.id);
  const res = await db.query('DELETE FROM ai_models WHERE id = ?', [id]);
  if (!res.affectedRows) deny(404, 'not_found', 'Model not found.');
  changed();
  await audit(req, 'admin.model_deleted', { actorId: req.user.id, targetType: 'model', targetId: id });
  return [200, { ok: true }];
};

module.exports = { getAdminProviders, postAdminProviders, patchAdminProvidersById, postAdminProvidersByIdKey,
  deleteAdminProvidersById, getAdminModels, postAdminModelsSeed, postAdminModels, patchAdminModelsById,
  deleteAdminModelsById, defaultModelRows };
