// Unit tests for voice transcription (Phase 6, modules/voice): language handling, provider order, fallback,
// empty audio and errors. fetch is mocked: no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const voice = require('../../src/modules/voice');
const { chainFor, geminiPrompt } = require('../../src/modules/voice/providers');

const KEYS = ['NAIJA_SPEECH_API_KEY', 'GEMINI_API_KEY', 'VOICE', 'VOICE_GEMINI_MODEL'];
function withEnv(vals, fn) {
  return async () => {
    const old = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    KEYS.forEach(k => delete process.env[k]);
    Object.assign(process.env, vals);
    try { await fn(); } finally { KEYS.forEach(k => { if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k]; }); }
  };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json' } });
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [re, reply] of routes) if (re.test(String(url))) return reply(String(url), init);
    return json({ error: 'nope' }, 404);
  };
  fn.calls = calls;
  return fn;
}
const audio = (lang, mime = 'audio/webm') => ({ data: Buffer.alloc(4000, 1), mime, name: 'v.webm', lang });
const GEM = (text) => () => json({ candidates: [{ content: { parts: [{ text }] } }] });

test('normLang maps browser codes and falls back to auto', () => {
  assert.equal(voice.normLang('yo-NG'), 'yo');
  assert.equal(voice.normLang('en-GB'), 'en');
  assert.equal(voice.normLang('pcm'), 'pcm');
  assert.equal(voice.normLang('fr-FR'), 'auto');
  assert.equal(voice.normLang(undefined), 'auto');
});

test('chain: Naija Speech first for its languages, Gemini only for Pidgin and auto', withEnv({
  NAIJA_SPEECH_API_KEY: 'nlb_x', GEMINI_API_KEY: 'g' }, () => {
  assert.deepEqual(chainFor('ha').map(p => p.id), ['naija', 'gemini']);
  assert.deepEqual(chainFor('pcm').map(p => p.id), ['gemini']);
  assert.deepEqual(chainFor('auto').map(p => p.id), ['gemini']);
}));

test('chain skips providers without keys', withEnv({ GEMINI_API_KEY: 'g', VOICE_GEMINI_MODEL: 'off' }, () => {
  assert.deepEqual(chainFor('yo').map(p => p.id), []);
}));

test('Hausa goes to Naija Speech with the language and keeps the attribution', withEnv({
  NAIJA_SPEECH_API_KEY: 'nlb_x', GEMINI_API_KEY: 'g' }, async () => {
  const f = mockFetch([[/asr\.naijallm\.com\/v1\/audio\/transcriptions$/, async (u, init) => {
    assert.equal(init.body.get('language'), 'ha');
    assert.equal(init.headers.Authorization, 'Bearer nlb_x');
    return json({ text: 'Ina kwana', duration: 1.9, attribution: 'Powered by NCAIR' });
  }]]);
  const r = await voice.transcribe(audio('ha-NG'), { fetch: f });
  assert.equal(r.text, 'Ina kwana');
  assert.equal(r.provider, 'naija');
  assert.equal(r.lang, 'ha');
  assert.match(r.attribution, /NCAIR/);
  assert.equal(f.calls.length, 1);
}));

test('falls back to Gemini when Naija Speech fails', withEnv({ NAIJA_SPEECH_API_KEY: 'nlb_x', GEMINI_API_KEY: 'g' },
  async () => {
    const f = mockFetch([[/naijallm/, () => json({ error: {} }, 503)], [/generateContent$/, GEM('Ẹ káàrọ̀')]]);
    const r = await voice.transcribe(audio('yo'), { fetch: f });
    assert.equal(r.provider, 'gemini');
    assert.equal(r.text, 'Ẹ káàrọ̀');
    assert.equal(r.attribution, undefined);
  }));

test('Pidgin goes straight to Gemini with a Pidgin prompt and the audio inline', withEnv({
  NAIJA_SPEECH_API_KEY: 'nlb_x', GEMINI_API_KEY: 'g' }, async () => {
  const f = mockFetch([[/gemini-3\.5-flash-lite:generateContent$/, (u, init) => {
    const b = JSON.parse(init.body);
    assert.match(b.contents[0].parts[0].text, /Nigerian Pidgin/);
    assert.equal(b.contents[0].parts[1].inlineData.mimeType, 'audio/webm');
    assert.equal(init.headers['x-goog-api-key'], 'g');
    return GEM('How you dey?')();
  }]]);
  const r = await voice.transcribe(audio('pcm', 'audio/webm;codecs=opus'), { fetch: f });
  assert.equal(r.text, 'How you dey?');
  assert.ok(f.calls.every(c => !/naijallm/.test(c.url)));
}));

test('silence is a 422 no_speech, not a server error', withEnv({ GEMINI_API_KEY: 'g' }, async () => {
  const f = mockFetch([[/generateContent$/, GEM('')]]);
  await assert.rejects(voice.transcribe(audio('auto'), { fetch: f }), e => e.status === 422 && e.code === 'no_speech');
}));

test('every provider down is a 502 voice_failed', withEnv({ NAIJA_SPEECH_API_KEY: 'k', GEMINI_API_KEY: 'g' },
  async () => {
    const f = mockFetch([[/./, () => json({}, 500)]]);
    await assert.rejects(voice.transcribe(audio('ig'), { fetch: f }), e => e.status === 502);
  }));

test('refuses non-audio, empty audio, no providers, and VOICE=off', withEnv({}, async () => {
  await assert.rejects(voice.transcribe({ ...audio('en'), mime: 'application/pdf' }), e => e.status === 415);
  await assert.rejects(voice.transcribe({ ...audio('en'), data: Buffer.alloc(10) }), e => e.status === 422);
  await assert.rejects(voice.transcribe(audio('en')), e => e.status === 503 && e.code === 'voice_unavailable');
  process.env.VOICE = 'off';
  await assert.rejects(voice.transcribe(audio('en')), e => e.status === 403);
}));

test('gemini prompt never asks to translate and covers code-switching on auto', () => {
  assert.match(geminiPrompt('auto'), /mix/);
  assert.match(geminiPrompt('ha'), /Hausa/);
  assert.match(geminiPrompt('yo'), /Do not translate/);
});
