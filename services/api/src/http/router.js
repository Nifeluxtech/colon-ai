// Tiny router: "METHOD /path/:param" patterns, async handlers returning [status, body, headers?].
// A plain object among the handlers sets route options: { body: 'raw' } leaves the request stream unread
// (uploads), { bodyLimit: bytes } raises the 64 KB JSON cap. A handler that writes the response itself
// (streams, files) returns nothing.
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)';
      }) + '$');
    const opts = Object.assign({}, ...handlers.filter(h => typeof h !== 'function'));
    this.routes.push({ method, re, keys, handlers: handlers.filter(h => typeof h === 'function'), opts });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }
  use(other) { this.routes.push(...other.routes); return this; }
  match(method, path) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = path.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params, opts: r.opts || {} };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

module.exports = Router;
