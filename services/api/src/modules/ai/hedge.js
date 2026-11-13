// Hedged racing across models: waves of up to `hedge` models at once, first real token wins, the rest are
// cancelled; failed targets "rest" for a while so one dead free model doesn't slow every reply.
const { streamChat, ProviderError } = require('./client');
const log = require('../../shared/logger');

// In-memory "rest" per worker: a target that just failed is tried last for a while, so one dead free
// model doesn't add seconds to every reply. It is still tried as a last resort.
const resting = new Map();
const REST_MS = { rate_limited: 60e3, model_not_found: 10 * 60e3, auth: 10 * 60e3, payment_required: 10 * 60e3,
  timeout: 30e3, upstream_error: 30e3 };
const keyOf = (c) => `${c.providerId}|${c.model}`;

// Puts targets from different providers into the same wave, so one busy host doesn't sink a whole wave.
// Demoted targets (weak in this request's category, see specialists.js) are never pulled forward to fill a wave.
function orderForHedge(chain, hedge) {
  if (hedge < 2) return chain.slice();
  const rest = chain.slice(), out = [];
  while (rest.length) {
    const wave = [], used = new Set();
    for (let i = 0; i < rest.length && wave.length < hedge; i++) {
      if (rest[i].demoted && wave.length) continue;
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
function race(queue, hedge, { o, messages, timeouts, attempts, route }) {
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
      while (!settled && winner === null && running < hedge && queue.length && !(o.signal && o.signal.aborted)) start(
        queue.shift());
      if (!settled && winner === null && running === 0) {
        if (o.signal && o.signal.aborted) { const a = new Error('aborted'); a.name = 'AbortError'; a.partialText = '';
          a.attempts = attempts; finish(reject, a); }
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
        firstTokenTimeoutMs: timeouts.firstTokenTimeoutMs, idleTimeoutMs: timeouts.idleTimeoutMs,
          maxMs: timeouts.maxReplyMs,
        onDelta: (piece) => { if (!claim()) return; text += piece; if (o.onDelta) o.onDelta(piece); },
      }).then(() => {
        live.delete(ctl); running--;
        if (!claim()) return;
        attempts.push({ provider: c.providerId, model: c.model, ok: true, ms: Date.now() - started });
        resting.delete(keyOf(c));
        log.warn('ai_reply_ok', { provider: c.providerId, model: c.model, ms: Date.now() - started,
          tried: attempts.length, ...(route ? { route } : {}) });
        finish(resolve, { text, providerId: c.providerId, providerName: c.providerName, model: c.model,
          target: c.target, attempts });
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
        log.warn('ai_provider_failed', { provider: c.providerId, model: c.model, code: e.code, status: e.status, ms,
          partial: Boolean(e.partial), err: String(e.message).slice(0, 200) });
        if (winner === ctl) {
          // Text already reached the user: no silent switch to another model mid-answer.
          return finish(reject, Object.assign(new ProviderError(
            'The connection to the AI provider dropped before the reply finished.', { code: 'provider_down',
            partial: true }),
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

module.exports = { orderForHedge, race, resting, REST_MS, keyOf };
