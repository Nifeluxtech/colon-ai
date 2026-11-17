// Account module: profile, password, sessions, two-factor authentication, account deletion and billing.
module.exports = {
  handlers: {
    profile: require('./handlers/profile'),
    sessions: require('./handlers/sessions'),
    totp: require('./handlers/totp'),
    remove: require('./handlers/delete'),
    billing: require('./handlers/billing'),
  },
};
