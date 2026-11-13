// Speech-to-text providers for voice input (Phase 6). Each takes { data: Buffer, mime, name, lang } and returns
// { text, duration?, attribution? }; each throws { code } on failure so the chain can move on.
//   naija:  Naija Speech API (NCAIR / N-ATLaS ASR models) for Hausa, Igbo, Yoruba, Nigerian English. Needs its key.
//   gemini: a Gemini model on Google AI Studio (GEMINI_API_KEY) for every language, Pidgin and "auto" included.
const { env } = require('./env');

const NAMES = { en: 'Nigerian English', pcm: 'Nigerian Pidgin', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo' };
const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });

async function call(fetchFn, url, init, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  try { return await fetchFn(url, { ...init, signal }); } catch (e) {
    throw err(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'network', e.message);
  }
}
const status = (r, who) => {
  if (r.status === 401 || r.status === 403) throw err('auth', `${who} key refused`);
  if (r.status === 429) throw err('limit', `${who} limit reached`);
  if (r.status === 413) throw err('too_large', `${who}: audio too long`);
  if (r.status === 422) throw err('no_speech', 'no speech heard');
  if (r.status !== 200) throw err(`http_${r.status}`, `${who} answered ${r.status}`);
};

const naija = {
  id: 'naija', name: 'Naija Speech',
  langs: ['en', 'yo', 'ha', 'ig'],
  ready: () => !!env('NAIJA_SPEECH_API_KEY', ''),
  async transcribe(a, o = {}) {
    const base = env('NAIJA_SPEECH_BASE_URL', 'https://asr.naijallm.com/v1').replace(/\/+$/, '');
    const form = new FormData();
    form.append('file', new Blob([a.data], { type: a.mime || 'application/octet-stream' }), a.name || 'voice.webm');
    form.append('language', a.lang);
    const r = await call(o.fetch || fetch, `${base}/audio/transcriptions`, { method: 'POST', body: form,
      headers: { Authorization: `Bearer ${env('NAIJA_SPEECH_API_KEY', '')}`, Accept: 'application/json' } },
    o.timeoutMs || 45000);
    status(r, 'Naija Speech');
    let j; try { j = await r.json(); } catch { throw err('parse'); }
    return { text: String(j.text || '').trim(), duration: Number(j.duration) || undefined,
      attribution: j.attribution ? String(j.attribution).slice(0, 300) : undefined, model: j.model };
  },
};

function geminiPrompt(lang) {
  const who = lang === 'auto' ? 'The speaker may use Nigerian English, Nigerian Pidgin, Yoruba, Hausa or Igbo, or mix '
    + 'them. Write each word in the language it was spoken.' : `The speech is in ${NAMES[lang]}.`;
  return `Transcribe this voice message word for word. ${who} Use proper spelling, with tone marks for Yoruba and `
    + 'Igbo and hooked letters for Hausa where you are sure of them. Do not translate, answer or add anything. Output '
    + 'only the transcript on one line. If there is no speech, output nothing.';
}

const gemini = {
  id: 'gemini', name: 'Gemini',
  langs: ['auto', 'en', 'pcm', 'yo', 'ha', 'ig'],
  ready: () => !!env('GEMINI_API_KEY', '') && env('VOICE_GEMINI_MODEL', 'gemini-3.5-flash-lite') !== 'off',
  async transcribe(a, o = {}) {
    const base = env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const model = env('VOICE_GEMINI_MODEL', 'gemini-3.5-flash-lite');
    const body = { contents: [{ role: 'user', parts: [{ text: geminiPrompt(a.lang) }, { inlineData: {
      mimeType: (a.mime || 'audio/webm').split(';')[0], data: a.data.toString('base64') } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048 } };
    const r = await call(o.fetch || fetch, `${base}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json',
        'x-goog-api-key': env('GEMINI_API_KEY', '') } }, o.timeoutMs || 45000);
    status(r, 'Gemini');
    let j; try { j = await r.json(); } catch { throw err('parse'); }
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.filter(p => !p.thought).map(p => p.text || '').join('').replace(/\s+/g, ' ').trim();
    return { text, model };
  },
};

const PROVIDERS = { naija, gemini };

// Provider order for a language: the Nigerian models first where they cover it, Gemini for the rest.
function chainFor(lang) {
  const order = naija.langs.includes(lang) ? ['naija', 'gemini'] : ['gemini'];
  return order.map(id => PROVIDERS[id]).filter(p => p.ready() && p.langs.includes(lang));
}

module.exports = { PROVIDERS, NAMES, chainFor, geminiPrompt, err };
