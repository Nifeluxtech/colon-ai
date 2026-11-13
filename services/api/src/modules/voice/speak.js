// Spoken replies (Phase 6, 0.6.1): text to speech with Naija Speech voices (Hausa, Igbo, Yoruba, Nigerian English).
// Generation is slower than real time (about 0.1 s per character, one request at a time), so the client uses these
// voices for Yorùbá, Hausa and Igbo (no phone has them) and the phone's voice for English unless the user picks Colon.
// The client splits a reply into short chunks and asks for them one by one, playing each as it lands.
// A small in-memory cache keeps the last chunks so replaying a reply costs nothing. Naijá (Pidgin) is read by the
// Nigerian English voice. With no key, or on failure, the client falls back to the phone's own voice.
const crypto = require('crypto');
const log = require('../../shared/logger');
const { env } = require('./env');
const { err } = require('./providers');

const MAX_CHARS = 900; // provider cap is 1,000 characters a request
const VOICES = {
  ha: { female: 'hausa_female1', male: 'hausa_male2' },
  ig: { female: 'igbo_female2', male: 'igbo_male2' },
  yo: { female: 'yoruba_female2', male: 'yoruba_male2' },
  en: { female: 'idera', male: 'osagie' },
};
// The Naija Speech key allows 10 requests a minute for the whole app (speech to text included), so read-aloud takes
// at most VOICE_TTS_PER_MINUTE of them; past that the client uses the phone's voice.
const recent = [];
function slot() {
  const now = Date.now(), cap = Number(env('VOICE_TTS_PER_MINUTE', 7)) || 7;
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= cap) return false;
  recent.push(now); return true;
}
const ready = () => !!env('NAIJA_SPEECH_API_KEY', '') && env('VOICE', 'on') !== 'off';

const cache = new Map(); // key -> Buffer, newest last
const CACHE_MAX = 40;
function remember(k, buf) {
  cache.delete(k); cache.set(k, buf);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// "yo-NG" / "yo" / "pcm" / "auto" + text -> one of ha, ig, yo, en.
function speechLang(lang, text) {
  let k = String(lang || 'auto').toLowerCase().split(/[-_]/)[0];
  if (k === 'auto') k = require('../ai').prompts.detectLanguage(text) || 'en';
  return VOICES[k] ? k : 'en';
}

// Strip what should not be read: code blocks, links, markdown marks, emoji.
function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, '').replace(/[*_~|]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ').trim();
}

/** speak({ text, lang, speaker }, { fetch }) -> { audio: Buffer, mime, voice, lang, cached } */
async function speak(input, o = {}) {
  if (!ready()) throw err('tts_unavailable', 'Colon voices aren’t set up. Using your phone’s voice.', { status: 503 });
  const text = speakable(input.text);
  if (!text) throw err('nothing_to_read', 'Nothing to read aloud.', { status: 422 });
  if (text.length > MAX_CHARS) throw err('too_long', `Send at most ${MAX_CHARS} characters at a time.`,
    { status: 413 });
  const lang = speechLang(input.lang, text);
  const voice = VOICES[lang][input.speaker === 'male' ? 'male' : 'female'];
  const key = crypto.createHash('sha256').update(`${voice}\n${text}`).digest('hex');
  if (cache.has(key)) { const b = cache.get(key); remember(key, b); return { audio: b, mime: 'audio/mpeg', voice,
    lang, cached: true }; }
  if (!slot()) throw err('tts_limit', 'Colon voices are busy. Using your phone’s voice.', { status: 429 });
  const base = env('NAIJA_SPEECH_BASE_URL', 'https://asr.naijallm.com/v1').replace(/\/+$/, '');
  const started = Date.now();
  let r;
  try {
    r = await (o.fetch || fetch)(`${base}/audio/speech`, { method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${env('NAIJA_SPEECH_API_KEY', '')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'naija-tts', input: text, voice, language: lang, response_format: 'mp3' }) });
  } catch (e) {
    log.warn('tts_failed', { lang, voice, code: 'network', ms: Date.now() - started });
    throw err('tts_failed', 'Couldn’t reach the voice service.', { status: 502 });
  }
  if (r.status !== 200) {
    log.warn('tts_failed', { lang, voice, code: `http_${r.status}`, ms: Date.now() - started });
    throw err(r.status === 429 ? 'tts_limit' : 'tts_failed', r.status === 429 ? 'Colon voices are busy. Using your '
      + 'phone’s voice.' : 'Couldn’t read that aloud right now.', { status: r.status === 429 ? 429 : 502 });
  }
  const audio = Buffer.from(await r.arrayBuffer());
  remember(key, audio);
  log.warn('tts_ok', { lang, voice, chars: text.length, bytes: audio.length, ms: Date.now() - started });
  return { audio, mime: 'audio/mpeg', voice, lang, cached: false };
}

module.exports = { speak, speakable, speechLang, ready, VOICES, MAX_CHARS, _cache: cache, _recent: recent };
