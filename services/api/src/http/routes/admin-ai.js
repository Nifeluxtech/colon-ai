// Admin Dashboard (Phase 4): providers, models, routing, usage limits and evaluation.
// Changes are stored in MySQL and reach every worker within ~30 s (src/ai/dynamic.js, src/lib/settings.js).
// Provider API keys are super_admin only, stored AES-256-GCM encrypted, and never sent back (masked only).
const Router = require('../router');
const db = require('../../db');
const audit = require('../../shared/audit');
const v = require('../../shared/validate');
const settings = require('../../shared/settings');
const config = require('../../config');
const routingDefault = require('../../modules/ai').routing;
const dynamic = require('../../modules/ai').dynamic;
const ai = require('../../modules/ai');
const limits = require('../../modules/ai').limits;
const { encrypt } = require('../../shared/crypto');
const benchGate = require('../../modules/bench').gate;
const { requireRole, RANK, deny } = require('../../modules/auth').guards;

const r = new Router();
const isSuper = (req) => RANK[req.user.role] >= RANK.super_admin;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const changed = () => { dynamic.clear(); };

// Phase 5 release standard: a model goes into routing only after a fresh Colon benchmark of it (src/bench/gate.js).
// A Super Admin may skip it once with a written reason ("skip_benchmark"), which is audited.
async function gateModel(req, provider, model) {
  const skipReason = String(req.body.skip_benchmark || '').trim().slice(0, 300);
  const r = await benchGate.requireBenchmark(db, { provider, model }, { isSuper: isSuper(req), skipReason });
  if (r.skipped === 'super_admin') await audit(req, 'admin.bench_gate_skipped', { actorId: req.user.id, targetType: 'model', targetId: `${provider}:${model}`, meta: { reason: skipReason } });
  return r;
}

function cleanUrl(u, field) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (!/^https:\/\/[^\s]+$/i.test(s) || s.length > 255) v.fail(field, 'Use a full https:// address.');
  return s.replace(/\/+$/, '');
}

/* ---------- Providers ---------- */
// The list merges the built-in providers (routing.js, keys from env) with database rows (overrides and new ones).
r.get('/admin/providers', requireRole('admin'), async (req) => {
  const env = routingDefault.providers();
  const rows = await db.query('SELECT id, name, base_url, native, key_last4, api_key_enc IS NOT NULL AS has_key, enabled, updated_at FROM ai_providers');
  const byId = Object.fromEntries(rows.map(x => [x.id, x]));
  const live = ai.enabledProviders(await dynamic.load());
  const ids = [...new Set([...Object.keys(env), ...rows.map(x => x.id)])];
  const providers = ids.map((id) => {
    const e = env[id] || {}, row = byId[id];
    const keySource = row && Number(row.has_key) ? 'database' : e.apiKey ? 'environment' : 'none';
    return {
      id, name: (row && row.name) || e.name || id, base_url: (row && row.base_url) || e.baseUrl || '', native: (row && row.native) || e.native || '',
      enabled: row ? Boolean(Number(row.enabled)) : true, builtin: Boolean(env[id]), in_db: Boolean(row), live: Boolean(live[id]),
      key: { source: keySource, masked: keySource === 'database' && isSuper(req) && row.key_last4 ? `••••${row.key_last4}` : keySource === 'none' ? null : '••••••••' },
      updated_at: row ? row.updated_at : null,
    };
  });
  return [200, { providers, can_edit_keys: isSuper(req) }];
});

async function upsertProvider(id, fields) {
  const env = routingDefault.providers()[id] || {};
  await db.query(
    `INSERT INTO ai_providers (id, name, base_url, native, enabled) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE id = id`, [id, fields.name || env.name || id, fields.base_url != null ? fields.base_url : (env.baseUrl || ''), fields.native != null ? fields.native : (env.native || ''), 1]);
}

