// Model router v1: picks the provider chain for a request (mode + reply language + model), streams the
// reply, and falls back automatically when a provider fails, hits its quota (429) or times out before
// the first token. The routing table lives in ./routing.js.
const routingDefault = require('./routing');
const { streamChat, ProviderError } = require('./client');
const { systemPrompt } = require('./prompts');
const log = require('../../shared/logger');
const config = require('../../config');

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
 * generate({ mode, language, model, name, messages, signal, onDelta, onAttempt, web, context })
 *   messages: OpenAI-style history WITHOUT the system prompt (added here).
 *   web/context: Research mode web search — numbered sources appended to the system prompt (src/search).
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
  const messages = [{ role: 'system', content: systemPrompt({ mode: o.mode, language: o.language, name: o.name, web: Boolean(o.web), context: o.context }) }, ...o.messages];
  const attempts = [];
  // Hedged racing: free hosts are often slow to start, so each "wave" asks up to `hedge` models at once
  // (different providers first) and keeps whichever starts answering first; the others are cancelled.
  // If every model in a wave fails before its first token, the next wave starts. AI_HEDGE=1 = one at a time.
  const hedge = Math.max(1, Number(timeouts.hedge || 1));
  const won = await race(orderForHedge(chain, hedge), hedge, { o, messages, timeouts, attempts });
  if (won) return won;
  if (o.signal && o.signal.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; a.partialText = ''; a.attempts = attempts; throw a; }
  throw Object.assign(new ProviderError('Colon Saga couldn’t reach an AI provider right now. Please try again in a moment.', { code: 'provider_down' }), { status: 503, attempts });
}

// Puts targets from different providers into the same wave, so one busy host doesn't sink a whole wave.
function orderForHedge(chain, hedge) {
  if (hedge < 2) return chain.slice();
  const rest = chain.slice(), out = [];
  while (rest.length) {
    const wave = [], used = new Set();
    for (let i = 0; i < rest.length && wave.length < hedge; i++) {
      if (!used.has(rest[i].providerId)) { used.add(rest[i].providerId); wave.push(rest.splice(i, 1)[0]); i--; }
    }
    while (wave.length < hedge && rest.length) wave.push(rest.shift());
    out.push(...wave);
  }
  return out;
}

// Keeps up to `hedge` models working at once. The first to send real text wins and the rest are cancelled.
// When one fails before answering, the next target starts straight away (no waiting for the slow one).
// A quick 5xx (Google's free tier throws these at random) is retried once on the same model.
// Resolves with the winner's result, or null when every target failed before answering.
// Rejects when the user stopped, or when the winning model broke mid-answer.
function race(queue, hedge, { o, messages, timeouts, attempts }) {
  queue = queue.slice();
  return new Promise((resolve, reject) => {
    let winner = null, settled = false, running = 0;
    const live = new Map();             // AbortController -> target, for every call in flight
    const retried = new Set();
    const onOuter = () => live.forEach((_, ctl) => ctl.abort());
    if (o.signal) o.signal.addEventListener('abort', onOuter, { once: true });
    const finish = (fn, v) => {
      if (settled) return; settled = true;
      if (o.signal) o.signal.removeEventListener('abort', onOuter);
      fn(v);
    };
    const fill = () => {
      while (!settled && winner === null && running < hedge && queue.length && !(o.signal && o.signal.aborted)) start(queue.shift());
      if (!settled && winner === null && running === 0) {
        if (o.signal && o.signal.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; a.partialText = ''; a.attempts = attempts; finish(reject, a); }
        else finish(resolve, null);
      }
    };
    const start = (c) => {
      const ctl = new AbortController();
      live.set(ctl, c); running++;
      if (o.onAttempt) o.onAttempt(c);
      const started = Date.now();
      let text = '';
      const claim = () => {
        if (winner !== null) return winner === ctl;
        winner = ctl;
        live.forEach((_, other) => { if (other !== ctl) other.abort(); });
        return true;
      };
      streamChat({
        provider: c.provider, model: c.model, body: c.body, messages, signal: ctl.signal, fetch: o.fetch,
        maxTokens: timeouts.maxTokens, temperature: o.temperature,
        firstTokenTimeoutMs: timeouts.firstTokenTimeoutMs, idleTimeoutMs: timeouts.idleTimeoutMs, maxMs: timeouts.maxReplyMs,
        onDelta: (piece) => { if (!claim()) return; text += piece; if (o.onDelta) o.onDelta(piece); },
      }).then(() => {
        live.delete(ctl); running--;
        if (!claim()) return;
        attempts.push({ provider: c.providerId, model: c.model, ok: true, ms: Date.now() - started });
        resting.delete(keyOf(c));
        log.warn('ai_reply_ok', { provider: c.providerId, model: c.model, ms: Date.now() - started, tried: attempts.length });
        finish(resolve, { text, providerId: c.providerId, providerName: c.providerName, model: c.model, target: c.target, attempts });
      }, (e) => {
        live.delete(ctl); running--;
        if (winner !== null && winner !== ctl) return;            // a slower model we cancelled
        if (e.name === 'AbortError') {
          if (o.signal && o.signal.aborted) {
            e.partialText = text; e.attempts = attempts; e.providerId = c.providerId; e.model = c.model;
            return finish(reject, e);
          }
          return fill();
        }
        const ms = Date.now() - started;
        attempts.push({ provider: c.providerId, model: c.model, ok: false, code: e.code, status: e.status, ms });
        log.warn('ai_provider_failed', { provider: c.providerId, model: c.model, code: e.code, status: e.status, ms, partial: Boolean(e.partial), err: String(e.message).slice(0, 200) });
        if (winner === ctl) {
          // Text already reached the user: no silent switch to another model mid-answer.
          return finish(reject, Object.assign(new ProviderError('The connection to the AI provider dropped before the reply finished.', { code: 'provider_down', partial: true }),
            { status: 502, partialText: text, attempts, providerId: c.providerId, model: c.model }));
        }
        const transient = e.code === 'upstream_error' && (e.status >= 500 || !e.status) && ms < 5000;
        if (transient && !retried.has(keyOf(c))) { retried.add(keyOf(c)); queue.unshift(c); }
        else if (REST_MS[e.code]) resting.set(keyOf(c), Date.now() + REST_MS[e.code]);
        fill();
      });
    };
    fill();
  });
}

module.exports = { generate, chainFor, listModels, isConfigured, hasVision, enabledProviders, _resting: resting };
