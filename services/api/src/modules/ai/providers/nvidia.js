// Provider: NVIDIA build.nvidia.com (OpenAI-compatible free developer endpoints): DeepSeek, Gemma, GLM, MiniMax.
// Enabled only when its key env var is set (see modules/ai/routing.js).
const { env } = require('./env');

module.exports = () => ({
  // NVIDIA build.nvidia.com (free developer endpoints, OpenAI-compatible): DeepSeek, Gemma 4, GLM and more.
  name: 'NVIDIA', baseUrl: env('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'), apiKey: env('NVIDIA_API_KEY',
    ''),
});