r.post('/admin/providers', requireRole('admin'), async (req) => {
  const id = String(req.body.id || '').trim().toLowerCase();
  if (!ID_RE.test(id)) v.fail('id', 'Use 1–32 lowercase letters, numbers, - or _.');
  if (routingDefault.providers()[id] || await db.one('SELECT id FROM ai_providers WHERE id = ?', [id])) v.fail('id', 'A provider with this id already exists.');
  const name = String(req.body.name || '').trim().slice(0, 80) || id;
  const base = cleanUrl(req.body.base_url, 'base_url');
  if (!base) v.fail('base_url', 'Enter the provider’s OpenAI-compatible base URL.');
  const native = req.body.native === 'gemini' ? 'gemini' : '';
  await db.query('INSERT INTO ai_providers (id, name, base_url, native, enabled) VALUES (?,?,?,?,1)', [id, name, base, native]);
  changed();
  await audit(req, 'admin.provider_created', { actorId: req.user.id, targetType: 'provider', targetId: id, meta: { name, base_url: base } });
  return [201, { ok: true }];
});

r.patch('/admin/providers/:id', requireRole('admin'), async (req) => {
  const id = String(req.params.id);
  if (!ID_RE.test(id)) deny(404, 'not_found', 'Provider not found.');
  const builtin = Boolean(routingDefault.providers()[id]);
  if (!builtin && !(await db.one('SELECT id FROM ai_providers WHERE id = ?', [id]))) deny(404, 'not_found', 'Provider not found.');
  await upsertProvider(id, {});
  const sets = [], params = [], meta = {};
  if (req.body.name !== undefined) { const nm = String(req.body.name || '').trim().slice(0, 80); if (!nm) v.fail('name', 'Enter a name.'); sets.push('name = ?'); params.push(nm); meta.name = nm; }
  if (req.body.base_url !== undefined) { const b = cleanUrl(req.body.base_url, 'base_url'); sets.push('base_url = ?'); params.push(b); meta.base_url = b; }
  if (req.body.enabled !== undefined) { sets.push('enabled = ?'); params.push(req.body.enabled ? 1 : 0); meta.enabled = Boolean(req.body.enabled); }
  if (req.body.native !== undefined) { const nt = req.body.native === 'gemini' ? 'gemini' : ''; sets.push('native = ?'); params.push(nt); meta.native = nt; }
  if (sets.length) await db.query(`UPDATE ai_providers SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  changed();
  await audit(req, 'admin.provider_updated', { actorId: req.user.id, targetType: 'provider', targetId: id, meta });
  return [200, { ok: true }];
});

// API keys: Super Admin only. Stored encrypted; only the last 4 characters are kept in clear for the mask.
r.post('/admin/providers/:id/key', requireRole('super_admin'), async (req) => {
  const id = String(req.params.id);
  if (!ID_RE.test(id)) deny(404, 'not_found', 'Provider not found.');
  if (!routingDefault.providers()[id] && !(await db.one('SELECT id FROM ai_providers WHERE id = ?', [id]))) deny(404, 'not_found', 'Provider not found.');
  await upsertProvider(id, {});
  const key = req.body.api_key == null ? '' : String(req.body.api_key).trim();
  if (!key) {
    await db.query('UPDATE ai_providers SET api_key_enc = NULL, key_last4 = NULL WHERE id = ?', [id]);
    await audit(req, 'admin.provider_key_cleared', { actorId: req.user.id, targetType: 'provider', targetId: id });
  } else {
    if (key.length < 8 || key.length > 400 || /\s/.test(key)) v.fail('api_key', 'That doesn’t look like an API key.');
    await db.query('UPDATE ai_providers SET api_key_enc = ?, key_last4 = ? WHERE id = ?', [encrypt(key), key.slice(-4), id]);
    await audit(req, 'admin.provider_key_set', { actorId: req.user.id, targetType: 'provider', targetId: id });
  }
  changed();
  return [200, { ok: true }];
});

// Removes the database row: a built-in provider goes back to its environment settings; a custom one is gone.
r.delete('/admin/providers/:id', requireRole('admin'), async (req) => {
  const id = String(req.params.id);
  const row = await db.one('SELECT id, api_key_enc IS NOT NULL AS has_key FROM ai_providers WHERE id = ?', [id]);
  if (!row) deny(404, 'not_found', 'Nothing to reset for this provider.');
  if (Number(row.has_key) && !isSuper(req)) deny(403, 'forbidden', 'This provider has a stored API key. Only a Super Admin can remove it.');
  await db.query('DELETE FROM ai_providers WHERE id = ?', [id]);
  changed();
  await audit(req, 'admin.provider_deleted', { actorId: req.user.id, targetType: 'provider', targetId: id });
  return [200, { ok: true }];
});

/* ---------- Models (slots like "qwen", "deepseek": provider + model id, in order) ---------- */
function defaultModelRows() {
  const out = [];
  for (const [target, list] of Object.entries(routingDefault.targets())) {
    list.forEach((t, i) => { if (t.model) out.push({ target, provider_id: t.provider, model: t.model, vision: t.vision ? 1 : 0, body: t.body ? JSON.stringify(t.body) : null, enabled: 1, priority: i }); });
  }
  return out;
}

r.get('/admin/models', requireRole('admin'), async () => {
  const rows = await db.query('SELECT id, target, provider_id, model, vision, body, enabled, priority, updated_at FROM ai_models ORDER BY target, priority, id');
  const out = rows.length ? rows : defaultModelRows().map((x, i) => ({ id: null, key: i, ...x }));
  let bench = [];
  try {
    bench = await db.query("SELECT provider, model, score, status, created_at FROM eval_runs WHERE kind = 'bench' ORDER BY created_at DESC LIMIT 500");
  } catch { /* before migration 0005 */ }
  const latest = {};
  for (const b of bench) { const k = `${b.provider}:${b.model}`; if (!latest[k]) latest[k] = { score: b.score == null ? null : Number(b.score), status: b.status, at: b.created_at }; }
  return [200, {
    bench_gate: { enabled: benchGate.enabled(), max_age_days: benchGate.maxAgeDays() },
    source: rows.length ? 'database' : 'default',
    models: out.map(m => ({ ...m, vision: Boolean(Number(m.vision)), enabled: Boolean(Number(m.enabled)), benchmark: latest[`${m.provider_id}:${m.model}`] || null })),
    providers: Object.keys({ ...routingDefault.providers(), ...Object.fromEntries((await db.query('SELECT id FROM ai_providers')).map(p => [p.id, 1])) }),
  }];
});

async function seedModels(req) {
  const [{ c }] = await db.query('SELECT COUNT(*) AS c FROM ai_models');
  if (Number(c)) return false;
  for (const m of defaultModelRows()) {
    await db.query('INSERT INTO ai_models (target, provider_id, model, vision, body, enabled, priority) VALUES (?,?,?,?,?,?,?)',
      [m.target, m.provider_id, m.model, m.vision, m.body, m.enabled, m.priority]);
  }
  await audit(req, 'admin.models_seeded', { actorId: req.user.id });
  return true;
}

r.post('/admin/models/seed', requireRole('admin'), async (req) => {
  const seeded = await seedModels(req);
  changed();
  return [200, { ok: true, seeded }];
});

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
  if (b.priority !== undefined) { const p = Number(b.priority); if (!Number.isInteger(p) || p < 0 || p > 99) v.fail('priority', 'Use 0–99 (lower is tried first).'); out.priority = p; }
  if (b.body !== undefined) {
    if (b.body === null || b.body === '') out.body = null;
    else {
      let parsed = b.body;
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { v.fail('body', 'Request options must be valid JSON.'); } }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) v.fail('body', 'Request options must be a JSON object.');
      const s = JSON.stringify(parsed);
      if (s.length > 2000) v.fail('body', 'Request options are too long.');
      out.body = s;
    }
  }
  return out;
}

r.post('/admin/models', requireRole('admin'), async (req) => {
  await seedModels(req);  // the first edit copies the built-in table into the database
  const m = await cleanModel(req.body);
  if (m.enabled === undefined || m.enabled) await gateModel(req, m.provider_id, m.model);
  const res = await db.query('INSERT INTO ai_models (target, provider_id, model, vision, body, enabled, priority) VALUES (?,?,?,?,?,?,?)',
    [m.target, m.provider_id, m.model, m.vision || 0, m.body || null, m.enabled === undefined ? 1 : m.enabled, m.priority || 0]);
  changed();
  await audit(req, 'admin.model_created', { actorId: req.user.id, targetType: 'model', targetId: res.insertId, meta: { target: m.target, provider: m.provider_id, model: m.model } });
  return [201, { ok: true, id: res.insertId }];
});

r.patch('/admin/models/:id', requireRole('admin'), async (req) => {
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
  if (keys.length) await db.query(`UPDATE ai_models SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => m[k]), id]);
  changed();
  await audit(req, 'admin.model_updated', { actorId: req.user.id, targetType: 'model', targetId: id, meta: m });
  return [200, { ok: true }];
});

