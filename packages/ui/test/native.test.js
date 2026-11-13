// Unit tests for packages/ui/js/colon/native.js (v0.7.1): Android app shell detection, the "Get the app" rule and
// the share helpers the chat uses for content shared from other apps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { native: N } = require('../js/colon/native.js');

const APP_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A145F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 '
  + 'Chrome/131.0 Mobile Safari/537.36 ColonAndroid/0.7.1';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

test('the app is recognised by its user-agent token', () => {
  assert.equal(N.shellVersion(APP_UA), '0.7.1');
  assert.equal(N.shellVersion(CHROME_ANDROID), null);
  assert.equal(N.shellVersion('ColonAndroid/beta'), null);
  assert.equal(N.shellVersion(''), null);
});

test('"Get the Android app" shows only to Android phones outside the app', () => {
  assert.equal(N.offerApp(CHROME_ANDROID, false), true);
  assert.equal(N.offerApp(APP_UA, false), false);
  assert.equal(N.offerApp(CHROME_ANDROID, true), false);
  assert.equal(N.offerApp(DESKTOP, false), false);
});

test('outside the app every call has a safe fallback', async () => {
  assert.equal(N.isShell(), false);
  assert.equal(N.hasBridge(), false);
  assert.equal(N.openTab('https://punchng.com'), false); // caller opens the web panel instead
  assert.equal(await N.saveBlob({}, 'x.json'), false);
  assert.equal(await N.ready(10), null);
  await assert.rejects(N.call('info'), { code: 'no_native' });
  assert.equal(typeof N.on('share', () => {}), 'function');
  assert.match(N.APK, /^https:\/\/github\.com\/Nifeluxtech\/colon-ai\/releases\/latest\/download\/colon-ai\.apk$/);
});

test('shared text: subject and text are combined without repeating', () => {
  assert.equal(N.shareText({ text: 'https://punchng.com/x', subject: 'Fuel price news' }),
    'Fuel price news\nhttps://punchng.com/x');
  assert.equal(N.shareText({ text: 'Fuel price news https://punchng.com/x', subject: 'Fuel price news' }),
    'Fuel price news https://punchng.com/x');
  assert.equal(N.shareText({ subject: 'Only a subject' }), 'Only a subject');
  assert.equal(N.shareText(null), '');
});

test('shared images become Files and data URLs lose their prefix', () => {
  const f = N.fileOf({ name: 'pic.png', type: 'image/png', base64: Buffer.from('hello').toString('base64') });
  assert.equal(f.name, 'pic.png');
  assert.equal(f.type, 'image/png');
  assert.equal(f.size, 5);
  assert.equal(N.fileOf({ name: 'x', base64: '%%%not base64' }), null);
  assert.equal(N.base64Of('data:application/json;base64,eyJ9'), 'eyJ9');
  assert.equal(N.base64Of('eyJ9'), 'eyJ9');
});

test('inside the app the bridge is used', async () => {
  const calls = [];
  global.window = { ColonNative: { version: '0.7.1', features: ['saveFile', 'openTab'],
    call: (c, a) => { calls.push([c, a]); return Promise.resolve({ ok: 1 }); },
    openTab: (u) => { calls.push(['openTab', u]); return Promise.resolve(); },
    on: () => () => {} } };
  try {
    assert.equal(N.isShell(), true);
    assert.equal(N.can('saveFile'), true);
    assert.equal(N.openTab('https://bbc.com/pidgin'), true);
    assert.deepEqual(await N.call('info'), { ok: 1 });
    assert.deepEqual(calls[0], ['openTab', 'https://bbc.com/pidgin']);
  } finally { delete global.window; }
});
