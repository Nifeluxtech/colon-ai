/* ColonURL: address-bar parsing and URL safety checks shared by Colon Browser and the
   browser panel in Colon AI. Pure functions (no DOM), unit-tested in packages/ui/test.

   The real SSRF protection must live on the server's /browser/fetch endpoint (it resolves DNS,
   so it can see a public hostname that points at a private IP). This client-side guard is the
   first line: it stops obviously unsafe addresses before any request is made. */
// The page's global object in the browser; globalThis under Node (unit tests).
const root = typeof window !== 'undefined' ? window : globalThis;

var ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  wikipedia: { name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' }
};
var ALLOWED_PORTS = { '': 1, '80': 1, '443': 1, '8080': 1, '8443': 1 };
var TLD_RE = new RegExp(
  String.raw`\.(com|org|net|ng|edu|gov|io|co|ai|app|dev|info|biz|me|tv|uk|us|za|ke|gh|africa|news|blog|site|online|`
  + String.raw`tech|store|xyz|wiki|int|eu|de|fr|ca|au|in)(\/|:|$|\?|#)`, 'i');

function searchUrl(q, engine) { return (ENGINES[engine] || ENGINES.google).url + encodeURIComponent(String(q).trim()); }

// Classifies what the user typed into the address bar.
// -> { type: 'internal'|'url'|'search', url, query? }
function parseInput(input, engine) {
  var s = String(input || '').trim();
  if (!s) return null;
  if (/^colon:\/\/[a-z-]+/i.test(s)) return { type: 'internal', url: s.toLowerCase() };
  if (/^(javascript|data|vbscript|file|blob|about|chrome|intent):/i.test(s)) return { type: 'search', url: searchUrl(s,
    engine), query: s };
  if (/^https?:\/\//i.test(s)) return { type: 'url', url: normalize(s) || s };
  if (!/\s/.test(s)) {
    if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)
      || /^\[[0-9a-f:]+\](:\d+)?/i.test(s)) return { type: 'url', url: 'http://' + s };
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(s) && (TLD_RE.test(s) || /^www\./i.test(s))) return { type: 'url',
      url: normalize('https://' + s) || 'https://' + s };
  }
  return { type: 'search', url: searchUrl(s, engine), query: s };
}

function normalize(u) {
  try { var x = new URL(u); x.hash = x.hash; return x.href; } catch (e) { return null; }
}

function ipv4Parts(h) {
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) {
    // single-number or hex forms (http://2130706433/, http://0x7f000001/) resolve to IPs in browsers
    if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) { var n = Number(h); if (n >= 0 && n <= 0xffffffff) return [n >>> 24,
      (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
    return null;
  }
  var p = m.slice(1).map(Number); return p.every(function (x) { return x <= 255; }) ? p : null;
}
function privateV4(p) {
  var a = p[0], b = p[1];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
}

// True for hosts that must never be fetched: loopback, private, link-local, metadata, internal names.
function isBlockedHost(host) {
  var h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || /\.(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(h)) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;
  if (h.charAt(0) === '[' || h.indexOf(':') > -1) { // IPv6 literal
    var v6 = h.replace(/^\[|\]$/g, '');
    if (v6 === '::' || v6 === '::1' || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6)) return true;
    var mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6); if (mapped) return privateV4(ipv4Parts(mapped[1]) || [0]);
    if (/^::ffff:/.test(v6)) return true;
    return false;
  }
  var p = ipv4Parts(h);
  if (p) return privateV4(p);
  if (!/\./.test(h)) return true; // single-label names (intranet hosts)
  return false;
}

// -> { ok: true, url } | { ok: false, reason, message }
function guard(u) {
  var x;
  try { x = new URL(String(u)); } catch (e) { return { ok: false, reason: 'invalid',
    message: 'That doesn’t look like a web address.' }; }
  if (x.protocol !== 'http:' && x.protocol !== 'https:') return { ok: false, reason: 'scheme',
    message: 'Only http and https pages can be opened.' };
  if (x.username || x.password) return { ok: false, reason: 'credentials',
    message: 'Addresses with a username or password are blocked.' };
  if (!ALLOWED_PORTS[x.port]) return { ok: false, reason: 'port', message: 'That port isn’t allowed in reader mode.' };
  if (isBlockedHost(x.hostname)) return { ok: false, reason: 'private',
    message: 'Private and local network addresses are blocked for your safety.' };
  if (x.href.length > 2048) return { ok: false, reason: 'too_long', message: 'That address is too long.' };
  return { ok: true, url: x.href };
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function displayUrl(u) {
  if (!u) return '';
  if (/^colon:/.test(u)) return u;
  try { var x = new URL(u); var p = (x.pathname === '/' ? '' : x.pathname) + x.search; return x.hostname.replace(
    /^www\./, '') + (p.length > 60 ? p.slice(0, 57) + '…' : p); } catch (e) { return u; }
}
function isSecure(u) { return /^https:\/\//i.test(u || ''); }
function resolve(href, base) { try { return new URL(href, base).href; } catch (e) { return null; } }
function queryFrom(u) { // recover the search terms from a known engine results URL
  try {
    var x = new URL(u);
    if (/google\.|bing\.com|duckduckgo\.com/.test(x.hostname)) return x.searchParams.get('q');
    if (/wikipedia\.org$/.test(x.hostname) && x.searchParams.get('search')) return x.searchParams.get('search');
  } catch (e) {}
  return null;
}

var api = { ENGINES: ENGINES, parseInput: parseInput, searchUrl: searchUrl, guard: guard, isBlockedHost: isBlockedHost,
  hostOf: hostOf, displayUrl: displayUrl, isSecure: isSecure, resolve: resolve, queryFrom: queryFrom,
  normalize: normalize };
if (typeof window !== 'undefined') window.ColonURL = api;

export { api as ColonURL };