r.delete('/admin/models/:id', requireRole('admin'), async (req) => {
  const id = Number(req.params.id);
  const res = await db.query('DELETE FROM ai_models WHERE id = ?', [id]);
  if (!res.affectedRows) deny(404, 'not_found', 'Model not found.');
  changed();
  await audit(req, 'admin.model_deleted', { actorId: req.user.id, targetType: 'model', targetId: id });
  return [200, { ok: true }];
});

/* ---------- Routing: ordered model slots per mode + hedge ---------- */
const ROUTE_LABELS = { general: 'General (Saga)', study: 'Study', developer: 'Developer', research: 'Research', african: 'African languages (Naijá, Yorùbá, Hausa, Igbo)' };

r.get('/admin/routing', requireRole('admin'), async () => {
  const cfg = await dynamic.load();
  const saved = await settings.get('routing');
  const providers = ai.enabledProviders(cfg);
  const targets = Object.fromEntries(Object.entries(cfg.targets()).map(([k, list]) => [k, list.map(t => ({ provider: t.provider, model: t.model, live: Boolean(providers[t.provider] && t.model) }))]));
  return [200, {
    routes: cfg.routes, hedge: cfg.hedge || config.chat.hedge, labels: ROUTE_LABELS, targets,
    defaults: { routes: routingDefault.routes, hedge: config.chat.hedge }, saved: Boolean(saved), source: cfg.source, cache_seconds: dynamic.TTL_MS / 1000,
  }];
});

