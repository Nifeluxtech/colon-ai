// Tools module (0.17.0, Production Blueprint D14): the server-side tool registry and the router every tool call goes
// through (plan access, monthly counts, consent, credits via modules/billing, timeouts). Other modules use only this
// file:
//   invoke(name, args, ctx)     run one tool call under its policy (see invoke.js)
//   close({ user, requestId, ok })   settle or refund a deferred call (background work such as deep research)
//   declarations(names?)        Gemini function declarations for the chat model (only switched-on tools)
//   list()                      Admin › Tools: every tool's policy and this worker's call counts (read-only)
//   registry, create()          the shared registry; create() builds a separate one for tests
const config = require('../../config');
const log = require('../../shared/logger');
const registryLib = require('./registry');
const invokeLib = require('./invoke');
const { registerAll } = require('./catalogue');

const registry = registerAll(registryLib.create());
const router = invokeLib.create({ registry, engine: () => require('../billing').instance(),
  mode: () => config.billing.mode, log });

/** Tests: a router over its own registry and credit engine. */
function create({ registry: reg = registryLib.create(), engine, mode = 'shadow', logger = log } = {}) {
  return { registry: reg, ...invokeLib.create({ registry: reg, engine, mode, log: logger }) };
}

function list() {
  const stats = router.stats();
  // 0.17.1: image: the active image provider, its fallback and what edits use (Admin › Tools).
  return { billing_mode: config.billing.mode, image: require('../media').providers(),
    tools: registry.describe().map((t) => ({ ...t, stats: stats[t.name] || null })) };
}

module.exports = {
  registry, create, validate: registryLib.validate,
  invoke: (name, args, ctx) => router.invoke(name, args, ctx),
  close: (o) => router.close(o),
  declarations: (names) => registry.declarations(names),
  enabled: (name) => { const t = registry.get(name); return Boolean(t && registry.isOn(t)); },
  list, stats: () => router.stats(),
};
