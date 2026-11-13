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
  // Phase 3: Colon AI chat. AI provider keys are read by src/modules/ai/routing.js (enabled only when a key is set).
  chat: {
    dailyLimit: Number(env('CHAT_DAILY_LIMIT', 100)),        // replies per signed-in user per UTC day
    guestDailyLimit: Number(env('CHAT_GUEST_DAILY_LIMIT', 15)), // replies per guest browser per UTC day
    guestIpDailyLimit: Number(env('CHAT_GUEST_IP_DAILY_LIMIT', 300)), // all guests on one IP (carrier NAT) per UTC day
    uploadDir: env('UPLOAD_DIR'),
    uploadQuotaMb: Number(env('UPLOAD_QUOTA_MB', 200)),       // per user, across all their files
    firstTokenTimeoutMs: Number(env('AI_FIRST_TOKEN_TIMEOUT_MS', 25000)),
    hedge: Number(env('AI_HEDGE', 2)),   // models asked at once per wave (1 = one after another)
    specialistRouting: env('AI_SPECIALIST_ROUTING', 'on') !== 'off',   // read live by modules/ai/specialists.js
    idleTimeoutMs: Number(env('AI_IDLE_TIMEOUT_MS', 30000)),
    maxReplyMs: Number(env('AI_MAX_REPLY_MS', 180000)),
    maxTokens: Number(env('AI_MAX_TOKENS', 4096)),
    developerMaxTokens: Number(env('AI_DEVELOPER_MAX_TOKENS', 8192)),  // Developer mode replies (full files)
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
