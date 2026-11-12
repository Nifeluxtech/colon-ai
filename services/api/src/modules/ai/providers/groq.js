// Provider: Groq (OpenAI-compatible): Qwen.
// Enabled only when its key env var is set (see modules/ai/routing.js).
const { env } = require('./env');

module.exports = () => ({
  name: 'Groq', baseUrl: env('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'), apiKey: env('GROQ_API_KEY', ''),
});
