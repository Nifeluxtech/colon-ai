// Unit tests for voice mode (0.20.0): the orb's state machine (apps/chat/src/lib/voice-orb.js), hands-free's
// mute and overlay hooks (apps/chat/src/lib/hands-free.js), and that the overlay is styled and loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function el() {
  return { className: '', innerHTML: '', textContent: '', remove() { this.gone = true; },
    setAttribute() {}, addEventListener() {}, querySelector() { return this; } };
}
global.document = global.document || { createElement: el };
const { VoiceOrb } = require('../../../apps/chat/src/lib/voice-orb.js');
const { createHandsFree } = require('../../../apps/chat/src/lib/hands-free.js');
const R = VoiceOrb.reduce;
const go = (m, ...evs) => evs.reduce((a, e) => R(a, e), m || VoiceOrb.initial());
const phase = (p) => ({ type: 'phase', phase: p });

test('the orb follows a whole turn: listening → thinking → speaking → listening', () => {
  let m = go(null, phase('listening'), { type: 'heard', text: 'what is the  weather in Lagos' });
  assert.equal(m.state, 'listening');
  assert.equal(m.caption, 'what is the weather in Lagos');
  m = R(m, phase('thinking'));
  assert.equal(m.caption, 'what is the weather in Lagos', 'the question stays up while Colon thinks');
  m = R(m, { type: 'say', text: 'Sunny, 31°C.' });
  assert.equal(m.caption, 'what is the weather in Lagos', 'the reply shows once speech starts');
  m = R(m, phase('speaking'));
  assert.equal(m.caption, 'Sunny, 31°C.');
  m = R(m, phase('listening'));
  assert.deepEqual([m.state, m.caption, m.heard], ['listening', '', '']);
  assert.deepEqual(R(m, phase('idle')), VoiceOrb.initial());
  assert.deepEqual(R(m, { type: 'end' }), VoiceOrb.initial());
});

test('unknown phases and events change nothing; the same phase returns the same model', () => {
  const m = go(null, phase('listening'));
  assert.equal(R(m, phase('dancing')), m);
  assert.equal(R(m, phase('listening')), m);
  assert.equal(R(m, { type: 'nope' }), m);
  assert.equal(R(m, null), m);
  assert.equal(VoiceOrb.PHASES.length, 5);
});

test('words heard only count while listening; the mic level only moves the orb while listening', () => {
  const t = go(null, phase('thinking'));
  assert.equal(R(t, { type: 'heard', text: 'late words' }), t);
  assert.equal(R(t, { type: 'level', v: 0.4 }), t);
  let m = go(null, phase('listening'), { type: 'level', v: 0.4 });
  assert.ok(m.level > 0.5 && m.level <= 1, 'quick to rise');
  const peak = m.level;
  m = R(m, { type: 'level', v: 0 });
  assert.ok(m.level < peak && m.level > peak * 0.7, 'slow to fall');
  assert.equal(VoiceOrb.smooth(0, 9), 0.6);
  assert.equal(VoiceOrb.smooth(0, -1), 0);
  assert.equal(VoiceOrb.smooth(undefined, 'x'), 0);
});

test('orb scale per state, and none at all with reduced motion', () => {
  const l = go(null, phase('listening'));
  assert.equal(VoiceOrb.orbScale(l), 1);
  assert.equal(VoiceOrb.orbScale(Object.assign({}, l, { level: 1 })), 1.35);
  assert.equal(VoiceOrb.orbScale(Object.assign({}, l, { level: 1 }), true), 1);
  assert.equal(VoiceOrb.orbScale(go(null, phase('speaking'))), 1.08);
  assert.equal(VoiceOrb.orbScale(go(null, phase('thinking'))), 0.94);
  assert.equal(VoiceOrb.orbScale(go(null, phase('muted'))), 0.9);
  assert.equal(VoiceOrb.orbScale(null), 1);
  assert.deepEqual(['idle', 'listening', 'thinking', 'speaking', 'muted'].map(VoiceOrb.label),
    ['', 'Listening…', 'Thinking…', 'Speaking', 'Mic muted']);
});

test('long captions keep the newest words heard and the start of what is said', () => {
  const long = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ');
  const heard = VoiceOrb.clip(long, 40, true), said = VoiceOrb.clip(long, 40);
  assert.ok(heard.startsWith('…') && heard.endsWith('word59') && heard.length <= 40, heard);
  assert.ok(said.startsWith('word0') && said.endsWith('…') && said.length <= 40, said);
  assert.equal(VoiceOrb.clip(null), '');
});

