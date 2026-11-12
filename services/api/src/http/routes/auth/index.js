// Auth routes (/auth/*), in registration order (the order is part of the contract: the first match wins).
const Router = require('../../router');

module.exports = new Router()
  .use(require('./session'))
  .use(require('./signup'))
  .use(require('./login'))
  .use(require('./google'))
  .use(require('./logout'))
  .use(require('./recovery'));
