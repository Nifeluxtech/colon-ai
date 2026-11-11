// All settings come from environment variables set in cPanel > Setup Node.js App.
// Never put secrets in this repository (it is public).
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = {
  port: Number(env('PORT', 3000)),
  nodeEnv: env('NODE_ENV', 'development'),
  appName: 'Colon AI',
  allowedOrigins: env('ALLOWED_ORIGINS',
    'https://chat.apparatus.name.ng,https://browser.apparatus.name.ng,https://admin.apparatus.name.ng').split(',').map(s => s.trim()),
  db: {
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', 3306)),
    user: env('DB_USER', ''),
    password: env('DB_PASSWORD', ''),
    database: env('DB_NAME', ''),
  },
};
