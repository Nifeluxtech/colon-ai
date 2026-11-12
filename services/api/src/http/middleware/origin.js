// Guest chat origin check: in production, guest endpoints only answer the Colon apps' own origins.
const config = require('../../config');
const { guards } = require('../../modules/auth');

function guestOrigin(req) {
  const origin = req.headers.origin;
  if (config.isProd && (!origin || !config.allowedOrigins.includes(origin))) guards.deny(403, 'csrf', 'Request blocked.');
}

module.exports = { guestOrigin };
