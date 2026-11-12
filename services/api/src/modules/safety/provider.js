// Optional moderation endpoint (OpenAI-compatible POST /moderations: { model, input } -> { results: [{ flagged,
// categories: { 'sexual/minors': bool, … } }] }). Off by default (SAFETY_PROVIDER_MODERATION, Admin › Safety).
// It can only make a decision stricter, never looser. Fail OPEN: a timeout, HTTP error or bad JSON is logged
// and the message goes on with the rule decision alone. The child-safety rules run before it and never depend on it.
const log = require('../../shared/logger');
const config = require('../../config');

// Provider category -> our category and action ('refuse' or 'allow_with_care' + care key).
const MAP = [
  ['sexual/minors', { category: 'csam', action: 'refuse' }],
  ['self-harm/instructions', { category: 'self_harm', action: 'allow_with_care', care: 'self_harm',
    prefix: 'self_harm' }],
  ['self-harm/intent', { category: 'self_harm', action: 'allow_with_care', care: 'self_harm', prefix: 'self_harm' }],
  ['self-harm', { category: 'self_harm', action: 'allow_with_care', care: 'self_harm', prefix: 'self_harm' }],
  ['illicit/violent', { category: 'violence', action: 'refuse' }],
  ['hate/threatening', { category: 'hate', action: 'refuse' }],
  ['harassment/threatening', { category: 'hate', action: 'refuse' }],
  ['sexual', { category: 'sexual', action: 'refuse' }],
  ['illicit', { category: 'provider', action: 'allow_with_care', care: 'provider' }],
  ['violence/graphic', { category: 'provider', action: 'allow_with_care', care: 'provider' }],
];

/**
 * check(text, { fetch, signal, env }) -> { ok: true, hits: [...] } | { ok: false, error }
 * hits are rule-style: { category, rule: 'provider:<name>', action, care, prefix }
 */
async function check(text, { fetch: f = globalThis.fetch, signal, env = config.safety } = {}) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(200, Number(env.moderationTimeoutMs) || 3000));
  const onAbort = () => ctl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await f(env.moderationUrl, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.moderationKey}` },
      body: JSON.stringify({ model: env.moderationModel, input: String(text || '').slice(0, 8000) }),
    });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: `http_${res.status}` });
    const body = await res.json();
    const r = body && Array.isArray(body.results) ? body.results[0] : null;
    if (!r || typeof r.categories !== 'object') throw Object.assign(new Error('bad response'), { code: 'bad_json' });
    const hits = [];
    const seen = new Set();
    for (const [name, out] of MAP) {
      if (!r.categories[name] || seen.has(out.category)) continue;
      seen.add(out.category);
      hits.push({ ...out, rule: `provider:${name}`, care: out.care || null, prefix: out.prefix || null });
    }
    return { ok: true, hits, ms: Date.now() - started };
  } catch (e) {
    const code = ctl.signal.aborted && !(signal && signal.aborted) ? 'timeout' : e.code || 'error';
    log.warn('safety_provider_failed', { code, ms: Date.now() - started, err: String(e.message || '').slice(0, 120) });
    return { ok: false, error: code, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

module.exports = { check, MAP };