r.patch('/admin/routing', requireRole('admin'), async (req) => {
  const cfg = await dynamic.load();
  const known = new Set(Object.keys(cfg.targets()));
  const routes = {};
  const body = req.body.routes && typeof req.body.routes === 'object' ? req.body.routes : {};
  for (const mode of dynamic.MODES) {
    if (body[mode] === undefined) { routes[mode] = cfg.routes[mode]; continue; }
    if (!Array.isArray(body[mode])) v.fail(`routes.${mode}`, 'Send an ordered list of model slots.');
    const list = [...new Set(body[mode].map(String))].slice(0, 10);
    if (!list.length) v.fail(`routes.${mode}`, `${ROUTE_LABELS[mode]} needs at least one model.`);
    const bad = list.filter(n => !known.has(n));
    if (bad.length) v.fail(`routes.${mode}`, `Unknown model slot: ${bad.join(', ')}.`);
    routes[mode] = list;
  }
  // A new first choice for a mode (e.g. a new Saga default) is a model change: each of its models needs a fresh benchmark.
  for (const mode of dynamic.MODES) {
    const first = routes[mode][0];
    if (first === cfg.routes[mode][0]) continue;
    for (const t of cfg.targets()[first] || []) if (t.model) await gateModel(req, t.provider, t.model);
  }
  let hedge = req.body.hedge === undefined ? (cfg.hedge || config.chat.hedge) : Number(req.body.hedge);
  if (!Number.isInteger(hedge) || hedge < 1 || hedge > 4) v.fail('hedge', 'Use 1 to 4 models at once.');
  await settings.set('routing', { routes, hedge }, req.user.id);
  changed();
  await audit(req, 'admin.routing_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'routing', meta: { routes, hedge } });
  return [200, { ok: true }];
});

r.delete('/admin/routing', requireRole('admin'), async (req) => {
  await settings.remove('routing');
  changed();
  await audit(req, 'admin.routing_reset', { actorId: req.user.id, targetType: 'setting', targetId: 'routing' });
  return [200, { ok: true }];
});

/* ---------- Usage and limits ---------- */
r.get('/admin/limits', requireRole('admin'), async () => {
  const eff = await limits.effective();
  const overrides = await db.query('SELECT l.user_id, l.daily_limit, u.email, u.name FROM user_limits l JOIN users u ON u.id = l.user_id ORDER BY l.updated_at DESC LIMIT 100');
  const usage = await db.query(
    `SELECT CASE WHEN subject LIKE 'u:%' THEN 'users' WHEN subject LIKE 'gi:%' THEN 'guest_ips' ELSE 'guests' END AS kind,
            COUNT(*) AS subjects, SUM(requests) AS requests
       FROM chat_usage WHERE day = UTC_DATE() AND subject NOT LIKE '%:%:%' GROUP BY kind`);
  return [200, {
    limits: { user: eff.dailyLimit, guest: eff.guestDailyLimit, guestIp: eff.guestIpDailyLimit, modes: eff.modes },
    defaults: { user: config.chat.dailyLimit, guest: config.chat.guestDailyLimit, guestIp: config.chat.guestIpDailyLimit },
    overrides, today: Object.fromEntries(usage.map(u => [u.kind, { subjects: Number(u.subjects), requests: Number(u.requests || 0) }])),
  }];
});

r.patch('/admin/limits', requireRole('admin'), async (req) => {
  const b = req.body;
  const int = (x, field) => { const k = Number(x); if (!Number.isInteger(k) || k < 0 || k > 1000000) v.fail(field, 'Use a whole number (0 or more).'); return k; };
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
  await audit(req, 'admin.limits_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'limits', meta: next });
  return [200, { ok: true }];
});

/* ---------- Evaluation (stub runs; full benchmarks are Phase 5) + feedback per model ---------- */
r.get('/admin/evaluation', requireRole('admin'), async () => {
  let runs;
  try {
    runs = await db.query('SELECT r.id, r.name, r.model, r.provider, r.kind, r.suite, r.status, r.score, r.items, r.error_rate, r.first_token_ms, r.details, r.notes, r.created_at, u.email AS created_by FROM eval_runs r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.created_at DESC, r.id DESC LIMIT 100');
  } catch {   // before migration 0005
    runs = await db.query('SELECT r.id, r.name, r.model, r.status, r.score, r.notes, r.created_at, u.email AS created_by FROM eval_runs r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.id DESC LIMIT 100');
  }
  const feedback = await db.query(
    `SELECT COALESCE(provider, '') AS provider, COALESCE(provider_model, '') AS model, SUM(rating = 'up') AS up, SUM(rating = 'down') AS down
       FROM chat_feedback WHERE created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY provider, provider_model ORDER BY COUNT(*) DESC LIMIT 30`);
  const reasons = await db.query(
    "SELECT reason, COUNT(*) AS n FROM chat_feedback WHERE rating = 'down' AND created_at > UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY reason ORDER BY n DESC");
  return [200, {
    runs: runs.map(x => ({ ...x, score: x.score == null ? null : Number(x.score), ...(x.error_rate !== undefined ? { error_rate: x.error_rate == null ? null : Number(x.error_rate), details: typeof x.details === 'string' ? JSON.parse(x.details || 'null') : x.details } : {}) })),
    feedback: feedback.map(f => ({ provider: f.provider, model: f.model, up: Number(f.up || 0), down: Number(f.down || 0) })),
    reasons: reasons.map(x => ({ reason: x.reason || 'Other', n: Number(x.n) })),
  }];
});

r.post('/admin/evaluation/runs', requireRole('admin'), async (req) => {
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!name) v.fail('name', 'Name the benchmark run.');
  const model = String(req.body.model || '').trim().slice(0, 128);
  const status = ['planned', 'running', 'done', 'failed'].includes(req.body.status) ? req.body.status : 'planned';
  let score = null;
  if (req.body.score !== undefined && req.body.score !== null && req.body.score !== '') {
    score = Number(req.body.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) v.fail('score', 'Use a score from 0 to 100.');
  }
  const notes = req.body.notes ? String(req.body.notes).slice(0, 1000) : null;
  const res = await db.query('INSERT INTO eval_runs (name, model, status, score, notes, created_by) VALUES (?,?,?,?,?,?)', [name, model, status, score, notes, req.user.id]);
  await audit(req, 'admin.eval_run_created', { actorId: req.user.id, targetType: 'eval_run', targetId: res.insertId, meta: { name, model, status, score } });
  return [201, { ok: true, id: res.insertId }];
});

// Imports a Colon benchmark run (bench/results/<run>.eval.json from scripts/bench.js): one eval_runs row per model.
r.post('/admin/evaluation/bench', requireRole('admin'), async (req) => {
  const list = Array.isArray(req.body.runs) ? req.body.runs.slice(0, 40) : null;
  if (!list || !list.length) v.fail('runs', 'Send the runs from bench/results/<run>.eval.json.');
  const rows = list.map((x, i) => {
    if (!x || typeof x !== 'object') v.fail(`runs.${i}`, 'Each run needs a provider and a model.');
    const at = new Date(x.created_at);
    const score = Number(x.score);
    if (!x || typeof x.model !== 'string' || !x.model || typeof x.provider !== 'string' || !ID_RE.test(x.provider)) v.fail(`runs.${i}`, 'Each run needs a provider and a model.');
    if (!Number.isFinite(score) || score < 0 || score > 100) v.fail(`runs.${i}.score`, 'Use a score from 0 to 100.');
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 5 * 60e3) v.fail(`runs.${i}.created_at`, 'Give when the run finished.');
    return {
      name: String(x.name || 'Colon benchmark').slice(0, 120), model: x.model.slice(0, 128), provider: x.provider, kind: 'bench', suite: String(x.suite || '').slice(0, 32),
      status: x.status === 'done' ? 'done' : 'failed', score, items: Math.max(0, Math.round(Number(x.items) || 0)),
      error_rate: Number.isFinite(Number(x.error_rate)) ? Number(x.error_rate) : null, first_token_ms: Number.isFinite(Number(x.first_token_ms)) ? Math.round(Number(x.first_token_ms)) : null,
      notes: x.notes ? String(x.notes).slice(0, 1000) : null, details: x.details && typeof x.details === 'object' ? JSON.stringify(x.details).slice(0, 20000) : null, created_at: at,
    };
  });
  const ids = [];
  for (const r of rows) {
    const res = await db.query('INSERT INTO eval_runs (name, model, provider, kind, suite, status, score, items, error_rate, first_token_ms, notes, details, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [r.name, r.model, r.provider, r.kind, r.suite, r.status, r.score, r.items, r.error_rate, r.first_token_ms, r.notes, r.details, req.user.id, r.created_at]);
    ids.push(res.insertId);
  }
  await audit(req, 'admin.bench_imported', { actorId: req.user.id, targetType: 'eval_run', targetId: ids[0], meta: { runs: rows.length, name: rows[0].name } });
  return [201, { ok: true, ids }];
});

r.delete('/admin/evaluation/runs/:id', requireRole('admin'), async (req) => {
  const res = await db.query('DELETE FROM eval_runs WHERE id = ?', [Number(req.params.id)]);
  if (!res.affectedRows) deny(404, 'not_found', 'Run not found.');
  await audit(req, 'admin.eval_run_deleted', { actorId: req.user.id, targetType: 'eval_run', targetId: req.params.id });
  return [200, { ok: true }];
});

module.exports = r;
module.exports.defaultModelRows = defaultModelRows;
