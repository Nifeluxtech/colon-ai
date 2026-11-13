// Voice module (Phase 6): speech to text for the composer's mic button.
// transcribe() normalises the language, walks the provider chain and logs voice_ok / voice_failed.
const log = require('../../shared/logger');
const { env } = require('./env');
const { PROVIDERS, NAMES, chainFor, err } = require('./providers');

const LANGS = ['auto', 'en', 'pcm', 'yo', 'ha', 'ig'];
const AUDIO = /^(audio\/(webm|ogg|mp4|m4a|x-m4a|mpeg|mp3|wav|x-wav|wave|flac|aac)|video\/webm)$/;

// "yo-NG" -> "yo", "en-GB" -> "en", "pcm-NG" -> "pcm"; anything unknown -> "auto".
function normLang(raw) {
  const k = String(raw || '').toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(k) ? k : 'auto';
}

const enabled = () => env('VOICE', 'on') !== 'off';
const status = () => ({ enabled: enabled(), languages: LANGS, providers: Object.values(PROVIDERS).map(p => ({
  id: p.id, name: p.name, ready: p.ready(), langs: p.langs })) });

/**
 * transcribe({ data, mime, name, lang }, { fetch }) -> { text, lang, provider, ms, duration?, attribution? }
 * Throws { status, code } errors ready for the HTTP layer.
 */
async function transcribe(audio, o = {}) {
  if (!enabled()) throw err('voice_off', 'Voice transcription is switched off.', { status: 403 });
  const mime = String(audio.mime || '').toLowerCase().split(';')[0].trim();
  if (!AUDIO.test(mime)) throw err('bad_audio', 'Send a voice recording (WebM, Ogg, M4A, MP3 or WAV).',
    { status: 415 });
  if (!audio.data || audio.data.length < 800) throw err('no_speech', 'That recording is empty.', { status: 422 });
  const lang = normLang(audio.lang);
  const chain = chainFor(lang);
  if (!chain.length) throw err('voice_unavailable', 'Voice transcription isn’t set up yet. Your recording was not '
    + 'sent anywhere.', { status: 503 });
  const started = Date.now(), tried = [];
  for (const p of chain) {
    try {
      const r = await p.transcribe({ ...audio, mime, lang }, o);
      tried.push(p.id);
      if (!r.text) { if (p === chain[chain.length - 1]) throw err('no_speech', 'empty'); continue; }
      const ms = Date.now() - started;
      log.warn('voice_ok', { provider: p.id, lang, ms, bytes: audio.data.length, tried });
      return { text: r.text.slice(0, 16000), lang, language: NAMES[lang] || 'Auto', provider: p.id, ms,
        duration: r.duration, attribution: p.id === 'naija' ? r.attribution : undefined };
    } catch (e) {
      tried.push(`${p.id}:${e.code || 'error'}`);
      if (e.code === 'no_speech') break;
    }
  }
  log.warn('voice_failed', { lang, tried, ms: Date.now() - started });
  if (tried.some(t => /no_speech/.test(t)) || tried.every(t => !t.includes(':'))) throw err('no_speech',
    'I didn’t catch any speech. Try again a little closer to the mic.', { status: 422 });
  throw err('voice_failed', 'Couldn’t transcribe that right now.',
    { status: 502 });
}

module.exports = { transcribe, normLang, status, enabled, LANGS, handlers: require('./handlers') };
