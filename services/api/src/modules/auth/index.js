// Auth module: sessions (cookies), route guards, suspension checks and TOTP (2FA).
module.exports = {
  guards: require('./guards'),
  sessions: require('./sessions'),
  suspension: require('./suspension'),
  totp: require('./totp'),
  handlers: {
    session: require('./handlers/session'),
    signup: require('./handlers/signup'),
    login: require('./handlers/login'),
    google: require('./handlers/google'),
    logout: require('./handlers/logout'),
    recovery: require('./handlers/recovery'),
  },
};
