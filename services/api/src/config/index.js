// All settings come from environment variables set in cPanel > Setup Node.js App. The schema (every key,
// its type and default) is config/defaults.js; assertValid() runs at boot and refuses to start on a
// missing required key or a malformed value. Never put secrets in this repository (it is public).
const { read, list, validate, ConfigError } = require('./env');
const { SCHEMA } = require('./defaults');

const DEFAULTS = Object.fromEntries(SCHEMA.map(i => [i.key, i.default]));
const env = (k, d = DEFAULTS[k]) => read(process.env, k, d);

module.exports = {
  port: Number(env('PORT', 3000)),
  nodeEnv: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV', 'development') === 'production',
  appName: 'Colon AI',
  allowedOrigins: list(env('ALLOWED_ORIGINS')),
  db: {
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', 3306)),
    user: env('DB_USER', ''),
    password: env('DB_PASSWORD', ''),
    database: env('DB_NAME', ''),
  },
  auth: {
    // 32+ random characters. Encrypts 2FA secrets. Required for 2FA.
    appSecret: env('APP_SECRET', ''),
    cookieName: 'colon_sid',
    cookieDomain: env('COOKIE_DOMAIN', ''),          // e.g. .apparatus.name.ng (shared by all apps)
    sessionDays: Number(env('SESSION_DAYS', 30)),
    ownerEmail: env('OWNER_EMAIL', '').toLowerCase(), // this account becomes Super Admin
    googleClientId: env('GOOGLE_CLIENT_ID', ''),
    totpIssuer: 'Colon AI',
  },
  mail: {
    brevoKey: env('BREVO_API_KEY', ''),
    from: env('MAIL_FROM', 'no-reply@apparatus.name.ng'),
    fromName: env('MAIL_FROM_NAME', 'Colon AI'),
  },
  urls: {
    chat: env('APP_URL_CHAT', 'https://chat.apparatus.name.ng'),
  },
  // 0.40.0: send-only Gmail (modules/gmail). Uses GOOGLE_CLIENT_ID; off while GOOGLE_CLIENT_SECRET is empty.
  gmail: {
    clientSecret: env('GOOGLE_CLIENT_SECRET', ''),
    redirect: env('GMAIL_REDIRECT_URI', ''),
  },
  // Phase 3: Colon AI chat. AI provider keys are read by src/modules/ai/routing.js (enabled only when a key is set).
  chat: {
    dailyLimit: Number(env('CHAT_DAILY_LIMIT', 100)),        // replies per signed-in user per UTC day
    guestDailyLimit: Number(env('CHAT_GUEST_DAILY_LIMIT', 15)), // replies per guest browser per UTC day
    guestIpDailyLimit: Number(env('CHAT_GUEST_IP_DAILY_LIMIT', 300)), // all guests on one IP (carrier NAT) per UTC day
    uploadDir: env('UPLOAD_DIR'),
    uploadQuotaMb: Number(env('UPLOAD_QUOTA_MB', 200)),       // per user, across all their files
    firstTokenTimeoutMs: Number(env('AI_FIRST_TOKEN_TIMEOUT_MS', 25000)),
    modelSet: env('AI_MODEL_SET', 'gemma'),   // gemma | all; read live by modules/ai/model-set.js
    hedge: Number(env('AI_HEDGE', 2)),   // models asked at once per wave (1 = one after another)
    // 0.11.5: browser tools for the chat model (CHAT_TOOL_* are read live by modules/ai/tool-call.js).
    browserTools: env('CHAT_BROWSER_TOOLS', 'on') !== 'off',
    toolModel: env('CHAT_TOOL_MODEL', 'gemini-3.5-flash-lite'),
    toolFallbackModel: env('CHAT_TOOL_FALLBACK_MODEL', 'gemma-4-26b-a4b-it'),
    toolTimeoutMs: Number(env('CHAT_TOOL_TIMEOUT_MS', 15000)),
    specialistRouting: env('AI_SPECIALIST_ROUTING', 'on') !== 'off',   // read live by modules/ai/specialists.js
    idleTimeoutMs: Number(env('AI_IDLE_TIMEOUT_MS', 30000)),
    voiceMaxTokens: Number(env('CHAT_VOICE_MAX_TOKENS', 300)),        // 0.22.1: spoken replies stay short
    voiceFirstTokenMs: Number(env('CHAT_VOICE_FIRST_TOKEN_MS', 8000)),
    maxReplyMs: Number(env('AI_MAX_REPLY_MS', 180000)),
    maxTokens: Number(env('AI_MAX_TOKENS', 4096)),
    developerMaxTokens: Number(env('AI_DEVELOPER_MAX_TOKENS', 8192)),  // Developer mode replies (full files)
  },
  // v0.12.0 billing (modules/billing): plans, credits, usage events. See docs/blueprint-roadmap.md step A.
  billing: {
    mode: env('BILLING_MODE'),   // off | shadow | enforce
    credits: {
      chat: Number(env('BILLING_CREDITS_CHAT')),
      research: Number(env('BILLING_CREDITS_RESEARCH')),
      saga: Number(env('BILLING_CREDITS_SAGA')),
      image: Math.max(0, Number(env('BILLING_CREDITS_IMAGE'))),               // v0.17.0
      deepResearch: Math.max(0, Number(env('BILLING_CREDITS_DEEP_RESEARCH'))),
    },
    // v0.14.0 (A6): per-model prices (modules/ai/costs.js) and the daily spend alert. Display only.
    modelCosts: env('AI_MODEL_COSTS'),
    dailySpendCapMinor: Number(env('BILLING_DAILY_SPEND_CAP_MINOR')),
  },
  // v0.24.0 project repositories (modules/repos): download and snapshot caps.
  repos: {
    enabled: env('REPO_IMPORT', 'on') !== 'off',
    archiveMaxMb: Math.max(1, Number(env('REPO_ARCHIVE_MAX_MB'))),
    maxFiles: Math.max(10, Number(env('REPO_MAX_FILES'))),
    maxTextMb: Math.min(12, Math.max(0.1, Number(env('REPO_MAX_TEXT_MB')))),
    fileMaxKb: Math.max(1, Number(env('REPO_FILE_MAX_KB'))),
    timeoutMs: Math.max(5000, Number(env('REPO_TIMEOUT_MS'))),
    gitBin: env('REPO_GIT_BIN', 'git'),
  },
  // v0.15.0 memory (modules/memory): consent is per user (off until they turn it on); retrieval budget in tokens.
  memory: {
    tokenBudget: Math.max(0, Number(env('MEMORY_TOKEN_BUDGET'))),
    maxItems: Math.max(1, Number(env('MEMORY_MAX_ITEMS'))),
  },
  // v0.16.0 jobs (modules/jobs): the job table, the cron dispatcher (scripts/cron.js) and its fallbacks.
  jobs: {
    cronIntervalMin: Math.max(1, Number(env('JOBS_CRON_INTERVAL_MIN'))),
    batchSize: Math.min(100, Math.max(1, Number(env('JOBS_BATCH_SIZE')))),
    timeLimitMs: Math.max(5000, Number(env('JOBS_TIME_LIMIT_MS'))),
    leaseMs: Math.max(10000, Number(env('JOBS_LEASE_MS'))),
    maxAttempts: Math.min(50, Math.max(1, Number(env('JOBS_MAX_ATTEMPTS')))),
    backoffMs: Math.max(1000, Number(env('JOBS_BACKOFF_MS'))),
    keepDays: Math.max(1, Number(env('JOBS_KEEP_DAYS'))),
    inprocess: env('JOBS_INPROCESS') === 'on',
    cronSecret: env('CRON_SECRET'),
  },
  // v0.17.0 tools and media (modules/tools, modules/media, modules/research): image generation and deep research.
  media: {
    imageModel: String(env('IMAGE_MODEL') || '').trim(),   // empty = image generation off
    imageTimeoutMs: Math.max(5000, Number(env('IMAGE_TIMEOUT_MS'))),
    // v0.17.1: '' = automatic (cloudflare when its account and token are set); see modules/media/route.js
    imageProvider: String(env('IMAGE_PROVIDER') || '').trim(),
    cf: { accountId: String(env('CF_ACCOUNT_ID') || '').trim(), token: String(env('CF_AI_TOKEN') || '').trim(),
      model: String(env('CF_IMAGE_MODEL') || '').trim() || '@cf/black-forest-labs/flux-1-schnell' },
  },
  research: {
    maxQueries: Math.min(8, Math.max(1, Number(env('RESEARCH_MAX_QUERIES')))),
    maxPages: Math.min(20, Math.max(1, Number(env('RESEARCH_MAX_PAGES')))),
    stepMs: Math.max(10000, Number(env('RESEARCH_STEP_MS'))),
  },
  // v0.13.0 payments (modules/payments): Korapay Checkout Redirect. Off while KORAPAY_SECRET_KEY is empty.
  payments: {
    korapaySecret: env('KORAPAY_SECRET_KEY'),
    korapayUrl: String(env('KORAPAY_API_URL')).replace(/\/+$/, ''),
    apiUrl: String(env('APP_URL_API')).replace(/\/+$/, ''),
    returnUrl: String(env('APP_URL_CHAT', 'https://chat.apparatus.name.ng')).replace(/\/+$/, '') + '/',
    periodDays: Number(env('PAYMENT_PERIOD_DAYS')),
  },
  // Safety layer (modules/safety, ADR 0003). Admin › Safety can switch provider moderation and categories live.
  safety: {
    enabled: env('SAFETY') !== 'off',
    logText: env('SAFETY_LOG_TEXT'),                 // off | hash | excerpt
    providerModeration: env('SAFETY_PROVIDER_MODERATION') === 'on',
    moderationUrl: env('SAFETY_MODERATION_URL'),
    moderationKey: env('SAFETY_MODERATION_API_KEY'),
    moderationModel: env('SAFETY_MODERATION_MODEL'),
    moderationTimeoutMs: Number(env('SAFETY_MODERATION_TIMEOUT_MS')),
  },
  // Throws a ConfigError listing every problem; http/server.js calls it before anything else starts.
  assertValid(envVars = process.env) {
    const problems = validate(SCHEMA, envVars);
    if (problems.length) throw new ConfigError(problems);
  },
};
