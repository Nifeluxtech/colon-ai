// Outbound calls for server-side connections (v0.31.0: remote/ databases and git/ repositories). https only, never
// a private or local address (checked on every call, so a DNS change can't point a saved host inside the network),
// no redirects, a time limit and a size cap. Errors never carry the credentials or the provider's whole answer.
const dns = require('dns').promises;
const net = require('net');
const { privateIp } = require('../data');

const MAX_BYTES = 5 * 1048576;
const err = (status, code, message, extra) => Object.assign(new Error(message), { status, code, ...extra });

function createHttp({ fetchImpl = fetch, lookup = (h) => dns.lookup(h, { all: true }), timeoutMs = 20000 } = {}) {
  async function check(url) {
    let u;
    try { u = new URL(url); } catch { throw err(422, 'bad_url', 'That address isn’t valid.'); }
    if (u.protocol !== 'https:' || u.username || u.password) throw err(422, 'bad_url', 'Use an https address.');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) ? privateIp(host) : /(^|\.)(localhost|local|internal)$/i.test(host)) {
      throw err(422, 'bad_host', 'Colon only connects to public servers.');
    }
    if (!net.isIP(host)) {
      const addrs = await lookup(host).catch(() => []);
      if (!addrs.length) throw err(502, 'unreachable', `${host} couldn’t be found.`);
      if (addrs.some((a) => privateIp(a.address))) throw err(422, 'bad_host', 'Colon only connects to public servers.');
    }
    return u;
  }
  // -> { status, ok, headers, data (parsed JSON or text) }
  async function call(url, { method = 'GET', headers = {}, body, json, form, label = 'The service' } = {}) {
    const u = await check(url);
    const h = { accept: 'application/json', 'user-agent': 'ColonWorkspace/1', ...headers };
    let payload = body;
    if (json !== undefined) { payload = JSON.stringify(json); h['content-type'] = 'application/json'; }
    if (form) payload = form;
    let r;
    try {
      r = await fetchImpl(u, { method, headers: h, body: payload, redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw err(502, 'upstream', `${label} didn’t answer.`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw err(502, 'too_large', `${label}’s answer is too large.`);
    const text = buf.toString('utf8');
    let data = text;
    if (/json/i.test(r.headers.get('content-type') || '') || /^[[{]/.test(text.trim())) {
      try { data = JSON.parse(text); } catch { /* keep text */ }
    }
    return { status: r.status, ok: r.ok, headers: r.headers, data };
  }
  return { call, check };
}

// A provider's error answer -> one short line for the user (no credentials, at most 200 characters).
function reason(data) {
  const d = data && typeof data === 'object' ? data : { message: String(data || '') };
  const m = d.message || d.msg || d.error_description || (d.error && (d.error.message || d.error)) || d.hint || '';
  return String(typeof m === 'string' ? m : JSON.stringify(m)).replace(/\s+/g, ' ').slice(0, 200);
}
// throws a 4xx/5xx answer as an error the user can read
function must(r, label) {
  if (r.ok) return r.data;
  const why = reason(r.data);
  const status = r.status === 401 || r.status === 403 ? 403 : r.status === 404 ? 404 : r.status >= 500 ? 502 : 422;
  const code = status === 403 ? 'denied' : status === 404 ? 'not_found' : 'upstream';
  const hint = status === 403 ? ' Check the key or token and its permissions.' : '';
  throw err(status, code, `${label} said: ${why || `error ${r.status}`}.${hint}`, { upstream: r.status });
}

module.exports = { createHttp, reason, must };
