// End-to-end smoke test against a running API with MySQL/MariaDB and a mock provider.
// Not part of `npm test` (needs a database). The API env is config/e2e.env.example: every model slot is
// served by the mock (tests/helpers/mock-provider.js), Gemma through NVIDIA as "gemma-test", AI_HEDGE=1 so
// the first choice always answers. Usage (from services/api):
//   node tests/helpers/mock-provider.js 4010 &
//   set -a; . ../../config/e2e.env.example; set +a; PORT=3100 node app.js &
//   API=http://localhost:3100 ORIGIN=http://localhost:8080 node tests/e2e/smoke.js
// Routing since v0.5.2 (CHANGELOG): every mode and every African language goes Gemma 4 first.
const assert = require('node:assert/strict');
const API = process.env.API || 'http://localhost:3100';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
let cookie = '';

async function call(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const h = { 'X-Colon-Client': 'chat', Origin: ORIGIN, ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined && !(body instanceof FormData)) h['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers: h, body: body instanceof FormData ? body : body !== undefined
    ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function sse(path, body) {
  const res = await call(path, { method: 'POST', body, raw: true });
  if (!res.ok) return { status: res.status, error: await res.json() };
  const text = await res.text();
  const events = text.split('\n\n').filter(b => b.includes('event:')).map(b => {
    const ev = (b.match(/^event: (.+)$/m) || [])[1];
    const data = (b.match(/^data: (.+)$/m) || [])[1];
    return { ev, data: data ? JSON.parse(data) : {} };
  });
  return { status: res.status, type: res.headers.get('content-type'), events, text: events.filter(e =>
    e.ev === 'delta').map(e => e.data.text).join('') };
}

(async () => {
  const step = (s) => console.log('✓', s);

  // Guest chat: nothing saved, streams.
  let g = await sse('/chat/guest', { messages: [{ role: 'user',
    content: 'Wetin dey happen for Lagos today? Abeg tell me.' }], mode: 'general' });
  assert.equal(g.status, 200, JSON.stringify(g.error));
  assert.match(g.type, /text\/event-stream/);
  assert.deepEqual(g.events.map(e => e.ev).filter(e => e !== 'delta'), ['start', 'done']);
  assert.match(g.text, /Mock reply \(gemma-test\)/, 'Pidgin routes to Gemma 4 first');
  step('guest chat streams (Pidgin → Gemma 4 first)');
  g = await sse('/chat/guest', { messages: [{ role: 'user', content: 'Explain photosynthesis' }], mode: 'study' });
  assert.match(g.text, /gemma-test/);
  step('guest study mode → Gemma 4 first');
  const noAuth = await call('/conversations');
  assert.equal(noAuth.status, 401);
  step('history needs sign-in');
  const badOrigin = await call('/chat/guest', { method: 'POST', body: { messages: [{ role: 'user', content: 'x' }] },
    headers: { Origin: 'https://evil.example' } });
  assert.equal(badOrigin.status, 403);
  step('guest chat refuses other origins');

  // Account
  const email = `e2e${Date.now()}@example.com`;
  let r = await call('/auth/register', { method: 'POST', body: { email, password: 'pass1234word', name: 'Ada Test',
    language: 'en', accept_terms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  step('registered');

  r = await call('/conversations', { method: 'POST', body: { mode: 'developer', model: 'colon-saga' } });
  assert.equal(r.status, 201);
  const conv = r.data.conversation;
  let s = await sse(`/conversations/${conv.id}/messages`, { content: 'Fix my Node.js bug please', attachment_ids: [] });
  assert.equal(s.status, 200, JSON.stringify(s.error));
  assert.deepEqual(s.events.map(e => e.ev).filter(e => e !== 'delta'), ['user', 'start', 'done']);
  assert.match(s.text, /gemma-test/, 'developer → Gemma 4 first');
  const done = s.events.find(e => e.ev === 'done').data.message;
  assert.equal(done.status, 'complete');
  assert.equal(s.events[0].data.conversation.title, 'Fix my Node.js bug please');
  step('send streams user/start/delta/done and titles the chat');

  r = await call(`/conversations/${conv.id}`);
  assert.equal(r.data.messages.length, 2);
  assert.equal(r.data.messages[1].content, done.content);
  step('history survives (GET conversation)');

  s = await sse(`/conversations/${conv.id}/messages/${done.id}/regenerate`, {});
  const regen = s.events.find(e => e.ev === 'done').data.message;
  assert.equal(regen.version, 2);
  r = await call(`/conversations/${conv.id}`);
  assert.equal(r.data.messages.length, 2);
  step('regenerate replaces the reply (version 2)');

  const userId = r.data.messages[0].id;
  s = await sse(`/conversations/${conv.id}/messages/${userId}/edit`, { content: 'Explain closures in JavaScript' });
  assert.match(s.text, /Explain closures/);
  r = await call(`/conversations/${conv.id}`);
  assert.equal(r.data.messages[0].content, 'Explain closures in JavaScript');
  assert.equal(r.data.messages.length, 2);
  step('edit rewrites the question and re-answers');

  const last = r.data.messages[1];
  r = await call(`/messages/${last.id}/feedback`, { method: 'POST', body: { rating: 'down', reason: 'Too long',
    comment: 'shorter please' } });
  assert.equal(r.status, 200);
  r = await call(`/conversations/${conv.id}`);
  assert.equal(r.data.messages[1].feedback.reason, 'Too long');
  step('feedback saved');

  r = await call(`/conversations/${conv.id}`, { method: 'PATCH', body: { title: 'Closures', pinned: true,
    mode: 'study' } });
  assert.equal(r.data.conversation.title, 'Closures');
  assert.equal(r.data.conversation.pinned, true);
  r = await call('/conversations?q=closures');
  assert.equal(r.data.conversations.length, 1);
  r = await call(`/conversations/${conv.id}`);
  assert.equal(r.data.messages.at(-1).role, 'event');
  step('rename, pin, mode switch (event saved), search');

  r = await call(`/conversations/${conv.id}/share`, { method: 'POST' });
  const token = r.data.share.token;
  const saved = cookie; cookie = '';
  r = await call(`/shared/${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.conversation.title, 'Closures');
  cookie = saved;
  step('share link readable without sign-in');

  // Upload a text file and ask about it.
  const fd = new FormData();
  fd.append('file', new Blob(['Lagos population is about 15 million.\nAbuja is the capital.'], { type: 'text/plain' }),
    'notes.txt');
  r = await call('/uploads', { method: 'POST', body: fd });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const att = r.data.attachment;
  assert.equal(att.kind, 'text');
  s = await sse(`/conversations/${conv.id}/messages`, { content: 'Summarise my file', attachment_ids: [att.id] });
  const p = await call(`/uploads/${att.id}/file`, { raw: true });
  assert.equal(p.status, 200);
  assert.match(await p.text(), /Abuja/);
  step('upload text file, attach, download');

  const fake = new FormData();
  fake.append('file', new Blob([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3])], { type: 'application/pdf' }),
    'evil.pdf');
  r = await call('/uploads', { method: 'POST', body: fake });
  assert.equal(r.status, 422);
  step('fake PDF rejected by signature check');

  r = await call('/chat/settings', { method: 'PATCH', body: { textSize: 'lg', voice: { lang: 'yo-NG' } } });
  assert.equal(r.data.settings.textSize, 'lg');
  assert.equal(r.data.settings.voice.lang, 'yo-NG');
  r = await call('/chat/stats');
  assert.ok(r.data.conversations >= 1);
  r = await call('/conversations/export');
  assert.ok(r.data.conversations.length >= 1);
  step('settings, stats, export');

  // Stop: abort the request mid-stream; the partial reply is kept as "stopped".
  r = await call('/conversations', { method: 'POST', body: { mode: 'general', model: 'colon-saga-fast' } });
  const c2 = r.data.conversation;
  await call(`/account/profile`, { method: 'PATCH', body: { language: 'en' } });
  process.env.SLOW = '1';
  const ctl = new AbortController();
  const res = await fetch(`${API}/conversations/${c2.id}/messages`, { method: 'POST', signal: ctl.signal,
    headers: { 'X-Colon-Client': 'chat', Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'one two three four five six seven eight nine ten eleven twelve' }) });
  const reader = res.body.getReader();
  await reader.read(); await reader.read();
  ctl.abort();
  await new Promise(rr => setTimeout(rr, 600));
  r = await call(`/conversations/${c2.id}`);
  const st = r.data.messages[1].status;
  assert.ok(['stopped', 'complete'].includes(st), st);
  step(`stop keeps the partial reply (status: ${st})`);

  r = await call(`/conversations/${c2.id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  r = await call(`/conversations/${c2.id}`);
  assert.equal(r.status, 404);
  step('delete conversation');

  r = await call('/chat/usage');
  assert.ok(r.data.used >= 1);
  step(`usage tracked (${r.data.used}/${r.data.limit})`);

  // Guest daily limit (CHAT_GUEST_DAILY_LIMIT=5 in the smoke env): two guest replies used above.
  cookie = '';
  let quota = null;
  for (let i = 0; i < 6 && !quota; i++) {
    const q = await sse('/chat/guest', { messages: [{ role: 'user', content: `hello ${i}` }] });
    quota = q.events && q.events.find(e => e.ev === 'error' && e.data.code === 'quota');
  }
  assert.ok(quota, 'guest hits the daily limit');
  step('guest daily limit → error code "quota"');
  console.log('\nE2E smoke: all passed');
})().catch((e) => { console.error('✗', e); process.exit(1); });
