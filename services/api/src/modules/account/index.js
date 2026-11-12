// Account module: profile, password, sessions, two-factor authentication and account deletion.
module.exports = {
  handlers: {
    profile: require('./handlers/profile'),
    sessions: require('./handlers/sessions'),
    totp: require('./handlers/totp'),
    remove: require('./handlers/delete'),
  },
};
