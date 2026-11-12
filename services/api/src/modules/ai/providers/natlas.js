// Provider: N-ATLaS (Nigerian Atlas for Languages & AI) on any OpenAI-compatible host (vLLM, HF endpoint, ...).
// Enabled only when its key env var is set (see modules/ai/routing.js).
const { env } = require('./env');

module.exports = () => ({
  // N-ATLaS (Nigerian Atlas for Languages & AI) on any OpenAI-compatible host (vLLM, HF endpoint, ...).
  name: 'N-ATLaS', baseUrl: env('NATLAS_BASE_URL', ''), apiKey: env('NATLAS_API_KEY', ''), needsBaseUrl: true,
});
