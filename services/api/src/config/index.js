// All settings come from environment variables set in cPanel > Setup Node.js App.
// Never put secrets in this repository (it is public).
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const list = (v) => v.split(',').map(s => s.trim()).filter(Boolean);

module.exports = {
  port: Number(env('PORT', 3000)),
  nodeEnv: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV', 'development') === 'production',
  appName: 'Colon AI',
  allowedOrigins: list(env('ALLOWED_ORIGINS',
    'https://chat.apparatus.name.ng,https://browser.apparatus.name.ng,https://admin.apparatus.name.ng')),
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
};
