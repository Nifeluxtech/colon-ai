// Provider: N-ATLaS (Nigerian Atlas for Languages & AI, Awarri).
// A Llama-3 8B fine-tune for Hausa, Igbo, Yorùbá and English.
// Default host: Langa (langa.julimer.com, OpenAI-compatible vLLM; free plan 12,500 tokens/month, 30 req/min,
// 8,192-token context, max_tokens capped at 2048, 15-30 s cold start answered as 503 model_starting).
// Any other OpenAI-compatible host works via NATLAS_BASE_URL. Enabled only when NATLAS_API_KEY is set.
// Licence: non-commercial, at most 1,000 active users per 30 days; credit Awarri and the Federal Ministry.
const { env } = require('./env');

module.exports = () => ({
  name: 'N-ATLaS', baseUrl: env('NATLAS_BASE_URL', 'https://langa.julimer.com/v1'), apiKey: env('NATLAS_API_KEY', ''),
  maxTokens: Number(env('NATLAS_MAX_TOKENS', '2048')) || 2048,
});
