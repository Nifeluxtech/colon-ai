// End-to-end test of the Admin Dashboard API (Phase 4) against a running API, MySQL and the mock provider.
// Not part of `npm test` (needs a database). Same setup as e2e-smoke.js, plus DB_* so it can make staff
// accounts directly (roles can't be self-granted through the API, by design):
//   API=http://localhost:3100 ORIGIN=http://localhost:8080 DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=… DB_PASSWORD=… DB_NAME=… node test/e2e-admin.js
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const totp = require('../src/lib/totp');
const API = process.env.API || 'http://localhost:3100';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const run = Date.now();

function client() {
  let cookie = '';
  async function call(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const h = { 'X-Colon-Client': 'admin', Origin: ORIGIN, ...headers };
    if (cookie) h.Cookie = cookie;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  return { call, get cookie() { return cookie; }, set cookie(c) { cookie = c; } };
}

async function guestReply(c, content, mode = 'general') {
  const res = await c.call('/chat/guest', { method: 'POST', body: { messages: [{ role: 'user', content }], mode }, raw: true });
  const text = await res.text();
  if (!res.ok) return { status: res.status, error: JSON.parse(text) };
  const deltas = [...text.matchAll(/event: delta\ndata: (.+)/g)].map(m => JSON.parse(m[1]).text).join('');
  const err = /event: error\ndata: (.+)/.exec(text);
  return { status: res.status, text: deltas, error: err ? JSON.parse(err[1]) : null };
}

(async () => {
  const step = (s) => console.log('✓', s);
  const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

  // Accounts: a member, a moderator, an admin and a super admin (staff get 2FA through the real flow).
  async function account(role) {
    const c = client();
    const email = `${role}-${run}@example.com`, password = 'pass1234word';
    let r = await c.call('/auth/register', { method: 'POST', body: { email, password, name: `${role} tester`, language: 'en', accept_terms: true } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const me = (await c.call('/auth/me')).data.user;
    let secret = null;
    if (role !== 'user') {
      await db.query('UPDATE users SET role = ? WHERE id = ?', [role, me.id]);
      secret = (await c.call('/account/2fa/setup', { method: 'POST' })).data.secret;
      r = await c.call('/account/2fa/enable', { method: 'POST', body: { code: totp.code(secret, Math.floor(Date.now() / 30000)) } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
    }
    return { c, id: me.id, email, password, secret };
  }
  const member = await account('user');
  const mod = await account('moderator');
  const admin = await account('admin');
  const sup = await account('super_admin');
  step('member, moderator, admin and super admin accounts (staff with 2FA)');

  // A member gets 403 on every admin endpoint.
  const adminGets = ['/admin/overview', '/admin/stats', '/admin/users', '/admin/moderation', '/admin/providers', '/admin/models', '/admin/routing', '/admin/limits',
    '/admin/evaluation', '/admin/registry', '/admin/voice', '/admin/system', '/admin/security', '/admin/audit'];
  for (const p of adminGets) assert.equal((await member.c.call(p)).status, 403, `member ${p}`);
  assert.equal((await member.c.call('/admin/system', { method: 'PATCH', body: { brandName: 'X' } })).status, 403);
  step('member is denied every admin endpoint');

  // Moderator: moderation + read-only users, nothing else.
  for (const p of ['/admin/moderation', '/admin/users', `/admin/users/${member.id}`]) assert.equal((await mod.c.call(p)).status, 200, `moderator ${p}`);
  for (const p of ['/admin/overview', '/admin/providers', '/admin/routing', '/admin/limits', '/admin/system', '/admin/security', '/admin/audit', '/admin/registry', '/admin/voice']) {
    assert.equal((await mod.c.call(p)).status, 403, `moderator ${p}`);
  }
  for (const [p, m] of [[`/admin/users/${member.id}/suspend`, 'POST'], [`/admin/users/${member.id}/unlock`, 'POST'], [`/admin/users/${member.id}/role`, 'PATCH'], [`/admin/users/${member.id}/limit`, 'PATCH']]) {
    assert.equal((await mod.c.call(p, { method: m, body: { role: 'moderator', daily_limit: 5 } })).status, 403, `moderator ${m} ${p}`);
  }
  step('moderator: moderation + read-only users only');

  // Admin: everything except admin roles, provider keys and system settings.
  for (const p of ['/admin/overview', '/admin/providers', '/admin/models', '/admin/routing', '/admin/limits', '/admin/evaluation', '/admin/registry', '/admin/voice', '/admin/security', '/admin/audit']) {
    assert.equal((await admin.c.call(p)).status, 200, `admin ${p}`);
  }
  assert.equal((await admin.c.call('/admin/system')).status, 403);
  assert.equal((await admin.c.call('/admin/providers/groq/key', { method: 'POST', body: { api_key: 'sk-test-12345678' } })).status, 403);
  assert.equal((await admin.c.call(`/admin/users/${member.id}/role`, { method: 'PATCH', body: { role: 'admin' } })).status, 403);
  assert.equal((await admin.c.call(`/admin/users/${sup.id}/suspend`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await admin.c.call(`/admin/users/${member.id}/role`, { method: 'PATCH', body: { role: 'moderator' } })).status, 200);
  assert.equal((await admin.c.call(`/admin/users/${member.id}/role`, { method: 'PATCH', body: { role: 'user' } })).status, 200);
  step('admin: no admin roles, no provider keys, no system settings');

  // Provider keys: Super Admin only, encrypted, masked.
  let r = await sup.c.call('/admin/providers/groq/key', { method: 'POST', body: { api_key: 'sk-test-abcdefgh1234' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const [[row]] = await db.query("SELECT api_key_enc, key_last4 FROM ai_providers WHERE id = 'groq'");
  assert.ok(row.api_key_enc.startsWith('v1.') && !row.api_key_enc.includes('sk-test'));
  r = await sup.c.call('/admin/providers');
  const groq = r.data.providers.find(p => p.id === 'groq');
  assert.equal(groq.key.masked, '••••1234');
  assert.ok(!JSON.stringify(r.data).includes('sk-test'));
  r = await admin.c.call('/admin/providers');
  assert.equal(r.data.providers.find(p => p.id === 'groq').key.masked, '••••••••');
  step('provider key stored encrypted, shown masked (last 4 to Super Admin only)');
  // The mock accepts any key, so chat still works with the stored key.
  const guest = client();
  let g = await guestReply(guest, 'Explain photosynthesis', 'study');
  assert.match(g.text, /qwen-test/);
  step('chat answers with the stored (decrypted) key');

  // Models: first edit copies the built-in table to the DB; then add a model and route to it live.
  r = await admin.c.call('/admin/models');
  assert.equal(r.data.source, 'default');
  r = await admin.c.call('/admin/models', { method: 'POST', body: { target: 'kimi', provider_id: 'groq', model: 'kimi-test', vision: false } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const kimiId = r.data.id;
  r = await admin.c.call('/admin/models');
  assert.equal(r.data.source, 'database');
  assert.ok(r.data.models.some(m => m.target === 'qwen' && m.model === 'qwen-test'));
  r = await admin.c.call('/admin/routing', { method: 'PATCH', body: { routes: { study: ['kimi', 'qwen'] }, hedge: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  g = await guestReply(guest, 'Explain photosynthesis', 'study');
  assert.match(g.text, /kimi-test/);
  g = await guestReply(guest, 'Write hello world in JS', 'developer');
  assert.match(g.text, /deepseek-test/);
  step('routing change takes effect live (study → new model), other modes unchanged');
  r = await admin.c.call('/admin/routing', { method: 'PATCH', body: { routes: { study: ['nope'] } } });
  assert.equal(r.status, 422);
  // Disable the model: its route falls through to the next slot (fallback), chat never breaks.
  await admin.c.call(`/admin/models/${kimiId}`, { method: 'PATCH', body: { enabled: false } });
  g = await guestReply(guest, 'Explain photosynthesis', 'study');
  assert.match(g.text, /qwen-test/);
  step('disabled model → fallback to the next slot');
  // Disable every model: the DB config has nothing usable, so routing.js defaults take over.
  await db.query('UPDATE ai_models SET enabled = 0');
  await admin.c.call(`/admin/models/${kimiId}`, { method: 'PATCH', body: { enabled: false } });  // clears the cache
  g = await guestReply(guest, 'Explain photosynthesis', 'study');
  assert.match(g.text, /qwen-test/);
  r = await client().call('/health');
  assert.match(r.data.ai.routing, /^default/);
  await db.query('UPDATE ai_models SET enabled = 1 WHERE id <> ?', [kimiId]);
  await admin.c.call('/admin/routing', { method: 'DELETE' });
  step('a broken/empty DB config falls back to routing.js defaults');

  // Limits: guest limit live, per-mode cap, per-user override.
  r = await admin.c.call('/admin/limits', { method: 'PATCH', body: { guest: 1000, user: 1000, guestIp: 1000, modes: { research: 1 } } });
  assert.equal(r.status, 200);
  const g2 = client();
  g = await guestReply(g2, 'Research Lagos history', 'research');
  assert.ok(!g.error, JSON.stringify(g.error));
  g = await guestReply(g2, 'Research Lagos again', 'research');
  assert.equal(g.error && g.error.code, 'quota');
  assert.match(g.error.message, /Research mode/);
  g = await guestReply(g2, 'Hello', 'general');
  assert.ok(!g.error);
  await admin.c.call('/admin/limits', { method: 'PATCH', body: { modes: { research: null } } });
  r = await admin.c.call(`/admin/users/${member.id}/limit`, { method: 'PATCH', body: { daily_limit: 0 } });
  assert.equal(r.status, 200);
  r = await member.c.call('/chat/usage');
  assert.equal(r.data.limit, 0);
  await admin.c.call(`/admin/users/${member.id}/limit`, { method: 'PATCH', body: { daily_limit: null } });
  r = await member.c.call('/chat/usage');
  assert.equal(r.data.limit, 1000);
  step('limits: live guest/user limits, per-mode cap, per-user override');

  // Users: sessions, suspend (sessions revoked, login blocked), unsuspend.
  r = await admin.c.call(`/admin/users/${member.id}`);
  assert.ok(r.data.sessions.length >= 1);
  r = await admin.c.call(`/admin/users/${member.id}/suspend`, { method: 'POST', body: { reason: 'e2e test' } });
  assert.equal(r.status, 200);
  assert.equal((await member.c.call('/auth/me')).data.user, null);
  const relog = client();
  r = await relog.call('/auth/login', { method: 'POST', body: { email: member.email, password: member.password } });
  assert.equal(r.status, 403); assert.equal(r.data.error, 'suspended');
  r = await admin.c.call('/admin/users?filter=suspended');
  assert.ok(r.data.users.some(u => u.id === member.id && u.suspended));
  await admin.c.call(`/admin/users/${member.id}/unsuspend`, { method: 'POST' });
  r = await member.c.call('/auth/login', { method: 'POST', body: { email: member.email, password: member.password } });
  assert.equal(r.status, 200);
  r = await admin.c.call(`/admin/users/${member.id}`);
  const sid = r.data.sessions[0].id;
  r = await admin.c.call(`/admin/users/${member.id}/sessions/${sid}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await member.c.call('/auth/me')).data.user, null);
  await member.c.call('/auth/login', { method: 'POST', body: { email: member.email, password: member.password } });
  step('suspend revokes sessions and blocks login; unsuspend; revoke one session');

  // Moderation: a "bad" feedback and a shared-link report land in the queue; resolve and dismiss.
  r = await member.c.call('/conversations', { method: 'POST', body: { mode: 'general' } });
  const conv = r.data.conversation;
  const send = await member.c.call(`/conversations/${conv.id}/messages`, { method: 'POST', body: { content: 'Tell me a joke', attachment_ids: [] }, raw: true });
  const body = await send.text();
  const done = JSON.parse(/event: done\ndata: (.+)/.exec(body)[1]).message;
  r = await member.c.call(`/messages/${done.id}/feedback`, { method: 'POST', body: { rating: 'down', reason: 'Not accurate', comment: 'wrong' } });
  assert.equal(r.status, 200);
  r = await member.c.call(`/conversations/${conv.id}/share`, { method: 'POST' });
  const token = r.data.share.token;
  r = await client().call(`/shared/${token}/report`, { method: 'POST', body: { reason: 'Spam or scam', comment: 'e2e' } });
  assert.equal(r.status, 200);
  r = await mod.c.call('/admin/moderation');
  const fb = r.data.reports.find(x => x.kind === 'feedback' && x.conversation_id === conv.id);
  const sh = r.data.reports.find(x => x.kind === 'share' && x.conversation_id === conv.id);
  assert.ok(fb && sh);
  r = await mod.c.call(`/admin/moderation/${fb.id}`);
  assert.equal(r.data.messages.length, 2);
  r = await mod.c.call(`/admin/moderation/${sh.id}/resolve`, { method: 'POST', body: { note: 'removed', unshare: true } });
  assert.equal(r.data.unshared, true);
  assert.equal((await client().call(`/shared/${token}`)).status, 404);
  r = await mod.c.call(`/admin/moderation/${fb.id}/dismiss`, { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  r = await mod.c.call('/admin/moderation?status=all');
  assert.ok(r.data.reports.find(x => x.id === fb.id).status === 'dismissed');
  step('moderation queue: bad feedback + share report, resolve (unshare) and dismiss');

  // Overview from stored data.
  r = await admin.c.call('/admin/overview');
  assert.ok(r.data.requests.day > 0);
  assert.ok(r.data.providers.some(p => p.provider === 'groq' && p.success > 0));
  assert.ok(r.data.latency.avg_ms >= 0);
  step(`overview: ${r.data.requests.day} requests today, providers ${r.data.providers.map(p => `${p.provider} ${p.success}%`).join(', ')}`);

  // Evaluation, registry, voice.
  r = await admin.c.call('/admin/evaluation/runs', { method: 'POST', body: { name: 'Pidgin set v0', model: 'qwen-test', status: 'planned' } });
  assert.equal(r.status, 201);
  r = await admin.c.call('/admin/evaluation');
  assert.ok(r.data.runs.length && r.data.feedback.length);
  await admin.c.call(`/admin/evaluation/runs/${r.data.runs[0].id}`, { method: 'DELETE' });
  r = await admin.c.call('/admin/registry', { method: 'POST', body: { kind: 'model', name: 'N-ATLaS', languages: 'yo, ha, ig, pcm', licence: 'custom', source_url: 'https://huggingface.co/NCAIR1/N-ATLaS', commercial: 'unknown' } });
  assert.equal(r.status, 201);
  const regId = r.data.id;
  assert.equal((await admin.c.call(`/admin/registry/${regId}`, { method: 'PATCH', body: { status: 'approved' } })).status, 200);
  assert.equal((await admin.c.call('/admin/registry', { method: 'POST', body: { kind: 'x', name: '' } })).status, 422);
  assert.equal((await admin.c.call(`/admin/registry/${regId}`, { method: 'DELETE' })).status, 200);
  r = await admin.c.call('/admin/voice', { method: 'PATCH', body: { stt: { engine: 'whisper', enabled: true } } });
  assert.equal(r.data.voice.stt.engine, 'whisper');
  step('evaluation runs + feedback stats, African AI registry CRUD, voice settings');

  // System settings (Super Admin): maintenance, banner, branding, feature flags.
  r = await sup.c.call('/admin/system', { method: 'PATCH', body: { maintenance: { on: true, message: 'Back soon (e2e).' }, announcement: { on: true, text: 'Hello from e2e', tone: 'info' }, brandName: 'Colon AI' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await client().call('/auth/config');
  assert.equal(r.data.announcement.text, 'Hello from e2e');
  assert.equal(r.data.maintenance.on, true);
  g = await guestReply(client(), 'Hello');
  assert.equal(g.status, 503); assert.equal(g.error.error, 'maintenance'); assert.equal(g.error.message, 'Back soon (e2e).');
  r = await sup.c.call('/chat/guest', { method: 'POST', body: { messages: [{ role: 'user', content: 'staff test' }] }, raw: true });
  assert.equal(r.status, 200); await r.text();
  assert.equal((await member.c.call('/conversations')).status, 200);   // reading history still works
  await sup.c.call('/admin/system', { method: 'PATCH', body: { maintenance: { on: false }, announcement: { on: false }, features: { registration: false } } });
  r = await client().call('/auth/register', { method: 'POST', body: { email: `x${run}@example.com`, password: 'pass1234word', name: 'X', language: 'en', accept_terms: true } });
  assert.equal(r.status, 403); assert.equal(r.data.error, 'feature_off');
  await sup.c.call('/admin/system', { method: 'PATCH', body: { features: { registration: true } } });
  step('maintenance (503 for guests, staff exempt), announcement, feature flags');

  // Security: staff 2FA status and login events; every action audited.
  r = await admin.c.call('/admin/security');
  assert.ok(r.data.staff.some(s => s.id === mod.id && s.totp_enabled));
  r = await admin.c.call('/admin/audit?scope=admin');
  const actions = new Set(r.data.entries.map(e => e.action));
  for (const a of ['admin.system_updated', 'admin.voice_updated', 'admin.registry_deleted', 'admin.report_dismissed']) assert.ok(actions.has(a), a);
  r = await admin.c.call('/admin/audit?scope=logins');
  assert.ok(r.data.entries.some(e => e.action === 'auth.login_blocked_suspended'));
  step('security: staff 2FA, login events, admin actions audited');

  // Clean up the test accounts and the stored test key.
  await sup.c.call('/admin/providers/groq/key', { method: 'POST', body: { api_key: '' } });
  await db.query('DELETE FROM users WHERE email LIKE ?', [`%-${run}@example.com`]);
  await db.end();
  console.log('\nE2E admin: all passed');
})().catch((e) => { console.error('✗', e); process.exit(1); });
