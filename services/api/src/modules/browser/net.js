// Outbound HTTP for the server reader (Phase 8): SSRF-guarded, pinned to the address we checked.
//
// Every hop: http/https only, ports 80/443 only, no credentials in the URL, the host resolved here and every
// address public (the same isPrivateIp rules as web search: RFC 1918, loopback, link-local and cloud metadata,
// CGNAT, multicast, reserved, IPv6 ULA/link-local/multicast/mapped). The socket then connects to that exact
// address (a custom `lookup`, so there is no second DNS answer to rebind to); TLS still verifies the real host
// name. Redirects are followed by hand and each one is checked again, at most 5. No cookies or auth headers are
// ever sent, and the response's Set-Cookie is only reported, never kept.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');
const search = require('../search');

const { isPrivateIp } = search.net;
const UA = 'ColonReader/1.0 (+https://chat.apparatus.name.ng)';
const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|metadata\.google\.internal)$/i;

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

const lookupAll = (host) => new Promise((resolve, reject) => dns.lookup(host, { all: true, verbatim: true },
  (e, a) => (e ? reject(e) : resolve(a))));

// Parses and checks a URL's shape. Throws bad_url (scheme, credentials, port) or blocked_private (local names).
function parseUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { throw fail('bad_url', 'Give an absolute http or https URL.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw fail('bad_url', 'Only http and https pages.');
  if (u.username || u.password) throw fail('bad_url', 'URLs with a user name or password are not allowed.');
  if (u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80'))) {
    throw fail('bad_url', 'Only the standard web ports (80 and 443).');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw fail('bad_url', 'The URL has no host.');
  if (BLOCKED_NAMES.test(host)) throw fail('blocked_private', 'That address is not on the public internet.');
  u.hash = '';
  return u;
}

/**
 * resolve(url, { lookup }) -> { url: URL, address, family }. Every resolved address must be public; the first one
 * is the one we connect to. Throws bad_url | blocked_private | dns.
 */
async function resolve(raw, { lookup = lookupAll } = {}) {
  const u = parseUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) }];
  else {
    try { addrs = await lookup(host); } catch { throw fail('dns', 'That site could not be found.'); }
  }
  if (!addrs || !addrs.length) throw fail('dns', 'That site could not be found.');
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw fail('blocked_private', 'That address is not on the public internet.');
  }
  return { url: u, address: addrs[0].address, family: addrs[0].family || net.isIP(addrs[0].address) };
}

function decoder(res) {
  const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
  if (enc === 'gzip' || enc === 'x-gzip') return zlib.createGunzip();
  if (enc === 'deflate') return zlib.createInflate();
  if (enc === 'br') return zlib.createBrotliDecompress();
  return null;
}

/**
 * request(url: URL, { address, family }, { signal, maxBytes, accept }) -> { status, headers, body, truncated }
 * One GET to the pinned address. Reads at most maxBytes (decompressed); past that it stops and marks truncated.
 * Redirect responses come back without a body.
 */
function request(u, pin, o) {
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolveP, reject) => {
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || undefined,
      path: u.pathname + u.search, method: 'GET', agent: false, signal: o.signal,
      lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address: pin.address, family: pin.family }])
        : cb(null, pin.address, pin.family)),
      headers: { 'User-Agent': UA, Accept: o.accept || 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'Accept-Language': 'en-NG,en;q=0.9', 'Accept-Encoding': 'gzip, deflate, br', Connection: 'close' },
    }, (res) => {
      const out = { status: res.statusCode, headers: res.headers, body: Buffer.alloc(0), truncated: false };
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolveP(out); }
      const declared = Number(res.headers['content-length'] || 0);
      if (declared && declared > o.maxBytes && !res.headers['content-encoding']) {
        res.destroy(); out.tooLarge = true; return resolveP(out);
      }
      if (o.head && o.head(out)) { res.destroy(); return resolveP(out); }
      const dec = decoder(res);
      const stream = dec ? res.pipe(dec) : res;
      const chunks = []; let size = 0, done = false;
      const finish = () => { if (done) return; done = true; out.body = Buffer.concat(chunks).subarray(0, o.maxBytes);
        resolveP(out); };
      stream.on('data', (c) => {
        if (done) return;
        chunks.push(c); size += c.length;
        if (size >= o.maxBytes) { out.truncated = true; finish(); res.destroy(); if (dec) dec.destroy(); }
      });
      stream.on('end', finish);
      stream.on('error', (e) => {
        if (done) return;
        if (chunks.length && !(o.signal && o.signal.aborted)) { out.truncated = true; finish(); } else reject(e);
      });
      res.on('aborted', () => { if (!done) reject(fail('network', 'The connection was cut.')); });
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

/**
 * fetchPage(url, { timeoutMs = 10000, maxBytes = 2 MB, maxRedirects = 5, lookup, transport, signal, onHop, head })
 *   -> { url (final), status, headers, body: Buffer, truncated, redirects }
 * onHop(URL) runs before every request (robots.txt, block list); it may throw. transport replaces request()
 * in tests. Errors carry .code: bad_url | blocked_private | dns | timeout | too_many_redirects | network.
 */
async function fetchPage(raw, o = {}) {
  const timeoutMs = o.timeoutMs || 10000;
  const maxBytes = o.maxBytes || 2 * 1024 * 1024;
  const maxRedirects = o.maxRedirects == null ? 5 : o.maxRedirects;
  const transport = o.transport || request;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onOuter = () => ctl.abort();
  if (o.signal) { if (o.signal.aborted) ctl.abort(); else o.signal.addEventListener('abort', onOuter, { once: true }); }
  let current = String(raw);
  try {
    for (let hop = 0; ; hop++) {
      const pin = await resolve(current, { lookup: o.lookup });
      if (ctl.signal.aborted) throw fail('timeout', 'The site took too long to answer.');
      if (o.onHop) await o.onHop(pin.url, ctl.signal);
      let res;
      try {
        res = await transport(pin.url, pin, { signal: ctl.signal, maxBytes, accept: o.accept, head: o.head });
      } catch (e) {
        if (ctl.signal.aborted) throw fail('timeout', 'The site took too long to answer.');
        if (e && e.code && /^(bad_url|blocked_private|dns|network)$/.test(e.code)) throw e;
        throw fail('network', 'Could not connect to the site.', { cause: e && e.code });
      }
      const loc = res.headers && res.headers.location;
      if (res.status >= 300 && res.status < 400 && loc) {
        if (hop >= maxRedirects) throw fail('too_many_redirects', 'The site redirected too many times.');
        try { current = new URL(String(loc), pin.url).toString(); } catch { throw fail('network', 'Bad redirect.'); }
        continue;
      }
      return { ...res, url: pin.url.toString(), redirects: hop };
    }
  } finally {
    clearTimeout(timer);
    if (o.signal) o.signal.removeEventListener('abort', onOuter);
  }
}

module.exports = { fetchPage, resolve, parseUrl, request, isPrivateIp, UA };
