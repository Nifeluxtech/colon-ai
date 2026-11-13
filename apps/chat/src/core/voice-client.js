/* Colon AI · voice client: sends a recording to the Colon API for speech to text (POST /voice/transcribe).
   Works signed in and as a guest. transcribe(blob, { lang, duration, name, signal }) -> Promise<transcript>
   where transcript = { text, lang, language, provider, ms, attribution? }. Errors carry .code (no_speech,
   voice_unavailable, voice_off, offline, too_long, ...). */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon;

// Speech languages for the picker: BCP-47 code, label, and the short code the API takes.
var SPEECH_LANGS = [['en-NG', 'English'], ['pcm-NG', 'Naijá (Pidgin)'], ['yo-NG', 'Yorùbá'], ['ha-NG', 'Hausa'],
  ['ig-NG', 'Igbo'], ['auto', 'Mixed / not sure']];
function langLabel(code) { var m = SPEECH_LANGS.filter(function (l) { return l[0] === code; })[0];
  return m ? m[1] : 'English'; }

function transcribe(blob, o) {
  o = o || {};
  var fd = new FormData();
  fd.append('lang', o.lang || 'en-NG');
  if (o.duration) fd.append('duration', String(o.duration));
  fd.append('file', blob, o.name || 'voice.webm');
  return fetch(C.API + '/voice/transcribe', { method: 'POST', body: fd, credentials: 'include', signal: o.signal,
    headers: { 'X-Colon-Client': 'chat' } }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (r.ok && d.transcript) return d.transcript;
      throw Object.assign(new Error(d.message || 'Couldn’t transcribe that.'), { code: d.error || 'voice_failed',
        status: r.status });
    });
  }, function (e) {
    if (e && e.name === 'AbortError') throw e;
    throw Object.assign(new Error('You’re offline. Check your data and try again.'), { code: 'offline' });
  });
}

var statusP = null;
function voiceStatus() {
  if (!statusP) statusP = fetch(C.API + '/voice/status', { credentials: 'include' }).then(function (r) {
    return r.ok ? r.json() : {}; }).then(function (d) { return d.voice || { enabled: false, ready: false }; },
  function () { statusP = null; return { enabled: false, ready: false }; });
  return statusP;
}

export { SPEECH_LANGS, langLabel, transcribe, voiceStatus };
