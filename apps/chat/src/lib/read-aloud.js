/* Colon AI · read aloud (Phase 6, 0.6.1). Colon's Nigerian voices (POST /voice/speak: Hausa, Igbo, Yorùbá,
   Nigerian English; the server picks the voice from the text) play chunk by chunk: the first chunk is short so
   speech starts sooner, and the next is fetched while one plays. They are slower than real time, so engine "auto"
   uses them for Yorùbá, Hausa and Igbo (no phone has those voices) and the phone's voice for everything else.
   If Colon voices are off, busy or offline, it carries on with the phone's voice (speechSynthesis).
   ReadAloud.play(text, { engine: 'auto'|'colon'|'device', speaker, rate, lang, onStart, onEnd }) · stop() */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, run = 0, audio = null, urls = [];

// A Nigerian language other than English? Tone marks, subdots and hooked letters, or common words.
function nigerianLang(t) {
  var s = String(t || '').slice(0, 1500);
  if ((s.match(/[ẹọṣẸỌṢ]/g) || []).length >= 3) return 'yo';
  if ((s.match(/[ɓɗƙƴƁƊƘ]/g) || []).length >= 2) return 'ha';
  if ((s.match(/[ịụṅỊỤṄ]/g) || []).length >= 3) return 'ig';
  var w = function (re) { return (s.match(re) || []).length; };
  var ha = w(/\b(da|ba|na|ya|ta|ka|ne|ce|wannan|amma|saboda|kuma|zai|yana|tana)\b/gi);
  var ig = w(/\b(na|ka|ọ|o|nke|ndị|ndi|ihe|maka|bụ|bu|gị|gi|anyị)\b/gi);
  var words = (s.match(/\S+/g) || []).length || 1;
  if (ha / words > 0.18 && ha > ig) return 'ha';
  if (ig / words > 0.18) return 'ig';
  return null;
}

// Split into sentence-sized chunks: about 120 characters first, then up to 300 (server cap 900).
function chunks(text) {
  var parts = String(text || '').replace(/\s+/g, ' ').match(/[^.!?。…]+[.!?。…]*["”’)]*\s*/g) || [], out = [], cur = '';
  parts.forEach(function (p) {
    while (p.length > 300) { out.push(p.slice(0, 300)); p = p.slice(300); }
    var max = out.length ? 300 : 120;
    if (cur && (cur + p).length > max) { out.push(cur.trim()); cur = ''; }
    cur += p;
  });
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

function fetchChunk(t, o) {
  return fetch(C.API + '/voice/speak', { method: 'POST', credentials: 'include', headers: { 'Content-Type':
    'application/json', 'X-Colon-Client': 'chat' }, body: JSON.stringify({ text: t, lang: 'auto', speaker:
    o.speaker }) }).then(function (r) {
    if (!r.ok) throw Object.assign(new Error('tts ' + r.status), { status: r.status });
    return r.blob();
  });
}

function device(list, o, my) {
  if (!('speechSynthesis' in window) || !list.length) { if (my === run && o.onEnd) o.onEnd(); return; }
  speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(list.join(' ').slice(0, 6000));
  u.lang = o.lang || 'en-NG'; u.rate = o.rate || 1;
  u.onend = u.onerror = function () { if (my === run && o.onEnd) o.onEnd(); };
  speechSynthesis.speak(u);
}

function stop() {
  run++;
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  urls.forEach(function (u) { URL.revokeObjectURL(u); }); urls = [];
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function play(text, o) {
  o = o || {}; stop();
  var my = run, list = chunks(text);
  if (!list.length) { if (o.onEnd) o.onEnd(); return; }
  var engine = o.engine || 'auto';
  if (engine === 'auto') engine = nigerianLang(text) ? 'colon' : 'device';
  if (engine === 'device') return device(list, o, my);
  if (o.onStart) o.onStart();
  var next = fetchChunk(list[0], o);
  (function step(i, pending) {
    pending.then(function (blob) {
      if (my !== run) return;
      var after = i + 1 < list.length ? fetchChunk(list[i + 1], o) : null;
      if (after) after.catch(function () {}); // handled when its turn comes
      var url = URL.createObjectURL(blob); urls.push(url);
      audio = new Audio(url); audio.playbackRate = o.rate || 1;
      audio.onended = function () {
        URL.revokeObjectURL(url);
        if (my !== run) return;
        if (after) step(i + 1, after); else if (o.onEnd) o.onEnd();
      };
      audio.onerror = function () { if (my === run) device(list.slice(i), o, my); };
      audio.play().catch(function () { if (my === run) device(list.slice(i), o, my); });
    }, function () { if (my === run) device(list.slice(i), o, my); });
  })(0, next);
}

var canPlay = typeof Audio !== 'undefined' || 'speechSynthesis' in window;
export var ReadAloud = { play: play, stop: stop, chunks: chunks, nigerianLang: nigerianLang, canPlay: canPlay };
