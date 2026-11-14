// THE configuration schema: every environment variable the API reads, its type, default and purpose.
// config/index.js builds the config object from it and validates it at boot; config/api.env.example
// documents the same keys (scripts/check.js keeps the two in sync). Keys marked requiredIn must be set
// in those NODE_ENVs or the API refuses to start. Everything else is optional and keeps its default.
const path = require('path');

const ORIGINS = 'https://chat.apparatus.name.ng,https://browser.apparatus.name.ng,https://admin.apparatus.name.ng';

const str = (key, def, doc, extra = {}) => ({ key, type: 'string', default: def, doc, ...extra });
const num = (key, def, doc) => ({ key, type: 'number', default: def, doc });
const url = (key, def, doc) => ({ key, type: 'url', default: def, doc });
const secret = (key, doc) => ({ key, type: 'string', default: '', doc, secret: true });
const oneOf = (key, values, def, doc) => ({ key, type: 'enum', values, default: def, doc });

const SCHEMA = [
  // Runtime
  str('NODE_ENV', 'development', 'production on cPanel'),
  num('PORT', 3000, 'HTTP port (Passenger sets it)'),
  str('ALLOWED_ORIGINS', ORIGINS, 'comma-separated web app origins allowed to call the API'),
  // Database
  str('DB_HOST', 'localhost', 'MySQL/MariaDB host'),
  num('DB_PORT', 3306, 'MySQL/MariaDB port'),
  str('DB_USER', '', 'MySQL/MariaDB user', { requiredIn: ['production'] }),
  secret('DB_PASSWORD', 'MySQL/MariaDB password'),
  str('DB_NAME', '', 'MySQL/MariaDB database name', { requiredIn: ['production'] }),
  // Accounts and security
  secret('APP_SECRET', '32+ random characters; encrypts 2FA secrets and stored provider keys'),
  str('COOKIE_DOMAIN', '', 'cookie domain shared by all apps, e.g. .apparatus.name.ng'),
  num('SESSION_DAYS', 30, 'sign-in session length in days'),
  str('OWNER_EMAIL', '', 'this account becomes Super Admin when it registers'),
  str('GOOGLE_CLIENT_ID', '', 'Google sign-in OAuth client id (optional)'),
  url('APP_URL_CHAT', 'https://chat.apparatus.name.ng', 'Colon AI web app URL (links in emails)'),
  // Email
  secret('BREVO_API_KEY', 'Brevo key for verification and reset emails (optional)'),
  str('MAIL_FROM', 'no-reply@apparatus.name.ng', 'sender address'),
  str('MAIL_FROM_NAME', 'Colon AI', 'sender name'),
  // Chat limits and uploads
  num('CHAT_DAILY_LIMIT', 100, 'replies per signed-in user per UTC day'),
  num('CHAT_GUEST_DAILY_LIMIT', 15, 'replies per guest browser per UTC day'),
  num('CHAT_GUEST_IP_DAILY_LIMIT', 300, 'replies for all guests on one IP per UTC day'),
  str('UPLOAD_DIR', path.resolve(__dirname, '../../storage/uploads'), 'uploaded files, outside every web root'),
  num('UPLOAD_QUOTA_MB', 200, 'per-user upload quota'),
  // Model router tuning
  num('AI_FIRST_TOKEN_TIMEOUT_MS', 25000, 'give up on a model that has not started answering'),
  num('AI_HEDGE', 2, 'models asked at once per wave (1 = one after another)'),
  oneOf('AI_SPECIALIST_ROUTING', ['on', 'off'], 'on',
    'specialist routing: the benchmark winner per task category leads the chain (Admin › Routing overrides)'),
  num('AI_IDLE_TIMEOUT_MS', 30000, 'give up on a stream that went quiet'),
  num('AI_MAX_REPLY_MS', 180000, 'hard cap on one reply'),
  num('AI_MAX_TOKENS', 4096, 'max tokens per reply'),
  num('AI_DEVELOPER_MAX_TOKENS', 8192, 'max tokens per Developer-mode reply (whole files of code)'),
  // AI providers (read live by modules/ai/providers/*.js; a provider is on only when its key is set)
  secret('GROQ_API_KEY', 'Groq key'), url('GROQ_BASE_URL', 'https://api.groq.com/openai/v1', 'Groq base URL'),
  str('GROQ_MODEL', 'qwen/qwen3.8-27b', 'Groq model id'), str('GROQ_VISION', '0', '1 if the Groq model reads images'),
  secret('OPENROUTER_API_KEY', 'OpenRouter key'),
  url('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1', 'OpenRouter base URL'),
  str('OPENROUTER_DEEPSEEK_MODEL', 'deepseek/deepseek-v4-flash:free', 'OpenRouter DeepSeek id'),
  str('OPENROUTER_DEEPSEEK_VISION', '0', '1 if that model reads images'),
  str('OPENROUTER_GEMMA_MODEL', 'google/gemma-4-31b-it:free', 'OpenRouter Gemma id'),
  str('OPENROUTER_GEMMA_VISION', '1', '1 if that model reads images'),
  secret('GEMINI_API_KEY', 'Google AI Studio key'),
  url('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta', 'Google AI Studio base URL'),
  str('GEMINI_MODEL', 'gemma-4-26b-a4b-it', 'Saga first choice'),
  str('GEMINI_FALLBACK_MODEL', 'gemma-4-31b-it', 'second Google model ("off" to skip)'),
  str('GEMINI_THINKING', 'minimal', 'minimal, high or off'), str('GEMINI_VISION', '1', '1 if Gemma reads images'),
  secret('NVIDIA_API_KEY', 'NVIDIA build key'),
  url('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1', 'NVIDIA base URL'),
  str('NVIDIA_DEEPSEEK_MODEL', 'deepseek-ai/deepseek-v4.1-flash', 'NVIDIA DeepSeek id'),
  str('NVIDIA_DEEPSEEK_THINKING', 'off', '"on" = hidden reasoning first (slower)'),
  str('NVIDIA_GEMMA_MODEL', '', 'NVIDIA Gemma id (empty = off)'),
  str('NVIDIA_GLM_MODEL', 'z-ai/glm-5.3-flash', 'NVIDIA GLM id'),
  str('NVIDIA_GLM_REASONING', 'low', 'GLM reasoning_effort: low, high, max, or "default" (host default = max)'),
  str('NVIDIA_MINIMAX_MODEL', 'minimaxai/minimax-m3.1-flash', 'NVIDIA MiniMax id'),
  url('NATLAS_BASE_URL', 'https://langa.julimer.com/v1', 'OpenAI-compatible host serving N-ATLaS (Langa)'),
  secret('NATLAS_API_KEY', 'N-ATLaS key (Langa)'),
  str('NATLAS_MODEL', 'n-atlas', 'N-ATLaS model id'),
  num('NATLAS_MAX_TOKENS', 2048, 'Output cap the N-ATLaS host accepts (Langa: 2048)'),
  // Benchmark gate
  str('BENCH_GATE', 'on', '"off" lets models into routing without a fresh benchmark'),
  num('BENCH_MAX_AGE_DAYS', 30, 'how fresh a benchmark must be'),
  // Web search (Research mode)
  str('WEB_SEARCH', 'on', '"off" switches web search off until an admin turns it on'),
  secret('BRAVE_SEARCH_API_KEY', 'Brave Search API key (optional)'), secret('TAVILY_API_KEY', 'Tavily key (optional)'),
  url('SEARXNG_URL', '', 'SearXNG base URL (optional)'), secret('SEARXNG_API_KEY', 'SearXNG bearer token (optional)'),
  // Voice (modules/voice; Phase 6)
  oneOf('VOICE', ['on', 'off'], 'on', '"off" switches server transcription off (browser dictation still works)'),
  secret('NAIJA_SPEECH_API_KEY', 'Naija Speech API key (Hausa, Igbo, Yoruba, Nigerian English speech to text)'),
  url('NAIJA_SPEECH_BASE_URL', 'https://asr.naijallm.com/v1', 'Naija Speech API base URL'),
  str('VOICE_GEMINI_MODEL', 'gemini-3.5-flash-lite', 'Gemini model that transcribes audio ("off" to skip)'),
  num('VOICE_MAX_SECONDS', 300, 'longest recording accepted for transcription'),
  num('VOICE_TTS_PER_MINUTE', 7, 'read-aloud requests a minute to Naija Speech (key allows 10 in total)'),
  // Colon Browser server pieces (modules/browser; Phase 8, docs/phase8-backend-contract.md)
  oneOf('BROWSER_READER', ['on', 'off'], 'on', '"off" switches the server reader off (GET /browser/fetch -> 501)'),
  oneOf('BROWSER_READER_GUESTS', ['on', 'off'], 'on', '"off" keeps the server reader for signed-in users only'),
  str('BROWSER_READER_BLOCKLIST', '', 'extra hosts the reader refuses, comma-separated (subdomains included)'),
  // Saga browser automation (modules/saga; Phase 9): Saga drives the phone's browser panel through the bridge
  oneOf('SAGA_BROWSE', ['on', 'off'], 'on', '"off" switches Saga browsing off (POST /browser/agent -> 501)'),
  num('SAGA_MAX_STEPS', 15, 'most actions Saga takes for one browsing task'),
  num('SAGA_TASK_TIMEOUT_MS', 300000, 'hard cap on one browsing task'),
  num('SAGA_MODEL_TIMEOUT_MS', 60000, 'give up on one Saga decision (model call) after this long'),
  num('SAGA_STEP_TIMEOUT_MS', 20000, 'wait this long for the phone to answer one browser command'),
  num('SAGA_APPROVAL_TIMEOUT_MS', 120000, 'wait this long for the user to tap consent or an approval on the phone'),
  num('SAGA_TASKS_PER_HOUR', 20, 'browsing tasks a user may start per hour'),
  num('SAGA_HANDOFF_TIMEOUT_MS', 600000,
    'wait this long for the user to type a password, code or card details and tap Return to AI (Phase 10)'),
  num('SAGA_USER_CONTROL_TIMEOUT_MS', 900000,
    'wait this long for the user to give the browser back after Take control or Pause (0.10.3), then stop the task'),
  // Safety layer (modules/safety; ADR 0003)
  oneOf('SAFETY', ['on', 'off'], 'on', '"off" switches the rule filters off (child-safety rules always stay on)'),
  oneOf('SAFETY_LOG_TEXT', ['off', 'hash', 'excerpt'], 'off',
    'what a safety event keeps of the message: nothing, a keyed hash, or the first 80 characters'),
  oneOf('SAFETY_PROVIDER_MODERATION', ['on', 'off'], 'off', '"on" also asks a moderation endpoint (needs a key)'),
  url('SAFETY_MODERATION_URL', 'https://api.openai.com/v1/moderations', 'OpenAI-compatible moderation endpoint'),
  secret('SAFETY_MODERATION_API_KEY', 'key for the moderation endpoint (optional)'),
  str('SAFETY_MODERATION_MODEL', 'omni-moderation-latest', 'moderation model id'),
  num('SAFETY_MODERATION_TIMEOUT_MS', 3000, 'give up on the moderation endpoint after this long (fail open)'),
];

module.exports = { SCHEMA, ORIGINS };
