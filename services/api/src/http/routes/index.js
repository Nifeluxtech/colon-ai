// The API route table, in registration order (the first matching route wins).
// Route files only wire paths to guards, rate limits and handlers; the handlers live in modules/*/handlers/.
const Router = require('../router');

module.exports = new Router()
  .use(require('./health'))
  .use(require('./auth'))
  .use(require('./account'))
  .use(require('./admin'))
  .use(require('./chat'));
