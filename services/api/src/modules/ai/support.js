// Support models (0.11.0): with AI_MODEL_SET=gemma, Gemma 4 on Google AI Studio's free tier was the only model, and
// Saga's many browser decisions used up its rate limit ("Colon couldn't reach an AI provider"). After Gemma 4 26B ->
// 31B on Google, the chain now goes on to support models, one at a time:
//   1-4. Google AI Studio (same GEMINI_API_KEY; each model has its own free quota, so a 429 on Gemma rests only Gemma):
//        gemini-flash-lite-latest (alias Google moves to each new Flash-Lite), gemini-3.5-flash-lite (stable), then
//        gemini-3.8-flash (stable, no shutdown date; 0.11.7 replaced gemini-2.5-flash, which Google retires on
//        1 Dec 2026), then gemini-4-hydrogen (0.11.8; the only Gemini 4 on the free tier, thinks "low").
//        A "not found" / "not available" answer rests a model for a day instead of failing the reply.
//        GEMINI_SUPPORT_MODELS.
//   5. Groq openai/gpt-oss-120b (free: 30 RPM, 1,000 RPD, 8K TPM, 200K TPD per model)
//   6. OpenRouter google/gemma-4-31b-it:free (free: 20 RPM, 50 a day; 1,000 a day after $10 of credits)
// Each is used only when its provider's key is set. AI_SUPPORT_MODELS overrides the list ("provider:model, ...", in
// order; "off" = none); otherwise GEMINI_SUPPORT_MODELS (comma list), GROQ_SUPPORT_MODEL and OPENROUTER_SUPPORT_MODEL
// name them (each "off" to skip).
// Low-TPM hosts get a prompt budget (maxInputChars): fit.js trims the request (Saga's page snapshots first) to it.
const env = (k, d, e = process.env) => (e[k] !== undefined && e[k] !== '' ? e[k] : d);

const DEFAULTS = { gemini: 'gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.8-flash,gemini-4-hydrogen',
  groq: 'openai/gpt-oss-120b', openrouter: 'google/gemma-4-31b-it:free' };
const MAX = 8;
// A Gemini support model Google has withdrawn (404/403/400 "not found", "not available", deprecated) rests this long.
const UNAVAILABLE_REST_MS = 24 * 60 * 60e3;
// Input tokens a support host may be sent per request. Groq's 8K tokens a minute must hold the prompt and the reply.
const TOKENS = { groq: 5000, openrouter: 24000 };
const CHARS_PER_TOKEN = 3;                       // conservative for English + JSON + URLs
const PROVIDERS = ['groq', 'openrouter', 'gemini', 'nvidia', 'natlas'];

/** The configured support models, in order: [{ provider, model }] (keys not checked here). */
function list(e = process.env) {
  const raw = String(env('AI_SUPPORT_MODELS', '', e)).trim();
  if (raw.toLowerCase() === 'off') return [];
  if (raw) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const i = s.indexOf(':');
      return i > 0 ? { provider: s.slice(0, i).trim().toLowerCase(), model: s.slice(i + 1).trim() } : null;
    }).filter((x) => x && x.model && PROVIDERS.includes(x.provider)).slice(0, MAX);
  }
  const out = [];
  const keys = [['gemini', 'GEMINI_SUPPORT_MODELS'], ['groq', 'GROQ_SUPPORT_MODEL'],
    ['openrouter', 'OPENROUTER_SUPPORT_MODEL']];
  for (const [p, k] of keys) {
    const v = String(env(k, DEFAULTS[p], e)).trim();
    if (!v || v.toLowerCase() === 'off') continue;
    for (const m of v.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!out.some((x) => x.provider === p && x.model === m)) out.push({ provider: p, model: m });
    }
  }
  return out.slice(0, MAX);
}

/** True when a Gemini support model answered that it is gone or closed to this key (skip it, rest it long). */
function unavailable(c, e) {
  if (!c || !c.support || c.providerId !== 'gemini' || !e) return false;
  if (e.status === 404 || e.code === 'model_not_found') return true;
  const gone = /not found|not available|no longer (available|supported)|deprecated|discontinued|retired|not supported/i;
  return (e.status === 403 || e.status === 400) && gone.test(String(e.message || ''));
}

/** How long an unavailable Gemini support model rests (GEMINI_SUPPORT_UNAVAILABLE_REST_HOURS, default 24). */
function unavailableRestMs(e = process.env) {
  const h = Number(env('GEMINI_SUPPORT_UNAVAILABLE_REST_HOURS', 24, e));
  return h > 0 ? Math.round(h * 60 * 60e3) : UNAVAILABLE_REST_MS;
}

// Gemini 2.5 thinks by thinkingBudget and rejects Gemma's thinkingLevel: budget 0 = answer straight away (kept for a
// GEMINI_SUPPORT_MODELS that still names it). Gemini 3.8 Flash (and Gemini 4, 3.1 Pro) reject "minimal" with an
// error, so they get "low", their fastest level. Gemini 3.x Flash-Lite (and the -latest alias) take the provider's
// thinkingLevel ("minimal") as Gemma does.
const NO_MINIMAL = /gemini-3\.8-flash(?!-lite)|gemini-4-|gemini-3(\.1)?-pro/i;
function geminiBody(model) {
  if (/gemini-2\.5/i.test(model)) return { thinkingConfig: { thinkingBudget: 0 } };
  return NO_MINIMAL.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : null;
}

/** Prompt budget in characters for a support model on this provider (0 = no limit). */
function maxInputChars(provider, e = process.env) {
  const key = `${String(provider).toUpperCase()}_SUPPORT_MAX_INPUT_TOKENS`;
  const n = Number(env(key, TOKENS[provider] || 0, e));
  return n > 0 ? Math.round(n * CHARS_PER_TOKEN) : 0;
}

/**
 * entries(providers) -> chain entries for the enabled support models (providers: generate.enabledProviders()).
 * gpt-oss on Groq is a reasoning model: reasoning_effort "low" keeps it quick (GROQ_SUPPORT_REASONING to change).
 */
function entries(providers, e = process.env) {
  const out = [];
  for (const s of list(e)) {
    const p = providers[s.provider];
    if (!p) continue;
    const body = s.provider === 'groq' && /gpt-oss/i.test(s.model)
      ? { reasoning_effort: env('GROQ_SUPPORT_REASONING', 'low', e) }
      : s.provider === 'gemini' ? geminiBody(s.model) : null;
    const vision = s.provider === 'gemini' ? /gemini/i.test(s.model) && env('GEMINI_SUPPORT_VISION', '1', e) === '1'
      : s.provider === 'openrouter' && /gemma/i.test(s.model) && env('OPENROUTER_GEMMA_VISION', '1', e) === '1';
    out.push({ target: 'support', providerId: s.provider, providerName: p.name, provider: p, model: s.model,
      vision, body, support: true, maxInputChars: maxInputChars(s.provider, e) });
  }
  return out;
}

module.exports = { list, entries, maxInputChars, unavailable, unavailableRestMs, DEFAULTS, TOKENS, CHARS_PER_TOKEN,
  UNAVAILABLE_REST_MS };
