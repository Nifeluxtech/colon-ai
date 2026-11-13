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
const groq = require('./providers/groq');
const openrouter = require('./providers/openrouter');
const google = require('./providers/google');
const nvidia = require('./providers/nvidia');
const natlas = require('./providers/natlas');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

// Order matters: it is the order /health lists enabled providers in.
function providers() {
  return {
    groq: groq(),
    openrouter: openrouter(),
    gemini: google.config(),
    nvidia: nvidia(),
    natlas: natlas(),
  };
}

function targets() {
  return {
    qwen: [
      { provider: 'groq', model: env('GROQ_MODEL', 'qwen/qwen3.8-27b'), vision: env('GROQ_VISION', '0') === '1' },
    ],
    deepseek: [
      // NVIDIA first: free DeepSeek V4.1 Flash. thinking:false = answer straight away (no hidden reasoning, ~2 s).
      { provider: 'nvidia', model: env('NVIDIA_DEEPSEEK_MODEL', 'deepseek-ai/deepseek-v4.1-flash'), vision: false,
        body: env('NVIDIA_DEEPSEEK_THINKING', 'off') === 'on' ? null : { chat_template_kwargs: { thinking: false } } },
      // No DeepSeek ":free" id was listed on OpenRouter on 11 Nov 2026. Set OPENROUTER_DEEPSEEK_MODEL to a live
      // id; a missing model answers 404 and the router skips to the next target (and rests it for 10 minutes).
      { provider: 'openrouter', model: env('OPENROUTER_DEEPSEEK_MODEL', 'deepseek/deepseek-v4-flash:free'),
        vision: env('OPENROUTER_DEEPSEEK_VISION', '0') === '1' },
    ],
    gemma: [
      // Google AI Studio first: its free Gemma quota is far larger than OpenRouter's free tier.
      { provider: 'gemini', model: env('GEMINI_MODEL', 'gemma-4-26b-a4b-it'), vision: env('GEMINI_VISION',
        '1') === '1' },
      // Gemma 4 31B on NVIDIA too, so a busy Google free tier has a second host.
      { provider: 'nvidia', model: env('NVIDIA_GEMMA_MODEL', ''), vision: false },
      { provider: 'openrouter', model: env('OPENROUTER_GEMMA_MODEL', 'google/gemma-4-31b-it:free'),
        vision: env('OPENROUTER_GEMMA_VISION', '1') === '1' },
    ],
    // Gemma 4 31B (Google): strong in Yorùbá/Hausa/Igbo but ~21 s to first token on the free tier (bench 2026-11-12).
    gemma31: [
      { provider: 'gemini', model: env('GEMINI_FALLBACK_MODEL', 'gemma-4-31b-it') === 'off' ? '' : env(
        'GEMINI_FALLBACK_MODEL', 'gemma-4-31b-it'), vision: env('GEMINI_VISION', '1') === '1' },
    ],
    // MiniMax M3.1 Flash (NVIDIA): bench 88.9, 100% on code/tools/exams, weak in Yorùbá/Hausa/Igbo (51-66%).
    minimax: [
      { provider: 'nvidia', model: env('NVIDIA_MINIMAX_MODEL', 'minimaxai/minimax-m3.1-flash'), vision: false },
    ],
    glm: [
      // GLM-5.3 Flash thinks at reasoning_effort "max" unless told otherwise (NVIDIA model card), which kept every
      // benchmark item of 2026-11-12 from starting an answer within 60 s. "low" keeps it usable as a chat fallback.
      { provider: 'nvidia', model: env('NVIDIA_GLM_MODEL', 'z-ai/glm-5.3-flash'), vision: false,
        body: env('NVIDIA_GLM_REASONING', 'low') === 'default' ? null : { reasoning_effort: env('NVIDIA_GLM_REASONING',
          'low') } },
    ],
    natlas: [
      { provider: 'natlas', model: env('NATLAS_MODEL', 'n-atlas'), vision: false },
    ],
  };
}

// Order chosen by the Colon benchmark (services/api/bench/results/2026-11-12.md): Gemma 4 26B scored best of the
// allowed models and is fastest; DeepSeek V4.1 Flash and GLM-5.3 Flash on NVIDIA's free tier answered nothing that day.
const routes = {
  african: ['gemma', 'gemma31', 'natlas', 'minimax', 'qwen', 'deepseek', 'glm'],
  general: ['gemma', 'minimax', 'gemma31', 'qwen', 'deepseek', 'glm'],
  study: ['gemma', 'minimax', 'gemma31', 'qwen', 'deepseek', 'glm'],
  research: ['gemma', 'minimax', 'gemma31', 'qwen', 'deepseek', 'glm'],
  developer: ['gemma', 'minimax', 'gemma31', 'qwen', 'deepseek', 'glm'],
};

// Reply languages that use the "african" route (codes match users.language).
const africanLanguages = ['pcm', 'yo', 'ha', 'ig'];

const models = [
  { id: 'colon-saga', name: 'Colon Saga',
    description: 'Colon’s default assistant, tuned for Nigerian and African context.', default: true, capabilities: [
    'text', 'reasoning', 'code'] },
  { id: 'colon-saga-fast', name: 'Saga Fast', description: 'Quicker answers for everyday questions and low data use.',
    route: ['gemma', 'minimax', 'qwen', 'deepseek', 'glm'], capabilities: ['text', 'code'] },
  { id: 'colon-saga-deep', name: 'Saga Deep Research', description: 'Multi-step research with cited sources.',
    comingSoon: true, capabilities: ['reasoning', 'web', 'citations'] },
  { id: 'colon-saga-voice', name: 'Saga Voice',
    description: 'Talk with Colon in English, Naijá, Yorùbá, Hausa and Igbo.', comingSoon: true, capabilities: [
    'voice'] },
];

module.exports = { providers, targets, routes, africanLanguages, models };
