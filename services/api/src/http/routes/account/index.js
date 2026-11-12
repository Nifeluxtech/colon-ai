// Account routes (/account/*), in registration order (the order is part of the contract: the first match wins).
const Router = require('../../router');

module.exports = new Router()
  .use(require('./profile'))
  .use(require('./sessions'))
  .use(require('./totp'))
  .use(require('./delete'));
