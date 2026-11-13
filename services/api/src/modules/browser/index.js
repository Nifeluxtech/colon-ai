// Browser module (Phase 8, docs/phase8-backend-contract.md): the server reader behind GET /browser/fetch (web
// light mode). Other layers import only this file.
module.exports = {
  reader: require('./reader'),
  html: require('./html'),
  net: require('./net'),
  robots: require('./robots'),
  handlers: {
    reader: require('./handlers/reader'),
  },
};
