// Chat routes (models, conversations, messages, settings, guest chat, uploads), in registration order (the order is part of the contract: the first match wins).
const Router = require('../../router');

module.exports = new Router()
  .use(require('./conversations'))
  .use(require('./messages'))
  .use(require('./settings'))
  .use(require('./guest'))
  .use(require('./uploads'));
