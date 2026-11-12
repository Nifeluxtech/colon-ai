// Auth module: sessions (cookies), route guards, suspension checks and TOTP (2FA).
module.exports = {
  guards: require('./guards'),
  sessions: require('./sessions'),
  suspension: require('./suspension'),
  totp: require('./totp'),
};
