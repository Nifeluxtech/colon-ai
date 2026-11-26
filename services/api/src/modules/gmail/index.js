// Gmail, send only (0.40.0): see gmail.js. Routes: http/routes/gmail.js.
module.exports = { ...require('./gmail'), mime: require('./mime'), ...require('./store'),
  handlers: require('./handlers') };
