// Model router v1: picks the provider chain for a request (mode + reply language + model), streams the
// reply, and falls back automatically when a provider fails, hits its quota (429) or times out before
// the first token. The routing table lives in ./routing.js.
const routingDefault = require('./routing');
const { streamChat, ProviderError } = require('./client');
const { systemPrompt } = require('./prompts');
const log = require('../lib/logger');
const config = require('../config');

// In-memory "rest" per worker: a target that just failed is tried last for a while, so one dead free
// model doesn't add seconds to every reply. It is still tried as a last resort.
const resting = new Map();
const REST_MS = { rate_limited: 60e3, model_not_found: 10 * 60e3, auth: 10 * 60e3, payment_required: 10 * 60e3, timeout: 30e3, upstream_error: 30e3 };
const keyOf = (c) => `${c.providerId}|${c.model}`;

function enabledProviders(cfg = routingDefault) {
  const all = cfg.providers();
  const out = {};
  for (const [id, p] of Object.entries(all)) {
    if (p.apiKey && (!p.needsBaseUrl || p.baseUrl)) out[id] = { id, ...p };
  }
  return out;
}

function chainFor({ mode = 'general', language = 'en', model = null, needsVision = false } = {}, cfg = routingDefault, now = Date.now()) {
  const providers = enabledProviders(cfg);
  const targets = cfg.targets();
  const african = cfg.africanLanguages.includes(language);
  const def = cfg.models.find(m => m.id === model);
  const names = african ? cfg.routes.african : (def && def.route) || cfg.routes[mode] || cfg.routes.general;
  const seen = new Set();
  const chain = [];
  for (const name of names) {
    for (const t of targets[name] || []) {
      const p = providers[t.provider];
      if (!p || !t.model) continue;
      if (needsVision && !t.vision) continue;
      const c = { target: name, providerId: t.provider, providerName: p.name, provider: p, model: t.model, vision: Boolean(t.vision), body: t.body || null };
      if (seen.has(keyOf(c))) continue;
      seen.add(keyOf(c));
      chain.push(c);
    }
  }
  const awake = chain.filter(c => !(resting.get(keyOf(c)) > now));
  const asleep = chain.filter(c => resting.get(keyOf(c)) > now);
  return awake.concat(asleep);
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

const needsVisionFor = (messages) => messages.some(m => Array.isArray(m.content) && m.content.some(p => p && p.type === 'image_url'));

/**
 * generate({ mode, language, model, name, messages, signal, onDelta, onAttempt })
 *   messages: OpenAI-style history WITHOUT the system prompt (added here).
 *   -> { text, providerId, providerName, model, target, attempts }
 * Errors carry .code: 'no_provider' | 'no_vision' | 'provider_down' (after fallback) | AbortError (Stop).
 */
async function generate(o) {
  const cfg = o.routing || routingDefault;
  const timeouts = { ...config.chat, ...(o.timeouts || {}) };
  if (!isConfigured(cfg)) {
    throw Object.assign(new Error('Colon Saga isn’t connected to an AI provider yet.'), { status: 503, code: 'no_provider' });
  }
  const needsVision = needsVisionFor(o.messages);
  const chain = chainFor({ mode: o.mode, language: o.language, model: o.model, needsVision }, cfg);
  if (!chain.length) {
    throw Object.assign(new Error(needsVision
      ? 'Image reading isn’t switched on yet: no vision-capable model is configured. Describe the image in words, or attach a PDF or text file instead.'
      : 'Colon Saga isn’t connected to an AI provider yet.'), { status: 503, code: needsVision ? 'no_vision' : 'no_provider' });
  }
  const messages = [{ role: 'system', content: systemPrompt({ mode: o.mode, language: o.language, name: o.name }) }, ...o.messages];
  const attempts = [];
  for (const c of chain) {
    if (o.signal && o.signal.aborted) break;
    if (o.onAttempt) o.onAttempt(c);
    const started = Date.now();
    let text = '';
    try {
      await streamChat({
        provider: c.provider, model: c.model, body: c.body, messages, signal: o.signal, fetch: o.fetch,
        maxTokens: timeouts.maxTokens, temperature: o.temperature,
        firstTokenTimeoutMs: timeouts.firstTokenTimeoutMs, idleTimeoutMs: timeouts.idleTimeoutMs, maxMs: timeouts.maxReplyMs,
        onDelta: (piece) => { text += piece; if (o.onDelta) o.onDelta(piece); },
      });
      attempts.push({ provider: c.providerId, model: c.model, ok: true, ms: Date.now() - started });
      resting.delete(keyOf(c));
      return { text, providerId: c.providerId, providerName: c.providerName, model: c.model, target: c.target, attempts };
    } catch (e) {
      if (e.name === 'AbortError') { e.partialText = text; e.attempts = attempts; e.providerId = c.providerId; e.model = c.model; throw e; }
      attempts.push({ provider: c.providerId, model: c.model, ok: false, code: e.code, status: e.status, ms: Date.now() - started });
      if (REST_MS[e.code]) resting.set(keyOf(c), Date.now() + REST_MS[e.code]);
      log.warn('ai_provider_failed', { provider: c.providerId, model: c.model, code: e.code, status: e.status, partial: Boolean(e.partial), err: String(e.message).slice(0, 200) });
      if (e.partial) {
        // Text already reached the user: no silent switch to another model mid-answer.
        throw Object.assign(new ProviderError('The connection to the AI provider dropped before the reply finished.', { code: 'provider_down', partial: true }),
          { status: 502, partialText: text, attempts, providerId: c.providerId, model: c.model });
      }
    }
  }
  if (o.signal && o.signal.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; a.partialText = ''; a.attempts = attempts; throw a; }
  throw Object.assign(new ProviderError('Colon Saga couldn’t reach an AI provider right now. Please try again in a moment.', { code: 'provider_down' }), { status: 503, attempts });
}

module.exports = { generate, chainFor, listModels, isConfigured, hasVision, enabledProviders, _resting: resting };
