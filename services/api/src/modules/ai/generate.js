// Model router v1: picks the provider chain for a request (mode + reply language + model), streams the
// reply, and falls back automatically when a provider fails, hits its quota (429) or times out before
// the first token. The routing table lives in ./routing.js.
const routingDefault = require('./routing');
const { ProviderError } = require('./client');
const { orderForHedge, race, resting, keyOf } = require('./hedge');
const { systemPrompt } = require('./prompts');
const { classify } = require('./classify');
const specialists = require('./specialists');
const config = require('../../config');

function enabledProviders(cfg = routingDefault) {
  const all = cfg.providers();
  const out = {};
  for (const [id, p] of Object.entries(all)) {
    if (p.apiKey && (!p.needsBaseUrl || p.baseUrl)) out[id] = { id, ...p };
  }
  return out;
}

// category (from classify.js): when specialist routing is on, the category's specialist leads the chain and weak
// slots go last (specialists.js); the chain carries .route ('specialist:<category>' | 'default:<category>' |
// 'default') and .demoted for the log line and hedging. Without a category the chain is the plain route.
function chainFor({ mode = 'general', language = 'en', model = null, needsVision = false, category = null } = {},
  cfg = routingDefault, now = Date.now()) {
  const providers = enabledProviders(cfg);
  const targets = cfg.targets();
  const african = cfg.africanLanguages.includes(language);
  const def = cfg.models.find(m => m.id === model);
  let names = african ? cfg.routes.african : (def && def.route) || cfg.routes[mode] || cfg.routes.general;
  let route = 'default', demoted = [];
  if (category && specialists.enabledFor(cfg)) {
    const decision = specialists.tableFor(cfg).categories[category];
    const ordered = specialists.apply(names, decision);
    route = `${decision && ordered[0] !== names[0] && ordered[0] === decision.specialist ? 'specialist'
      : 'default'}:${category}`;
    demoted = decision ? (decision.demoted || []).filter(n => ordered.includes(n)) : [];
    names = ordered;
  }
  const seen = new Set();
  const chain = [];
  for (const name of names) {
    for (const t of targets[name] || []) {
      const p = providers[t.provider];
      if (!p || !t.model) continue;
      if (needsVision && !t.vision) continue;
      const c = { target: name, providerId: t.provider, providerName: p.name, provider: p, model: t.model,
        vision: Boolean(t.vision), body: t.body || null, ...(demoted.includes(name) ? { demoted: true } : {}) };
      if (seen.has(keyOf(c))) continue;
      seen.add(keyOf(c));
      chain.push(c);
    }
  }
  const awake = chain.filter(c => !(resting.get(keyOf(c)) > now));
  const asleep = chain.filter(c => resting.get(keyOf(c)) > now);
  return Object.assign(awake.concat(asleep), { route });
}

function isConfigured(cfg = routingDefault) {
  const providers = enabledProviders(cfg);
  const targets = cfg.targets();
  return Object.values(targets).some(list => list.some(t => providers[t.provider] && t.model));
}

function hasVision(cfg = routingDefault) {
  const providers = enabledProviders(cfg);
  return Object.values(cfg.targets()).some(list => list.some(t => t.vision && providers[t.provider]));
}

function listModels(cfg = routingDefault) {
  const ready = isConfigured(cfg);
  const vision = hasVision(cfg);
  return cfg.models.map(m => ({
    id: m.id,
    name: m.name,
    description: m.description,
    available: ready && !m.comingSoon,
    status: m.comingSoon ? 'coming_soon' : ready ? 'available' : 'unavailable',
    default: Boolean(m.default),
    capabilities: m.comingSoon || !vision ? m.capabilities : [...m.capabilities, 'vision'],
  }));
}

const needsVisionFor = (messages) => messages.some(m => Array.isArray(m.content) && m.content.some(p => p
  && p.type === 'image_url'));

/**
 * generate({ mode, language, model, name, messages, signal, onDelta, onAttempt, web, context })
 *   messages: OpenAI-style history WITHOUT the system prompt (added here).
 *   web/context: Research mode web search — numbered sources appended to the system prompt (src/modules/search).
 *   taskText/attachments/category: what the specialist classifier reads (default: the last user message)
 *   -> { text, providerId, providerName, model, target, attempts, route, category }
 * Errors carry .code: 'no_provider' | 'no_vision' | 'provider_down' (after fallback) | AbortError (Stop).
 */
async function generate(o) {
  const cfg = o.routing || routingDefault;
  // Developer mode gets a larger output cap (whole files of code); explicit o.timeouts.maxTokens still wins.
  const timeouts = { ...config.chat, ...(o.mode === 'developer' && config.chat.developerMaxTokens
    ? { maxTokens: config.chat.developerMaxTokens } : {}), ...(o.timeouts || {}) };
  if (!isConfigured(cfg)) {
    throw Object.assign(new Error('Colon Saga isn’t connected to an AI provider yet.'), { status: 503,
      code: 'no_provider' });
  }
  const needsVision = needsVisionFor(o.messages);
  // Specialist routing: a cheap rule-based look at the message picks the category (no model call).
  const task = o.category ? { category: o.category } : classify({ mode: o.mode, language: o.language,
    messages: o.messages, text: o.taskText, attachments: o.attachments, web: o.web });
  const chain = chainFor({ mode: o.mode, language: o.language, model: o.model, needsVision, category: task.category },
    cfg);
  if (!chain.length) {
    throw Object.assign(new Error(needsVision
      ? ('Image reading isn’t switched on yet: no vision-capable model is configured. Describe the image in words, '
        + 'or attach a PDF or text file instead.')
      : 'Colon Saga isn’t connected to an AI provider yet.'), { status: 503, code: needsVision
        ? 'no_vision' : 'no_provider' });
  }
  const messages = [{ role: 'system', content: systemPrompt({ mode: o.mode, language: o.language, name: o.name,
    web: Boolean(o.web), context: o.context }) }, ...o.messages];
  const attempts = [];
  // Hedged racing: free hosts are often slow to start, so each "wave" asks up to `hedge` models at once
  // (different providers first) and keeps whichever starts answering first; the others are cancelled.
  // If every model in a wave fails before its first token, the next wave starts. AI_HEDGE=1 = one at a time.
  const hedge = Math.max(1, Number(timeouts.hedge || 1));
  const won = await race(orderForHedge(chain, hedge), hedge, { o, messages, timeouts, attempts, route: chain.route });
  if (won) return { ...won, route: chain.route, category: task.category };
  if (o.signal && o.signal.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; a.partialText = '';
    a.attempts = attempts; throw a; }
  throw Object.assign(new ProviderError(
    'Colon Saga couldn’t reach an AI provider right now. Please try again in a moment.', { code: 'provider_down' }),
    { status: 503, attempts });
}

module.exports = { generate, chainFor, listModels, isConfigured, hasVision, enabledProviders, _resting: resting };
