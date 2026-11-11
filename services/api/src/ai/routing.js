// Model router v1: THE routing table. One file, so Phase 4 (Admin Dashboard > Routing) can move it
// into the database without touching the router itself.
//
// providers  OpenAI-compatible hosts. A provider is enabled only when its key env var is set.
// targets    a named model slot ("qwen", "deepseek", ...) -> one or more provider+model pairs, tried in order.
// routes     per mode, the order of targets to try. "african" wins whenever the reply language is
//            Naijá (Pidgin), Yorùbá, Hausa or Igbo, whatever the mode.
// models     what GET /models shows. "route" pins a model to its own chain (except for African languages).
//
// Model ids are env-overridable because free models come and go (check the provider's model list).
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

function providers() {
  return {
    groq: {
      name: 'Groq', baseUrl: env('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'), apiKey: env('GROQ_API_KEY', ''),
    },
    openrouter: {
      name: 'OpenRouter', baseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'), apiKey: env('OPENROUTER_API_KEY', ''),
      // Optional attribution headers OpenRouter shows on its dashboard.
      headers: { 'HTTP-Referer': env('APP_URL_CHAT', 'https://chat.apparatus.name.ng'), 'X-Title': 'Colon AI' },
    },
    gemini: {
      name: 'Google AI Studio', baseUrl: env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai'), apiKey: env('GEMINI_API_KEY', ''),
    },
    natlas: {
      // N-ATLaS (Nigerian Atlas for Languages & AI) on any OpenAI-compatible host (vLLM, HF endpoint, ...).
      name: 'N-ATLaS', baseUrl: env('NATLAS_BASE_URL', ''), apiKey: env('NATLAS_API_KEY', ''), needsBaseUrl: true,
    },
  };
}

function targets() {
  return {
    qwen: [
      { provider: 'groq', model: env('GROQ_MODEL', 'qwen/qwen3.8-27b'), vision: env('GROQ_VISION', '0') === '1' },
    ],
    deepseek: [
      // No DeepSeek ":free" id was listed on OpenRouter on 11 Nov 2026. Set OPENROUTER_DEEPSEEK_MODEL to a live
      // id; a missing model answers 404 and the router skips to the next target (and rests it for 10 minutes).
      { provider: 'openrouter', model: env('OPENROUTER_DEEPSEEK_MODEL', 'deepseek/deepseek-v4-flash:free'), vision: env('OPENROUTER_DEEPSEEK_VISION', '0') === '1' },
    ],
    gemma: [
      // Google AI Studio first: its free Gemma quota is far larger than OpenRouter's free tier.
      { provider: 'gemini', model: env('GEMINI_MODEL', 'gemma-4-31b-it'), vision: env('GEMINI_VISION', '1') === '1' },
      { provider: 'openrouter', model: env('OPENROUTER_GEMMA_MODEL', 'google/gemma-4-31b-it:free'), vision: env('OPENROUTER_GEMMA_VISION', '1') === '1' },
    ],
    natlas: [
      { provider: 'natlas', model: env('NATLAS_MODEL', 'n-atlas'), vision: false },
    ],
  };
}

const routes = {
  african: ['deepseek', 'natlas', 'gemma', 'qwen'],
  general: ['qwen', 'deepseek', 'gemma'],
  study: ['qwen', 'deepseek', 'gemma'],
  research: ['qwen', 'deepseek', 'gemma'],
  developer: ['deepseek', 'qwen', 'gemma'],
};

// Reply languages that use the "african" route (codes match users.language).
const africanLanguages = ['pcm', 'yo', 'ha', 'ig'];

const models = [
  { id: 'colon-saga', name: 'Colon Saga', description: 'Colon’s default assistant, tuned for Nigerian and African context.', default: true, capabilities: ['text', 'reasoning', 'code'] },
  { id: 'colon-saga-fast', name: 'Saga Fast', description: 'Quicker answers for everyday questions and low data use.', route: ['qwen', 'gemma', 'deepseek'], capabilities: ['text', 'code'] },
  { id: 'colon-saga-deep', name: 'Saga Deep Research', description: 'Multi-step research with cited sources.', comingSoon: true, capabilities: ['reasoning', 'web', 'citations'] },
  { id: 'colon-saga-voice', name: 'Saga Voice', description: 'Talk with Colon in English, Naijá, Yorùbá, Hausa and Igbo.', comingSoon: true, capabilities: ['voice'] },
];

module.exports = { providers, targets, routes, africanLanguages, models };
