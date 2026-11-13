// Unit tests for spoken replies (Phase 6, 0.6.1, modules/voice/speak.js): text cleanup, language and voice choice,
// limits, caching and errors. fetch is mocked: no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { speak, speakable, speechLang, VOICES, _cache, _recent } = require('../../src/modules/voice/speak');

function withKey(fn) {
  return async () => {
    const old = process.env.NAIJA_SPEECH_API_KEY; process.env.NAIJA_SPEECH_API_KEY = 'nlb_x';
    _cache.clear(); _recent.length = 0;
    try { await fn(); } finally { if (old === undefined) delete process.env.NAIJA_SPEECH_API_KEY;
      else process.env.NAIJA_SPEECH_API_KEY = old; }
  };
}
function mp3Fetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), init });
    return new Response(status === 200 ? new Uint8Array([0xff, 0xf3, 1, 2]) : '{}', { status }); };
  fn.calls = calls; return fn;
}

test('speakable strips code, links, markdown and emoji', () => {
  const t = speakable('## Hello\n- **Ẹ káàrọ̀** [site](https://x.y) 😀\n```js\nlet a\n```\nSee https://a.b `x`');
  assert.equal(t, 'Hello Ẹ káàrọ̀ site See x');
});

test('speechLang: explicit codes, Pidgin to English, auto detects the reply', () => {
  assert.equal(speechLang('ha-NG', 'x'), 'ha');
  assert.equal(speechLang('pcm', 'How you dey'), 'en');
  assert.equal(speechLang('auto', 'Sannu, ina kwana? Lafiya lau, nagode.'), 'ha');
  assert.equal(speechLang('auto', 'Good morning, how are you?'), 'en');
});

test('picks the Naija voice for the language and speaker', withKey(async () => {
  const f = mp3Fetch();
  const r = await speak({ text: 'Kedu? Biko nyere m aka. Daalu.', lang: 'auto', speaker: 'male' }, { fetch: f });
  assert.equal(r.lang, 'ig');
  assert.equal(r.voice, VOICES.ig.male);
  assert.equal(f.calls[0].body.language, 'ig');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer nlb_x');
  assert.ok(Buffer.isBuffer(r.audio) && r.audio.length === 4);
}));

test('replaying the same chunk comes from the cache', withKey(async () => {
  const f = mp3Fetch();
  await speak({ text: 'Hello there.', lang: 'en' }, { fetch: f });
  const r = await speak({ text: 'Hello there.', lang: 'en' }, { fetch: f });
  assert.equal(r.cached, true);
  assert.equal(f.calls.length, 1);
}));

test('limits and errors', withKey(async () => {
  await assert.rejects(speak({ text: 'a'.repeat(901) }, { fetch: mp3Fetch() }), e => e.status === 413);
  await assert.rejects(speak({ text: '```\ncode only\n```' }, { fetch: mp3Fetch() }), e => e.status === 422);
  await assert.rejects(speak({ text: 'Hi' }, { fetch: mp3Fetch(429) }), e => e.code === 'tts_limit');
  await assert.rejects(speak({ text: 'Hi again' }, { fetch: mp3Fetch(500) }), e => e.status === 502);
  delete process.env.NAIJA_SPEECH_API_KEY;
  await assert.rejects(speak({ text: 'Hi' }), e => e.status === 503);
}));

test('keeps under the shared per-minute budget', withKey(async () => {
  const f = mp3Fetch();
  for (let i = 0; i < 7; i++) await speak({ text: `Line ${i}.` }, { fetch: f });
  await assert.rejects(speak({ text: 'One more.' }, { fetch: f }), e => e.status === 429);
  assert.equal(f.calls.length, 7);
}));
