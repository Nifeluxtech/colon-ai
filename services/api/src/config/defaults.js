// THE configuration schema: every environment variable the API reads, its type, default and purpose.
// config/index.js builds the config object from it and validates it at boot; config/api.env.example
// documents the same keys (scripts/check.js keeps the two in sync). Keys marked requiredIn must be set
// in those NODE_ENVs or the API refuses to start. Everything else is optional and keeps its default.
const path = require('path');

const ORIGINS = 'https://chat.apparatus.name.ng,https://browser.apparatus.name.ng,https://admin.apparatus.name.ng,'
  + 'https://crash.apparatus.name.ng';

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
  // Billing (v0.12.0): plans and the credit ledger (modules/billing)
  oneOf('BILLING_MODE', ['off', 'shadow', 'enforce'], 'shadow',
    'off: no billing | shadow: record credit use, never block | enforce: refuse when credits run out'),
  num('BILLING_CREDITS_CHAT', 1, 'credits per chat reply (General, Study, Developer)'),
  num('BILLING_CREDITS_RESEARCH', 3, 'credits per Research mode reply (web search + reading)'),
  num('BILLING_CREDITS_SAGA', 2, 'credits per Saga browser task (not charged yet)'),
  num('BILLING_CREDITS_IMAGE', 0, 'Colon credits per generated image, on top of one of the plan\'s monthly image '
    + 'credits (v0.17.0)'),
  num('BILLING_CREDITS_DEEP_RESEARCH', 10, 'credits per deep research task (background job), reserved at start, '
    + 'refunded if it fails (v0.17.0)'),
  // Costs (v0.14.0, Blueprint A6): AI spend in kobo, shown in Admin › Costs. Display only, never blocks.
  str('AI_MODEL_COSTS', '', 'JSON prices in kobo per 1M tokens, {"model" | "provider:model" | "provider:*": '
    + '[input, output]}; empty = every model costs 0 (free tiers); tokens are always recorded'),
  num('BILLING_DAILY_SPEND_CAP_MINOR', 0, 'daily AI spend alert in kobo (Admin › Costs warns at 80% and 100%); '
    + '0 = off'),
  // Memory and projects (v0.15.0, Blueprint B9-B10): modules/memory, modules/projects
  num('MEMORY_TOKEN_BUDGET', 500, 'most tokens of saved memories added to one reply (keyword overlap + recency); '
    + '0 = none'),
  num('MEMORY_MAX_ITEMS', 200, 'most memories one user can keep'),
  // Project repositories (v0.24.0): modules/repos (GitHub, GitLab, Bitbucket, any https Git URL), synced into a
  // project's stored snapshot for Developer mode and the read_repo_file / search_repo tools
  oneOf('REPO_IMPORT', ['on', 'off'], 'on', '"off" switches connecting and syncing repositories off (501)'),
  num('REPO_ARCHIVE_MAX_MB', 50, 'largest repository download (zip archive) a sync accepts'),
  num('REPO_MAX_FILES', 3000, 'most files listed in one repository snapshot (the rest are counted)'),
  num('REPO_MAX_TEXT_MB', 4, 'most file text kept per repository snapshot, in MB of characters (max 12)'),
  num('REPO_FILE_MAX_KB', 200, 'most text kept per file, in KB of characters (the rest is marked truncated)'),
  num('REPO_TIMEOUT_MS', 60000, 'give up on one provider call, download or git clone after this long'),
  str('REPO_GIT_BIN', 'git', 'git command for "Any Git URL" (needs git 2.37 or newer; missing = Git URLs off)'),
  // Jobs and cron (v0.16.0, Blueprint C11-C13): modules/jobs, services/api/scripts/cron.js from cPanel cron
  num('JOBS_CRON_INTERVAL_MIN', 5, 'minutes between cPanel cron runs of scripts/cron.js (Admin › Jobs warns when '
    + 'the last run is older than 3 × this); also the period of the recurring system jobs'),
  num('JOBS_BATCH_SIZE', 10, 'jobs one dispatcher claims at a time'),
  num('JOBS_TIME_LIMIT_MS', 50000, 'one cron run stops claiming and exits within this long'),
  num('JOBS_LEASE_MS', 300000, 'a claimed job is another runner\'s to take over after this long without finishing'),
  num('JOBS_MAX_ATTEMPTS', 5, 'tries before a job is dead-lettered'),
  num('JOBS_BACKOFF_MS', 60000, 'wait before the first retry; doubles each attempt (at most 6 hours)'),
  num('JOBS_KEEP_DAYS', 14, 'done and cancelled jobs and cron runs are deleted after this many days'),
  oneOf('JOBS_INPROCESS', ['off', 'on'], 'off', 'on: the API worker also runs the cron work every interval '
    + '(fallback while cPanel cron is not set up; Passenger may idle it)'),
  secret('CRON_SECRET', 'X-Cron-Secret for POST /internal/cron/run (secondary trigger); empty = the route is off'),
  // Tools and media (v0.17.0, Blueprint D14-D17): modules/tools, modules/media, modules/research
  str('IMAGE_MODEL', '', 'Google AI Studio image-capable model id (needs GEMINI_API_KEY): image edits, and new '
    + 'images when Cloudflare is not set up or fails; empty = Gemini images and all edits off'),
  num('IMAGE_TIMEOUT_MS', 90000, 'give up on one image after this long (credits are refunded)'),
  // v0.17.1: Cloudflare Workers AI (free daily allocation) for new images; edits always use IMAGE_MODEL (Gemini).
  oneOf('IMAGE_PROVIDER', ['cloudflare', 'gemini'], '', 'first provider for new images; empty = cloudflare when '
    + 'CF_ACCOUNT_ID and CF_AI_TOKEN are set, else gemini (the other one is the fallback)'),
  str('CF_ACCOUNT_ID', '', 'Cloudflare account id for Workers AI image generation'),
  secret('CF_AI_TOKEN', 'Cloudflare API token with Workers AI permission (image generation)'),
  str('CF_IMAGE_MODEL', '@cf/black-forest-labs/flux-1-schnell', 'Workers AI text-to-image model'),
  // Colon Music (v0.19.0; YouTube since v0.21.0): modules/music, GET /music/search
  secret('YOUTUBE_API_KEY', 'YouTube Data API v3 key (free, Google Cloud Console) for "play X": Colon finds the song '
    + 'and plays it in its own YouTube player; empty = "play X" opens the YouTube app'),
  num('RESEARCH_MAX_QUERIES', 4, 'web searches one deep research task runs (one per job step)'),
  num('RESEARCH_MAX_PAGES', 8, 'pages one deep research task reads (a few per job step)'),
  num('RESEARCH_STEP_MS', 35000, 'longest single deep research step (the report is written in one); keep it under '
    + 'JOBS_TIME_LIMIT_MS'),
  // Payments (v0.13.0): Korapay Checkout Redirect for plan upgrades (modules/payments). Off until the key is set.
  secret('KORAPAY_SECRET_KEY', 'Korapay secret key (sk_test_… or sk_live_…); payments are off while empty'),
  url('KORAPAY_API_URL', 'https://api.korapay.com/merchant/api/v1', 'Korapay merchant API base URL'),
  url('APP_URL_API', 'https://api.apparatus.name.ng', 'public API URL (Korapay webhook: /payments/korapay/webhook)'),
  num('PAYMENT_PERIOD_DAYS', 30, 'days one plan payment lasts; paying again extends it'),
  str('UPLOAD_DIR', path.resolve(__dirname, '../../storage/uploads'), 'uploaded files, outside every web root'),
  num('UPLOAD_QUOTA_MB', 200, 'per-user upload quota'),
  // Model router tuning
  num('AI_FIRST_TOKEN_TIMEOUT_MS', 25000, 'give up on a model that has not started answering'),
  oneOf('AI_MODEL_SET', ['gemma', 'all'], 'gemma',
    'gemma = Saga uses Gemma 4 only (26B, 31B on failure, one at a time); all = the full routing table'),
  // 0.11.5: the chat model decides itself whether to browse (Gemini function calling, modules/ai/tool-call.js)
  oneOf('CHAT_BROWSER_TOOLS', ['on', 'off'], 'on',
    'on = the chat model gets the browser tools (browse, read_page, stop_browsing); off = keyword routing only'),
  str('CHAT_TOOL_MODEL', 'gemini-3.5-flash-lite', 'chat / tool model on Google AI Studio (needs GEMINI_API_KEY)'),
  str('WORKSPACE_MODEL', 'gemini-3.5-flash-lite', 'Workspace builds and quick answers try this first; off = chain'),
  str('CHAT_TOOL_FALLBACK_MODEL', 'gemma-4-26b-a4b-it', 'tool model when the first fails ("off" to skip)'),
  num('CHAT_TOOL_TIMEOUT_MS', 15000, 'a tool model that has not started answering by then hands over to the next'),
  str('AI_SUPPORT_MODELS', '', 'support models after Gemma 4, "provider:model, ..." in order; off = none; empty = '
    + 'GEMINI_SUPPORT_MODELS, GROQ_SUPPORT_MODEL then OPENROUTER_SUPPORT_MODEL (0.11.0)'),
  str('GEMINI_SUPPORT_MODELS', 'gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.8-flash,gemini-4-hydrogen',
    'Google AI Studio support models after Gemma 4, comma list in order (needs GEMINI_API_KEY; off = skip)'),
  oneOf('GEMINI_SUPPORT_VISION', ['0', '1'], '1', 'Gemini support models read images (1) or not (0)'),
  num('GEMINI_SUPPORT_UNAVAILABLE_REST_HOURS', 24,
    'a Gemini support model Google answers "not found" / "not available" for is skipped this long'),
  str('GROQ_SUPPORT_MODEL', 'openai/gpt-oss-120b', 'Groq support model (needs GROQ_API_KEY; off = skip)'),
  str('OPENROUTER_SUPPORT_MODEL', 'google/gemma-4-31b-it:free', 'OpenRouter support model (needs OPENROUTER_API_KEY)'),
  num('GROQ_SUPPORT_MAX_INPUT_TOKENS', 5000, 'prompt budget for Groq support models (8K tokens a minute free)'),
  num('OPENROUTER_SUPPORT_MAX_INPUT_TOKENS', 24000, 'prompt budget for OpenRouter support models'),
  str('GROQ_SUPPORT_REASONING', 'low', 'reasoning_effort for gpt-oss on Groq: low, medium or high'),
  num('AI_RETRY_WAIT_MS', 3000, 'a 429 with Retry-After up to this is waited out and retried once (0 = never)'),
  num('AI_HEDGE', 2, 'models asked at once per wave (1 = one after another)'),
  oneOf('AI_SPECIALIST_ROUTING', ['on', 'off'], 'on',
    'specialist routing: the benchmark winner per task category leads the chain (Admin › Routing overrides)'),
  num('AI_IDLE_TIMEOUT_MS', 30000, 'give up on a stream that went quiet'),
  // 0.22.1: voice mode replies (POST /conversations/:id/messages with voice: true) are short and fast.
  num('CHAT_VOICE_MAX_TOKENS', 300, 'output cap for a spoken reply in voice mode'),
  num('CHAT_VOICE_FIRST_TOKEN_MS', 8000, 'voice mode: a model that has not started answering by then hands over'),
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
  str('GEMINI_SHOW_THOUGHTS', 'on', 'on or off: show Gemini thought summaries'),
  str('GEMINI_THOUGHT_LEVEL', 'low', 'thinkingLevel used instead of minimal when thoughts are shown (off keeps it)'),
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
  num('SAGA_SCHEDULES_MAX', 10, 'scheduled browsing checks a user may keep (0.11.0)'),
  num('SAGA_RECONNECT_GRACE_MS', 90000,
    'a task whose phone socket dropped waits this long for the same phone to reconnect before it ends (0.10.4)'),
  // Crash Predictor (0.39.2; modules/crash/engine.js)
  num('CRASH_BET_MIN_CHANCE', 0.8, 'JetX: BET only when the estimated chance the next round reaches the target is '
    + 'at least this (0..1; 0.8 = 80%); below it the verdict is WAIT'),
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
