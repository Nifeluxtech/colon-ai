// Admin Dashboard routes (/admin/*), in registration order (the order is part of the contract: the first match wins).
const Router = require('../../router');

module.exports = new Router()
  .use(require('./overview'))
  .use(require('./users'))
  .use(require('./moderation'))
  .use(require('./audit'))
  .use(require('./ai'))
  .use(require('./routing'))
  .use(require('./limits'))
  .use(require('./evaluation'))
  .use(require('./platform'))
  .use(require('./web-search'))
  .use(require('./safety'))
  .use(require('./saga'));
