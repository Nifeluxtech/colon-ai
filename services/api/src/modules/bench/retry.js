// Benchmark retry policy and error reasons. A free tier saying "slow down" (429) or a busy host (5xx, timeouts,
// empty replies) is retried with exponential back-off and jitter; a 429 or 503 Retry-After header is honoured.
// Requests the host refuses for good (400 bad parameter, 401/403 key, 404 model id) are never retried.

const RETRYABLE = new Set(['upstream_error', 'network', 'timeout', 'empty']);
const DEFAULTS = {
  retries: 2,                              // normal retries per item (5xx, timeouts, network, empty)
  backoffMs: [10000, 30000, 60000],        // waits before retry 1, 2, 3...
  rateRetries: 6,                          // extra attempts for 429s (they don't use up the normal retries)
  rateBackoffMs: [20000, 40000, 60000],    // waits on 429 without a Retry-After header
  maxWaitMs: 180000,                       // never wait longer than this for one retry
  jitter: 0.2,                             // ±20 % so parallel models don't retry in lockstep
};

/**
 * nextWait(err, state, opts) -> { retry: false } | { retry: true, waitMs, rate: bool }
 * state: { errors (normal retries used), limited (429 retries used) }
 */
function nextWait(err, state, opts = {}) {
  const o = { ...DEFAULTS, ...strip(opts) };
  const code = (err && err.code) || 'error';
  const jit = (ms) => Math.round(ms * (1 + (o.random ? o.random() * 2 - 1 : Math.random() * 2 - 1) * o.jitter));
  if (code === 'rate_limited') {
    if (state.limited >= o.rateRetries) return { retry: false };
    const base = err.retryAfterMs !== null && err.retryAfterMs !== undefined ? err.retryAfterMs
      : o.rateBackoffMs[Math.min(state.limited, o.rateBackoffMs.length - 1)];
    return { retry: true, rate: true, waitMs: Math.min(o.maxWaitMs, Math.max(0, jit(base))) };
  }
  if (!RETRYABLE.has(code) || state.errors >= o.retries) return { retry: false };
  const base = err.retryAfterMs || o.backoffMs[Math.min(state.errors, o.backoffMs.length - 1)];
  return { retry: true, rate: false, waitMs: Math.min(o.maxWaitMs, Math.max(0, jit(base))) };
}
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const PHASE = {
  connect: 'no response from the host (queued or overloaded)',
  first_token: 'stream open, no answer text',
  idle: 'stream went quiet mid-answer',
  max: 'hit the overall time cap',
};

/** A one-line, human reason for an error row, e.g. "timeout (no response from the host…) after 60.0 s, 3 attempts" */
function reason(err, { ms, attempts } = {}) {
  const code = (err && err.code) || 'error';
  const status = err && err.status ? ` ${err.status}` : '';
  const phase = err && err.phase && PHASE[err.phase] ? ` (${PHASE[err.phase]}${err.reasoningChunks
    ? `, ${err.reasoningChunks} reasoning chunks` : ''})` : '';
  const hint = code === 'http_400' ? ' [bad request: a parameter this model does not accept?]'
    : code === 'model_not_found' ? ' [model id not on this host]' : code === 'auth' ? ' [API key missing or refused]'
      : '';
  const tail = ms !== undefined ? ` after ${(ms / 1000).toFixed(1)} s${attempts ? `, ${attempts} attempt${attempts > 1
    ? 's' : ''}` : ''}` : '';
  return `${code}${status}${phase}: ${String((err && err.message) || err).slice(0, 160)}${hint}${tail}`;
}

module.exports = { nextWait, reason, RETRYABLE, DEFAULTS };
