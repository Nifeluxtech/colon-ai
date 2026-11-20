/* Colon AI · voice mode orb (0.20.0): the pure state machine behind the full-screen voice overlay
   (voice-overlay.js). Hands-free (hands-free.js) reports its phase, the words heard, the reply being spoken and the
   microphone level; this turns them into what the overlay shows: the orb's state and size, the label and a short
   live caption, plus the small payload the Android app's "dynamic island" pill gets (ColonNative 'voice_ui').
   reduce(model, event) never touches the DOM, so it is unit-tested in packages/ui/test/voice-orb.test.js. */

var PHASES = ['idle', 'listening', 'thinking', 'speaking', 'muted'];
var LABELS = { idle: '', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking', muted: 'Mic muted' };
var CAPTION_MAX = 140; // characters of caption on screen (and sent to the app's pill)
var GAIN = 2.5;        // recorder levels sit around 0–0.4; this spreads them over 0–1

function initial() { return { state: 'idle', level: 0, heard: '', said: '', caption: '' }; }

function clean(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }

// A caption that fits: what was heard keeps its end (the newest words), what is said keeps its start.
function clip(text, max, fromEnd) {
  var s = clean(text), n = max || CAPTION_MAX;
  if (s.length <= n) return s;
  if (fromEnd) {
    var tail = s.slice(s.length - n + 1), sp = tail.indexOf(' ');
    return '…' + (sp > 0 && sp < 20 ? tail.slice(sp + 1) : tail);
  }
  var head = s.slice(0, n - 1), cut = head.lastIndexOf(' ');
  return (cut > n - 20 ? head.slice(0, cut) : head) + '…';
}

// Mic level smoothing: quick to rise (a syllable shows at once), slow to fall (no flicker between words).
function smooth(prev, v) {
  var x = Math.max(0, Math.min(1, (Number(v) || 0) * GAIN)), p = Number(prev) || 0;
  var k = x > p ? 0.6 : 0.15;
  return Math.round((p + (x - p) * k) * 1000) / 1000;
}

function copy(m, patch) { var o = {}, k; for (k in m) o[k] = m[k]; for (k in patch) o[k] = patch[k]; return o; }

// Events: {type:'phase', phase} · {type:'heard', text} · {type:'say', text} · {type:'level', v} · {type:'end'}
function reduce(m, e) {
  m = m || initial();
  if (!e || !e.type) return m;
  switch (e.type) {
    case 'phase': {
      var s = PHASES.indexOf(e.phase) >= 0 ? e.phase : m.state;
      if (s === m.state) return m;
      if (s === 'idle') return initial();
      if (s === 'listening') return copy(m, { state: s, level: 0, heard: '', caption: '' });
      if (s === 'thinking') return copy(m, { state: s, level: 0, caption: clip(m.heard, CAPTION_MAX, true) });
      if (s === 'speaking') return copy(m, { state: s, level: 0, caption: clip(m.said) });
      return copy(m, { state: s, level: 0 });
    }
    case 'heard':
      if (m.state !== 'listening') return m;
      return copy(m, { heard: clean(e.text), caption: clip(e.text, CAPTION_MAX, true) });
    case 'say':
      return copy(m, { said: clean(e.text), caption: m.state === 'speaking' ? clip(e.text) : m.caption });
    case 'level':
      return m.state === 'listening' ? copy(m, { level: smooth(m.level, e.v) }) : m;
    case 'end':
      return initial();
    default:
      return m;
  }
}

function label(state) { return LABELS[state] || ''; }

// How big the orb is drawn (CSS scale). Reduced motion keeps it still; listening follows the voice.
function orbScale(m, reduced) {
  if (!m || reduced) return 1;
  switch (m.state) {
    case 'listening': return Math.round((1 + Math.min(1, m.level) * 0.35) * 1000) / 1000;
    case 'speaking': return 1.08;
    case 'thinking': return 0.94;
    case 'muted': return 0.9;
    default: return 1;
  }
}

// What the Android app's pill and expanded overlay need: state and caption only (never the whole reply).
function nativePayload(m) {
  m = m || initial();
  return { state: m.state, caption: clip(m.caption, CAPTION_MAX, m.state === 'listening') };
}

// True when the pill would show something different (level changes alone are not sent to the app).
function nativeChanged(a, b) {
  var x = nativePayload(a), y = nativePayload(b);
  return x.state !== y.state || x.caption !== y.caption;
}

export var VoiceOrb = { PHASES: PHASES, CAPTION_MAX: CAPTION_MAX, initial: initial, reduce: reduce, label: label,
  clip: clip, smooth: smooth, orbScale: orbScale, nativePayload: nativePayload, nativeChanged: nativeChanged };
