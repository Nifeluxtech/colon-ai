// Unit tests for send-only Gmail (0.40.0): the signed state, the MIME message, connecting and sending with a fake
// Google, and that a send needs a connection. No network, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../src/config');
config.auth.appSecret = config.auth.appSecret || 'x'.repeat(40);
config.auth.googleClientId = config.auth.googleClientId || 'cid.apps.googleusercontent.com';
config.gmail.clientSecret = 'shh';
const gmail = require('../../src/modules/gmail');

const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
const idToken = (email) => `h.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.s`;

test('gmail: state names the user, and a changed or expired one is refused', () => {
  const s = gmail.makeState(42);
  assert.equal(gmail.readState(s), '42');
  assert.equal(gmail.readState(s.replace(/^42/, '43')), null);
  assert.equal(gmail.readState(gmail.makeState(42, Date.now() - 20 * 60 * 1000)), null);
  assert.equal(gmail.readState('nope'), null);
});

test('gmail: the message is checked and built as UTF-8 text', () => {
  assert.throws(() => gmail.mime.check({ to: 'not-an-email', body: 'x' }), (e) => e.status === 422);
  assert.throws(() => gmail.mime.check({ to: 'a@b.ng', body: '  ' }), (e) => e.field === 'body');
  const m = gmail.mime.check({ to: 'ada@example.com, ada@example.com', subject: 'Ẹ káàbọ̀', body: 'Bawo ni? ₦500' });
  assert.deepEqual(m.to, ['ada@example.com']);
  const raw = Buffer.from(gmail.mime.build({ from: 'me@gmail.com', ...m }), 'base64url').toString('utf8');
  assert.match(raw, /^From: me@gmail\.com\r\nTo: ada@example\.com\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  const body = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Bawo ni? ₦500');
});

test('gmail: connect, send with a fresh access token, disconnect', async () => {
  const calls = [];
  const fetch = async (url, o) => {
    calls.push({ url, body: o.body });
    if (url.endsWith('/token') && /authorization_code/.test(o.body)) {
      return json(200, { refresh_token: 'r1', scope: 'openid email https://www.googleapis.com/auth/gmail.send',
        id_token: idToken('me@gmail.com') });
    }
    if (url.endsWith('/token')) return json(200, { access_token: 'a1' });
    if (url.includes('/messages/send')) return json(200, { id: 'm1' });
    return json(200, {});
  };
  const g = gmail.create({ store: gmail.memoryStore(), fetch });
  await assert.rejects(g.send(7, { to: 'x@y.com', body: 'hi' }), (e) => e.code === 'gmail_not_connected');
  assert.match(g.authUrl(7), /scope=openid\+email\+https%3A%2F%2Fwww\.googleapis\.com%2Fauth%2Fgmail\.send/);
  const done = await g.finish('code1', gmail.makeState(7));
  assert.deepEqual(done, { userId: '7', email: 'me@gmail.com' });
  assert.deepEqual(await g.status(7), { configured: true, connected: true, email: 'me@gmail.com' });
  const sent = await g.send(7, { to: 'ada@example.com', subject: 'Hi', body: 'Hello Ada' });
  assert.deepEqual(sent, { id: 'm1', from: 'me@gmail.com' });
  assert.match(calls.find((c) => c.url.includes('/messages/send')).body, /"raw":"/);
  await g.disconnect(7);
  assert.equal((await g.status(7)).connected, false);
  assert.ok(calls.some((c) => c.url.endsWith('/revoke')));
});

test('gmail: a consent without the send box ticked is refused', async () => {
  const fetch = async () => json(200, { refresh_token: 'r', scope: 'openid email', id_token: idToken('a@b.com') });
  const g = gmail.create({ store: gmail.memoryStore(), fetch });
  await assert.rejects(g.finish('c', gmail.makeState(1)), (e) => e.code === 'gmail_scope');
});
