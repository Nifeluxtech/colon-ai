// Browser module (Phase 8, docs/phase8-backend-contract.md): the server reader behind GET /browser/fetch (web
// light mode) and the browser session manager (tabs, active tab, control owner and opt-in history per user and
// device) for the REST routes. Other layers import only this file.
module.exports = {
  reader: require('./reader'),
  html: require('./html'),
  net: require('./net'),
  robots: require('./robots'),
  session: require('./session'),
  store: require('./store'),
  handlers: {
    reader: require('./handlers/reader'),
    session: require('./handlers/session'),
    history: require('./handlers/history'),
  },
};
