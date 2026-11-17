// AI cost per call (v0.14.0, Blueprint step A6). Every provider attempt logged in ai_calls carries its tokens and
// a cost in kobo (ai_calls.cost_minor, DECIMAL with 4 places, since one call is usually a fraction of a kobo).
// Prices come from AI_MODEL_COSTS, JSON in kobo per 1M tokens:
//   {"gemini-3.8-flash": [15000, 60000], "openrouter:deepseek/deepseek-chat": [40000, 160000], "groq:*": [0, 0]}
// A key is "provider:model", a bare "model", or "provider:*" (in that order of preference). A value is
// [input, output] or { "in": …, "out": … }. Empty (the default) = every model costs 0, which matches the free
// tiers in use today (Gemma / Gemini free, Groq, OpenRouter free models); tokens are still recorded.
// Kobo, not dollars, so spend sits next to plan prices and the daily cap (BILLING_DAILY_SPEND_CAP_MINOR).
const config = require('../../config');
const log = require('../../shared/logger');

let parsed = { raw: null, table: {} };

// -> { key: [inPer1M, outPer1M] }. Bad JSON or bad values are ignored (logged once) so logging never breaks.
function parse(raw) {
  const table = {};
  if (!raw || !String(raw).trim()) return table;
  let j;
  try { j = JSON.parse(raw); } catch (e) {
    log.warn('ai_model_costs_invalid', { err: String(e.message).slice(0, 120) });
    return table;
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return table;
  for (const [k, v] of Object.entries(j)) {
    const pair = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.in, v.out] : null;
    const nums = pair && pair.map(Number);
    if (nums && nums.length >= 2 && nums.every((x) => Number.isFinite(x) && x >= 0)) table[k] = nums.slice(0, 2);
  }
  return table;
}

function table(raw = config.billing.modelCosts) {
  if (parsed.raw !== raw) parsed = { raw, table: parse(raw) };
  return parsed.table;
}

function priceFor(provider, model, t = table()) {
  return t[`${provider}:${model}`] || t[model] || t[`${provider}:*`] || null;
}

// Normalises a provider's usage object (OpenAI shape, or ours) -> { input, output } or null.
function tokens(u) {
  if (!u) return null;
  const input = Number(u.prompt_tokens != null ? u.prompt_tokens : u.input != null ? u.input : u.input_tokens) || 0;
  const output = Number(u.completion_tokens != null ? u.completion_tokens : u.output != null ? u.output
    : u.output_tokens) || 0;
  return input || output ? { input, output } : null;
}

// Kobo for one call, rounded to 4 places. 0 when the model has no price or no tokens were reported.
function costOf({ provider = '', model = '', input = 0, output = 0 }, t = table()) {
  const p = priceFor(provider, model, t);
  if (!p) return 0;
  return Math.round(((Number(input) || 0) * p[0] + (Number(output) || 0) * p[1]) / 1e6 * 10000) / 10000;
}

module.exports = { parse, table, priceFor, tokens, costOf };
