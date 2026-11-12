// Auth: public config and current user (handlers for src/http/routes/auth/session.js).

const config = require('../../../config');
const v = require('../../../shared/validate');
const { publicUser } = require('../guards');
const settings = require('../../../shared/settings');

// Public settings the apps need before sign-in (Phase 4 adds branding, flags, maintenance and the banner).
// GET /auth/config
const getAuthConfig = async () => {
  const sys = await settings.system();
  return [200, {
    google_client_id: config.auth.googleClientId || null,
    email_enabled: Boolean(config.mail.brevoKey),
    languages: v.LANGS,
    brand_name: sys.brandName,
    features: sys.features,
    maintenance: { on: Boolean(sys.maintenance.on), message: sys.maintenance.on ? sys.maintenance.message : '' },
    announcement: sys.announcement.on && sys.announcement.text ? { text: sys.announcement.text,
      tone: sys.announcement.tone } : null,
  }];
};

// GET /auth/me
const getAuthMe = async (req) => [200, { user: req.user ? publicUser(req.user) : null }];

module.exports = { getAuthConfig, getAuthMe };
