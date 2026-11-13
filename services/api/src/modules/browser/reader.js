// The server reader behind GET /browser/fetch (Phase 8, docs/phase8-backend-contract.md §1): one public page,
// fetched on the server and returned as clean, script-free reader HTML for web light mode.
// Order: switch -> URL shape -> block list -> cache -> (per hop: SSRF check, block list, robots.txt) -> fetch ->
// type/size/status -> sanitise -> sign-in wall check -> cache. Errors are { status, code, extra } ready for HTTP.
// Privacy: page contents are never logged; one line per request with user_id, host, status, bytes and ms.
// Pages are cached for 10 minutes: shared between users only when the upstream answer had no Set-Cookie and its
// Cache-Control allows shared caching; otherwise only for the same user (or guest IP).
const safety = require('../safety');
const search = require('../search');
const log = require('../../shared/logger');
const net = require('./net');
const html = require('./html');
const { createRobots } = require('./robots');
const { env } = require('./env');

const TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;
const ROBOTS_MS = 3000;
const READABLE = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;
const cache = new search.reader.Lru(150, 10 * 60 * 1000);

const enabled = () => env('BROWSER_READER', 'on') !== 'off';
const guestsAllowed = () => env('BROWSER_READER_GUESTS', 'on') !== 'off';

function readerError(status, code, message, extra) {
  return Object.assign(new Error(message), { status, code, extra, reader: true });
}

const MESSAGES = {
  bad_url: [400, 'Give an absolute http or https URL.'],
  blocked_private: [403, 'That address is not on the public internet.'],
  blocked_site: [403, 'Colon doesn’t open this site.'],
  blocked_robots: [403, 'This site asks automated readers not to open this page.'],
  too_large: [413, 'This page is larger than the reader allows (2 MB).'],
  not_html: [415, 'This isn’t a web page the reader can show.'],
  needs_login: [422, 'This page needs you to sign in. Open it in the Colon Browser app.'],
  upstream_error: [502, 'The site didn’t answer properly.'],
  timeout: [504, 'The site took too long to answer.'],
  not_enabled: [501, 'The server reader is switched off.'],
};
const fail = (code, extra, message) => readerError(MESSAGES[code][0], code, message || MESSAGES[code][1], extra);

function checkHost(hostname) {
  const extra = String(env('BROWSER_READER_BLOCKLIST', '')).split(',');
  const b = safety.blockedHost(hostname, { extra });
  if (b.blocked) throw fail('blocked_site', { category: b.category });
}

// robots.txt through the same guarded fetch (SSRF rules, pinned address), small and quick.
const robots = createRobots({
  fetchText: async (url, signal, ctx) => {
    const r = await net.fetchPage(url, { timeoutMs: ROBOTS_MS, maxBytes: 256 * 1024, maxRedirects: 5, signal,
      lookup: ctx.lookup, transport: ctx.transport, accept: 'text/plain,*/*;q=0.1' });
    return { status: r.status, text: r.body.toString('utf8') };
  },
});

// Maps a net.js error code to the contract's error.
function mapNetError(e) {
  if (e && e.reader) return e;
  switch (e && e.code) {
    case 'bad_url': return fail('bad_url', undefined, e.message);
    case 'blocked_private': return fail('blocked_private');
    case 'timeout': return fail('timeout');
    case 'dns': return fail('upstream_error', { upstream_status: null }, 'That site could not be found.');
    case 'too_many_redirects': return fail('upstream_error', { upstream_status: null }, e.message);
    default: return fail('upstream_error', { upstream_status: null }, 'Could not connect to the site.');
  }
}

function shareable(headers) {
  if (headers['set-cookie']) return false;
  const cc = String(headers['cache-control'] || '').toLowerCase();
  return !/\b(private|no-store|no-cache)\b/.test(cc) && !/\bs-maxage\s*=\s*0\b/.test(cc);
}

async function fetchAndRead(rawUrl, o) {
  const res = await net.fetchPage(rawUrl, {
    timeoutMs: o.timeoutMs || TIMEOUT_MS, maxBytes: MAX_BYTES, lookup: o.lookup, transport: o.transport,
    onHop: async (u, signal) => {
      checkHost(u.hostname);
      if (!(await robots.check(u, signal, o))) throw fail('blocked_robots');
    },
    head: (r) => r.status >= 400 || !READABLE.test(String(r.headers['content-type'] || 'text/html')),
  }).catch((e) => { throw mapNetError(e); });
  if (res.tooLarge) throw fail('too_large');
  if (res.status === 401 || res.status === 407) throw fail('needs_login');
  if (res.status >= 300) throw fail('upstream_error', { upstream_status: res.status });
  const type = String(res.headers['content-type'] || 'text/html');
  if (!READABLE.test(type)) throw fail('not_html', { content_type: type.split(';')[0].trim().slice(0, 100) });
  const body = search.net.decode(res.body, type);
  let page;
  if (/^text\/plain/i.test(type)) {
    page = { title: '', byline: '', lang: '', html: html.plainToHtml(body), text: body.slice(0, 200000) };
  } else {
    const clean = html.sanitize(body, res.url);
    page = { ...html.meta(body), ...clean };
    if (html.looksLikeLogin(body, clean.text, res.url)) throw fail('needs_login');
  }
  const out = { url: String(rawUrl), final_url: res.url, status: res.status, title: page.title };
  if (page.byline) out.byline = page.byline;
  if (page.lang) out.lang = page.lang;
  Object.assign(out, { html: page.html, text: page.text, fetched_at: new Date().toISOString().replace(/\.\d+Z$/,
    'Z'), cached: false });
  if (res.truncated) out.truncated = true;
  return { page: out, bytes: res.body.length, shared: shareable(res.headers) };
}

/**
 * read(url, { userId, cacheKey, lookup, transport, timeoutMs }) -> the contract's 200 body.
 * cacheKey identifies the caller for private cache entries ('u<id>' or 'ip:<addr>'). Throws reader errors
 * ({ status, code, extra }).
 */
async function read(rawUrl, o = {}) {
  const t0 = Date.now();
  let host = '', status = 0, bytes = 0, code = null, cached = false;
  try {
    if (!enabled()) throw fail('not_enabled');
    let u;
    try { u = net.parseUrl(rawUrl); } catch (e) { throw mapNetError(e); }
    host = u.hostname;
    checkHost(host);
    const key = u.toString();
    const who = String(o.cacheKey || (o.userId ? `u${o.userId}` : 'guest'));
    const hit = cache.get(`s|${key}`) || cache.get(`p|${who}|${key}`);
    if (hit) { cached = true; status = hit.status; return { ...hit, url: String(rawUrl), cached: true }; }
    const r = await fetchAndRead(rawUrl, o);
    status = r.page.status; bytes = r.bytes;
    cache.set(r.shared ? `s|${key}` : `p|${who}|${key}`, r.page);
    return r.page;
  } catch (e) {
    const err = e && e.reader ? e : mapNetError(e);
    code = err.code; status = (err.extra && err.extra.upstream_status) || status;
    throw err;
  } finally {
    log.info('browser_fetch', { user_id: o.userId || null, host, status, bytes, ms: Date.now() - t0, cached,
      ...(code ? { error: code } : {}) });
  }
}

module.exports = { read, enabled, guestsAllowed, cache, robots, readerError, MESSAGES, TIMEOUT_MS, MAX_BYTES };