test('the app pill gets state and a short caption, and only when they change', () => {
  const a = go(null, phase('listening'));
  const b = R(a, { type: 'level', v: 0.3 });
  assert.equal(VoiceOrb.nativeChanged(a, b), false, 'level alone is not sent');
  const c = R(b, { type: 'heard', text: 'hello' });
  assert.equal(VoiceOrb.nativeChanged(b, c), true);
  assert.deepEqual(VoiceOrb.nativePayload(c), { state: 'listening', caption: 'hello' });
  const big = R(go(null, phase('listening')), { type: 'heard', text: 'x'.repeat(500) });
  assert.ok(VoiceOrb.nativePayload(big).caption.length <= VoiceOrb.CAPTION_MAX);
  assert.deepEqual(VoiceOrb.nativePayload(), { state: 'idle', caption: '' });
});

function rig() {
  const log = [], phases = [], media = { on: false, voiceActive() { return this.on; }, startVoice() { this.on = true;
    log.push('listen'); }, stopVoice() { this.on = false; }, cancelVoice() { this.on = false; log.push('cancel');
    hf.transcript('', 'cancel'); } };
  const ui = { phase: (s) => phases.push(s), heard: (t) => log.push('heard:' + t), say: (t) => log.push('say:' + t),
    level: (v) => log.push('level:' + v) };
  const speak = { play(t, o) { speak.end = o.onEnd; }, stop() {} };
  const hf = createHandsFree({ media, speak, ui, send() { log.push('send'); }, toast() {},
    bar: { parentNode: { insertBefore() {} } }, getSettings: () => ({ voice: {} }) });
  return { hf, log, phases, media, speak };
}

test('hands-free reports every phase, the words and the level to the overlay', () => {
  const { hf, log, phases, media } = rig();
  hf.start(); hf.level(0.2); hf.transcript('hi', false);
  media.on = false; hf.transcript('hi there', true);
  hf.replyDone({ status: 'complete' }, 'Hello!');
  assert.deepEqual(phases, ['listening', 'thinking', 'speaking']);
  assert.deepEqual(log.filter((x) => x !== 'listen' && x !== 'send'),
    ['level:0.2', 'heard:hi', 'heard:hi there', 'say:Hello!']);
  hf.stop(); assert.equal(phases[phases.length - 1], 'idle');
});

test('mute pauses listening without ending voice mode; unmute listens again', async () => {
  const { hf, phases, log, speak } = rig();
  hf.start(); hf.mute(true);
  assert.ok(hf.active(), 'muting is not ending'); assert.ok(hf.muted());
  assert.equal(phases[phases.length - 1], 'muted'); assert.ok(log.includes('cancel'));
  hf.mute(false); assert.equal(phases[phases.length - 1], 'listening'); assert.ok(!hf.muted());
  // Muted while Colon speaks: the next turn waits muted instead of listening.
  hf.transcript('question', true); hf.replyDone({ status: 'complete' }, 'Answer.');
  hf.mute(true); assert.equal(phases[phases.length - 1], 'speaking');
  speak.end(); await new Promise((r) => setTimeout(r, 350));
  assert.equal(phases[phases.length - 1], 'muted');
  hf.stop(); assert.ok(!hf.active()); assert.ok(!hf.muted());
  hf.mute(true); assert.ok(!hf.muted(), 'nothing to mute while idle');
});

test('the chat page loads and styles the voice overlay', () => {
  const root = path.join(__dirname, '../../..');
  const html = fs.readFileSync(path.join(root, 'apps/chat/public/index.html'), 'utf8');
  assert.match(html, /assets\/css\/chat-voice\.css\?v=/);
  const css = fs.readFileSync(path.join(root, 'apps/chat/public/assets/css/chat-voice.css'), 'utf8');
  for (const cls of ['cv-vm', 'cv-vm-orb', 'cv-vm-caption', 'cv-vm-foot', 'cv-vm-btn']) {
    assert.ok(css.includes('.' + cls), cls);
  }
  for (const s of ['listening', 'thinking', 'speaking', 'muted']) assert.ok(css.includes('[data-state=' + s + ']'), s);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
