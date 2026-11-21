// Outbound HTTP for repositories (v0.24.0): provider APIs and archive downloads, SSRF-guarded on every hop.
// Each hop goes through the search module's checkUrl (http/https and standard ports only, no credentials in the URL,
// every resolved address public: no loopback, private, link-local, CGNAT or metadata addresses). Redirects are
// followed by hand (at most 5) and checked again; the auth headers (the user's token) are only sent to the host the
// request started on, never to a redirect target on another host (GitHub sends archives from codeload.github.com
// with their own short-lived link). Bodies are read up to maxBytes; a larger answer is refused (too_large).
const search = require('../search');

const UA = 'ColonRepos/1.0 (+https://chat.apparatus.name.ng)';
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

async function readAll(res, max) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > max) { if (res.body) res.body.cancel().catch(() => {}); throw tooLarge(max); }
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { reader.cancel().catch(() => {}); throw tooLarge(max); }
      chunks.push(Buffer.from(value));
    }
  } finally { try { reader.releaseLock(); } catch { /* already released */ } }
  return Buffer.concat(chunks);
}
const tooLarge = (max) => fail(413, 'too_large', `This repository is larger than Colon can import (${Math.round(max
  / 1048576)} MB as a download). Add a .colonignore, or pick a smaller repository or branch.`);

/**
 * get(url, { headers, auth, maxBytes, timeoutMs, fetch, lookup, signal }) -> { status, buf, type, url }
 *   auth: headers sent only while the request stays on the first host (a token).
 * Errors: blocked_url (422, private or malformed address), too_large (413), repo_unreachable (502, network,
 * timeout, too many redirects).
 */
async function get(url, o = {}) {
  const doFetch = o.fetch || globalThis.fetch;
  const max = o.maxBytes || 50 * 1048576;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs || 60000);
  const onOuter = () => ctl.abort();
  if (o.signal) o.signal.addEventListener('abort', onOuter, { once: true });
  const firstHost = new URL(url).host;
  let current = String(url);
  try {
    for (let hop = 0; ; hop++) {
      if (!/^https:/i.test(current)) throw fail(422, 'blocked_url', 'Only https addresses are allowed.');
      try { await search.net.checkUrl(current, { lookup: o.lookup }); } catch (e) {
        if (e.code === 'dns') throw fail(502, 'repo_unreachable', 'That host could not be found.');
        throw fail(422, 'blocked_url', 'That address isn’t a public https site.');
      }
      const sameHost = new URL(current).host === firstHost;
      let res;
      try {
        res = await doFetch(current, { method: 'GET', redirect: 'manual', signal: ctl.signal,
          headers: { 'User-Agent': UA, ...(o.headers || {}), ...(sameHost ? o.auth || {} : {}) } });
      } catch {
        throw fail(502, 'repo_unreachable', ctl.signal.aborted ? 'The code host took too long to answer.'
          : 'Couldn’t reach the code host.');
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        if (res.body) res.body.cancel().catch(() => {});
        if (hop >= 5) throw fail(502, 'repo_unreachable', 'The code host redirected too many times.');
        current = new URL(loc, current).toString();
        continue;
      }
      const buf = await readAll(res, max).catch((e) => {
        if (e.code === 'too_large') throw e;
        throw fail(502, 'repo_unreachable', ctl.signal.aborted ? 'The download took too long.'
          : 'The download was cut off.');
      });
      return { status: res.status, buf, type: res.headers.get('content-type') || '', url: current };
    }
  } finally {
    clearTimeout(timer);
    if (o.signal) o.signal.removeEventListener('abort', onOuter);
  }
}

module.exports = { get, UA };
