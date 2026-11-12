// Dumps the API route table (method, pattern, params, options, handler count) in registration order.
// Usage: node services/api/scripts/dump-routes.js [services/api dir] > routes.tsv  (diff two checkouts to prove
// a refactor kept every route, in order). Loads the real server with a fake DB and no listening socket.
const path = require('path');
const http = require('http');
const api = path.resolve(process.argv[2] || path.join(__dirname, '..'));
http.Server.prototype.listen = function () { return this; };
const dbPath = require.resolve(path.join(api, 'src/db'));
const fake = { query: async () => [], one: async () => null, migrate: async () => {}, pool: () => null };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: new Proxy(fake, { get: (t, k) => t[k]
  || (async () => null) }) };
const Router = require(path.join(api, 'src/http/router.js'));
let main = null;
const use = Router.prototype.use;
Router.prototype.use = function (o) { main = this; return use.call(this, o); };
require(path.join(api, 'app.js'));
for (const r of main.routes) {
  console.log([r.method, r.re.source, r.keys.join(','), JSON.stringify(r.opts), r.handlers.length].join('\t'));
}
process.exit(0);
