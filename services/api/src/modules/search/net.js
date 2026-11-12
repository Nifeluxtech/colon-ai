// Outbound HTTP for web search: an SSRF guard and a size-capped, time-limited fetch.
//
// Only http/https on the default ports, and every hop (including each redirect, at most 3) must resolve to
// public addresses only: loopback, private (RFC 1918), link-local (cloud metadata 169.254.169.254), CGNAT,
// multicast, reserved and the IPv6 equivalents are refused after DNS resolution. The check runs right before
// each request; the tiny window between our lookup and the socket's own lookup is accepted on shared hosting
// (no raw-socket pinning there) and documented in docs/phase-5-research.md.
const dns = require('dns');
const net = require('net');

const UA = 'Mozilla/5.0 (compatible; ColonAI/0.5; +https://chat.apparatus.name.ng)';

function ipv4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||          // CGNAT
    (a === 169 && b === 254) ||                    // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||       // benchmarking
    (a === 198 && b === 51 && p[2] === 100) || (a === 203 && b === 0 && p[2] === 113) ||
    a >= 224;                                      // multicast, reserved, broadcast
}

// True when the address must never be fetched.
function isPrivateIp(ip) {
  ip = String(ip || '').replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const v = net.isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v !== 6) return true;
  if (ip === '::' || ip === '::1') return true;
  const mapped = ip.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/) || ip.match(
    /^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  const m6 = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m6) { const n = (parseInt(m6[1], 16) << 16 >>> 0) + parseInt(m6[2], 16); return ipv4Private([n >>> 24,
    (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.')); }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 ||   // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 ||          // fe80::/10 link-local
    (first & 0xffc0) === 0xfec0 ||          // site-local (deprecated)
    (first & 0xff00) === 0xff00 ||          // multicast
    /^2001:0{0,3}db8:/.test(ip);            // documentation
}

const lookupAll = (host) => new Promise((resolve, reject) => dns.lookup(host, { all: true, verbatim: true }, (e,
  a) => (e ? reject(e) : resolve(a))));

/**
 * checkUrl(url, { lookup }) -> URL. Throws { code: 'blocked_url' } for anything that isn't a public http(s) URL.
 */
async function checkUrl(raw, { lookup = lookupAll } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { throw Object.assign(new Error('bad url'), { code: 'blocked_url' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw Object.assign(new Error('scheme not allowed'),
    { code: 'blocked_url' });
  if (u.username || u.password) throw Object.assign(new Error('credentials in url'), { code: 'blocked_url' });
  if (u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:'
    && u.port === '80'))) throw Object.assign(new Error('port not allowed'), { code: 'blocked_url' });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i.test(host)) throw Object.assign(new Error(
    'host not allowed'), { code: 'blocked_url' });
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else {
    try { addrs = await lookup(host); } catch { throw Object.assign(new Error('dns failed'), { code: 'dns' }); }
  }
  if (!addrs || !addrs.length || addrs.some(a => isPrivateIp(a.address))) throw Object.assign(new Error(
    'private address'), { code: 'blocked_url' });
  return u;
}

// Reads a response body up to `max` bytes; past that it stops (the page is cut, not refused).
async function readCapped(res, max, signal) {
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      chunks.push(Buffer.from(value));
      if (size >= max) { reader.cancel().catch(() => {}); break; }
    }
  } finally { try { reader.releaseLock(); } catch { /* already released */ } }
  return Buffer.concat(chunks).subarray(0, max);
}

function charsetOf(type) {
  const m = /charset=["']?([\w-]+)/i.exec(type || '');
  return m ? m[1].toLowerCase() : 'utf-8';
}

function decode(buf, type) {
  const head = buf.subarray(0, 2048).toString('latin1');
  const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  const cs = /charset=/i.test(type || '') ? charsetOf(type) : meta ? meta[1].toLowerCase() : 'utf-8';
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/**
 * safeFetch(url, { method, headers, body, timeoutMs, maxBytes, maxRedirects, signal, fetch, lookup, guard })
 *   -> { url, status, type, text }      guard=false skips the SSRF check (fixed, trusted API hosts only).
 * Errors carry .code: blocked_url | dns | timeout | too_many_redirects | network.
 */
async function safeFetch(url, o = {}) {
  const doFetch = o.fetch || globalThis.fetch;
  const timeoutMs = o.timeoutMs || 6000;
  const maxBytes = o.maxBytes || 1.5 * 1024 * 1024;
  const maxRedirects = o.maxRedirects == null ? 3 : o.maxRedirects;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onOuter = () => ctl.abort();
  if (o.signal) { if (o.signal.aborted) ctl.abort(); else o.signal.addEventListener('abort', onOuter, { once: true }); }
  let current = String(url), method = o.method || 'GET', body = o.body;
  try {
    for (let hop = 0; ; hop++) {
      if (o.guard !== false) await checkUrl(current, { lookup: o.lookup });
      let res;
      try {
        res = await doFetch(current, {
          method, body, redirect: 'manual', signal: ctl.signal,
          headers: { 'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
            'Accept-Language': 'en-NG,en;q=0.9', ...(o.headers || {}) },
        });
      } catch (e) {
        if (ctl.signal.aborted) throw Object.assign(new Error('timeout'), { code: o.signal && o.signal.aborted
          ? 'aborted' : 'timeout', name: o.signal && o.signal.aborted ? 'AbortError' : 'Error' });
        throw Object.assign(new Error(String(e.message || e)), { code: 'network' });
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (res.body) res.body.cancel().catch(() => {});
        if (hop >= maxRedirects) throw Object.assign(new Error('too many redirects'), { code: 'too_many_redirects' });
        current = new URL(res.headers.get('location'), current).toString();
        if (res.status !== 307 && res.status !== 308) { method = 'GET'; body = undefined; }
        continue;
      }
      const type = res.headers.get('content-type') || '';
      if (o.skip && o.skip(type, res)) {
        if (res.body) res.body.cancel().catch(() => {});
        return { url: current, status: res.status, type, text: '', skipped: true };
      }
      const buf = await readCapped(res, maxBytes, ctl.signal).catch((e) => {
        if (ctl.signal.aborted) throw Object.assign(new Error('timeout'), { code: 'timeout' });
        throw Object.assign(new Error(String(e.message || e)), { code: 'network' });
      });
      return { url: current, status: res.status, type, text: decode(buf, type), headers: res.headers };
    }
  } finally {
    clearTimeout(timer);
    if (o.signal) o.signal.removeEventListener('abort', onOuter);
  }
}

module.exports = { safeFetch, checkUrl, isPrivateIp, decode, UA };
