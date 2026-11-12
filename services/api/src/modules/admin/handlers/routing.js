// Admin: live routing (handlers for src/http/routes/admin/routing.js).

const audit = require('../../../shared/audit');
const v = require('../../../shared/validate');
const settings = require('../../../shared/settings');
const config = require('../../../config');
const routingDefault = require('../../ai').routing;
const dynamic = require('../../ai').dynamic;
const ai = require('../../ai');
const { changed, gateModel } = require('./ai-common');

/* ---------- Routing: ordered model slots per mode + hedge ---------- */
const ROUTE_LABELS = { general: 'General (Saga)', study: 'Study', developer: 'Developer', research: 'Research',
  african: 'African languages (Naijá, Yorùbá, Hausa, Igbo)' };

// GET /admin/routing
const getAdminRouting = async () => {
  const cfg = await dynamic.load();
  const saved = await settings.get('routing');
  const providers = ai.enabledProviders(cfg);
  const targets = Object.fromEntries(Object.entries(cfg.targets()).map(([k, list]) => [k, list.map(t => ({
    provider: t.provider, model: t.model, live: Boolean(providers[t.provider] && t.model) }))]));
  return [200, {
    routes: cfg.routes, hedge: cfg.hedge || config.chat.hedge, labels: ROUTE_LABELS, targets,
    defaults: { routes: routingDefault.routes, hedge: config.chat.hedge }, saved: Boolean(saved), source: cfg.source,
      cache_seconds: dynamic.TTL_MS / 1000,
  }];
};

// PATCH /admin/routing
const patchAdminRouting = async (req) => {
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
  // A new first choice for a mode (e.g. a new Saga default) is a model change: each of its models needs a fresh
  // benchmark.
  for (const mode of dynamic.MODES) {
    const first = routes[mode][0];
    if (first === cfg.routes[mode][0]) continue;
    for (const t of cfg.targets()[first] || []) if (t.model) await gateModel(req, t.provider, t.model);
  }
  let hedge = req.body.hedge === undefined ? (cfg.hedge || config.chat.hedge) : Number(req.body.hedge);
  if (!Number.isInteger(hedge) || hedge < 1 || hedge > 4) v.fail('hedge', 'Use 1 to 4 models at once.');
  await settings.set('routing', { routes, hedge }, req.user.id);
  changed();
  await audit(req, 'admin.routing_updated', { actorId: req.user.id, targetType: 'setting', targetId: 'routing',
    meta: { routes, hedge } });
  return [200, { ok: true }];
};

// DELETE /admin/routing
const deleteAdminRouting = async (req) => {
  await settings.remove('routing');
  changed();
  await audit(req, 'admin.routing_reset', { actorId: req.user.id, targetType: 'setting', targetId: 'routing' });
  return [200, { ok: true }];
};

module.exports = { getAdminRouting, patchAdminRouting, deleteAdminRouting };
