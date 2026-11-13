// The models Phase 5 compares (Nov 2026 free tiers) and the request options each one is benchmarked with.
// "body" is merged into the request like a routing target's body; "opts" overrides the run's timeouts and token cap
// for that model only. A model that is also in Saga's routing gets the same body as routing sends (routedBody), so
// the benchmark measures what users get. Parameters are from NVIDIA's API reference (docs.api.nvidia.com/nim).
const crypto = require('crypto');
const routing = require('../ai').routing;

// Slow NVIDIA endpoints: free-tier queueing before the first byte was 7-34 s on 2026-11-11 and up to 187 s on
// 2026-11-12 (Mistral Large 4), so these get 180 s to start instead of the run default of 60 s.
const SLOW = { firstTokenTimeoutMs: 180000, maxMs: 300000 };

const CANDIDATES = [
  { provider: 'gemini', model: 'gemma-4-26b-a4b-it' },
  { provider: 'gemini', model: 'gemma-4-31b-it' },
  { provider: 'gemini', model: 'gemini-3.5-flash-lite', note: 'reference only (not wanted as primary)' },
  // Same body as routing's deepseek target (NVIDIA_DEEPSEEK_THINKING, default off).
  { provider: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash', routed: true, opts: SLOW },
  // Same body as routing's glm target (NVIDIA_GLM_REASONING, default low). The host default is "max" thinking.
  { provider: 'nvidia', model: 'z-ai/glm-5.3-flash', routed: true, opts: SLOW },
  { provider: 'nvidia', model: 'minimaxai/minimax-m3.1-flash' },
  // Nemotron reasons by default with a 16384-token budget that counts against max_tokens: with 2048 max tokens,
  // 16 of 130 items on 2026-11-12 ended at finish_reason "length" with no answer. Cap the thinking, raise the limit.
  { provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b', body: { reasoning_budget: 1024 },
    opts: { maxTokens: 4096, firstTokenTimeoutMs: 120000 } },
  // NVIDIA serves an omitted reasoning_effort as "none"; say so explicitly so the run doesn't depend on that default.
  { provider: 'nvidia', model: 'mistralai/mistral-large-4-1t-a52b', body: { reasoning_effort: 'low' }, opts: SLOW },
];

/** The body Saga's routing sends for this provider + model (null when routing has none or doesn't use it). */
function routedBody(provider, model) {
  for (const list of Object.values(routing.targets())) {
    const t = list.find(x => x.provider === provider && x.model === model);
    if (t) return t.body || null;
  }
  return null;
}

/** Resolves a candidate's request body (routed or its own). */
function bodyOf(c) {
  return c.routed ? routedBody(c.provider, c.model) : (c.body || null);
}

/**
 * Short fingerprint of everything that changes a model's answers: model, body, token cap and temperature.
 * Rows carry it so a resumed run never mixes answers produced with different settings.
 */
function cfgOf(c, opts = {}) {
  const o = { ...opts, ...(c.opts || {}), ...(opts.force || {}) };
  const key = JSON.stringify({ p: c.provider, m: c.model, b: bodyOf(c), t: o.maxTokens || 2048,
    temp: o.temperature === undefined ? null : o.temperature });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 10);
}

function parseCandidate(s) {
  const i = String(s).indexOf(':');
  if (i < 1) throw new Error(`Use provider:model, got "${s}"`);
  const provider = s.slice(0, i), model = s.slice(i + 1);
  return CANDIDATES.find(c => c.provider === provider && c.model === model) || { provider, model };
}

const keyOf = (c) => `${c.provider}:${c.model}`;

module.exports = { CANDIDATES, routedBody, bodyOf, cfgOf, parseCandidate, keyOf };
