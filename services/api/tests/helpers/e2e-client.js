// HTTP helpers for the end-to-end scripts: a cookie-keeping client for the API and a guest chat call
// that collects the streamed reply. API and ORIGIN come from the environment (see tests/e2e/*.js).
const API = process.env.API || 'http://localhost:3100';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';

function client() {
  let cookie = '';
  async function call(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const h = { 'X-Colon-Client': 'admin', Origin: ORIGIN, ...headers };
    if (cookie) h.Cookie = cookie;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(
      body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  return { call, get cookie() { return cookie; }, set cookie(c) { cookie = c; } };
}

async function guestReply(c, content, mode = 'general') {
  const res = await c.call('/chat/guest', { method: 'POST', body: { messages: [{ role: 'user', content }], mode },
    raw: true });
  const text = await res.text();
  if (!res.ok) return { status: res.status, error: JSON.parse(text) };
  const deltas = [...text.matchAll(/event: delta\ndata: (.+)/g)].map(m => JSON.parse(m[1]).text).join('');
  const err = /event: error\ndata: (.+)/.exec(text);
  return { status: res.status, text: deltas, error: err ? JSON.parse(err[1]) : null };
}

module.exports = { client, guestReply, API, ORIGIN };
