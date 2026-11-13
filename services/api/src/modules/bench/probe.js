// Benchmark preflight: one tiny request per model, to see before a long run whether each endpoint answers at all and
// how: HTTP status, seconds to response headers (a long wait here = the free tier is queueing), to the first
// reasoning chunk and to the first answer text, and the finish reason. `npm run bench -- --probe [--models ...]`.
const { streamChat } = require('../ai').client;
const { bodyOf, keyOf } = require('./candidates');
const retry = require('./retry');

/** probe(candidate, { providerConfig, fetch, firstTokenTimeoutMs, maxTokens }) -> one result line object */
async function probe(c, o) {
  const t0 = Date.now();
  let headersMs = null, reasonMs = null, firstMs = null;
  const base = o.fetch || globalThis.fetch;
  const fetch = async (url, init) => { const r = await base(url, init); headersMs = Date.now() - t0; return r; };
  const opts = { ...o, ...(c.opts || {}), ...(o.force || {}) };
  try {
    const r = await streamChat({
      provider: o.providerConfig(c.provider), model: c.model, body: bodyOf(c), fetch,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: opts.maxTokens || 2048,
      firstTokenTimeoutMs: opts.firstTokenTimeoutMs || 60000, idleTimeoutMs: 60000, maxMs: opts.maxMs || 240000,
      onReasoning: () => { if (reasonMs === null) reasonMs = Date.now() - t0; },
      onDelta: () => { if (firstMs === null) firstMs = Date.now() - t0; },
    });
    return { key: keyOf(c), ok: true, headers_ms: headersMs, first_reasoning_ms: reasonMs, first_token_ms: firstMs,
      total_ms: Date.now() - t0, finish: r.finishReason || null, reply: String(r.text).slice(0, 60) };
  } catch (e) {
    return { key: keyOf(c), ok: false, headers_ms: headersMs, first_reasoning_ms: reasonMs, first_token_ms: firstMs,
      total_ms: Date.now() - t0, error: retry.reason(e, { ms: Date.now() - t0 }) };
  }
}

const s = (ms) => (ms === null || ms === undefined ? '–' : `${(ms / 1000).toFixed(1)}s`);
const line = (p) => `${p.ok ? 'OK  ' : 'FAIL'} ${p.key}  headers ${s(p.headers_ms)}  reasoning ${s(
  p.first_reasoning_ms)}  answer ${s(p.first_token_ms)}  total ${s(p.total_ms)}${p.ok ? `  finish ${p.finish}` : `  ${
  p.error}`}`;

module.exports = { probe, line };
