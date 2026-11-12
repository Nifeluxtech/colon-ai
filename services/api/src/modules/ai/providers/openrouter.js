// Provider: OpenRouter (OpenAI-compatible): free DeepSeek and Gemma ids.
// Enabled only when its key env var is set (see modules/ai/routing.js).
const { env } = require('./env');

module.exports = () => ({
  name: 'OpenRouter', baseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    apiKey: env('OPENROUTER_API_KEY', ''),
  // Optional attribution headers OpenRouter shows on its dashboard.
  headers: { 'HTTP-Referer': env('APP_URL_CHAT', 'https://chat.apparatus.name.ng'), 'X-Title': 'Colon AI' },
});
