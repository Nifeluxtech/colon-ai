// The API route table, in registration order (the first matching route wins).
// Route files only wire paths to guards, rate limits and handlers; the handlers live in modules/*/handlers/.
const Router = require('../router');

module.exports = new Router()
  .use(require('./health'))
  .use(require('./auth'))
  .use(require('./account'))
  .use(require('./payments'))
  .use(require('./internal'))
  .use(require('./admin'))
  .use(require('./chat'))
  .use(require('./media'))
  .use(require('./research'))
  .use(require('./memory'))
  .use(require('./projects'))
  .use(require('./workspace'))
  .use(require('./sites'))
  .use(require('./study'))
  .use(require('./voice'))
  .use(require('./music'))
  .use(require('./crash'))
  .use(require('./browser'));
