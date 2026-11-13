// Unit tests for the chat's hands-free loop (apps/chat/src/lib/hands-free.js, Phase 6, 0.6.5): listen, send on a
// final transcript, speak the reply, listen again; misses and End stop it.
const test = require('node:test');
const assert = require('node:assert/strict');

function el() {
  return { className: '', innerHTML: '', textContent: '', remove() { this.gone = true; },
    setAttribute() {}, addEventListener() {}, querySelector() { return this; } };
}
global.document = { createElement: el };
const { createHandsFree } = require('../../../apps/chat/src/lib/hands-free.js');

function rig() {
  const log = [], media = { on: false, voiceActive() { return this.on; }, startVoice() { this.on = true;
    log.push('listen'); }, stopVoice() { this.on = false; log.push('stop'); }, cancelVoice() { this.on = false;
    log.push('cancel'); } };
  const speak = { play(t, o) { log.push('speak:' + t); speak.end = o.onEnd; }, stop() { log.push('hush'); } };
  const hf = createHandsFree({ media, speak, send() { log.push('send'); }, toast() {},
    bar: { parentNode: { insertBefore() {} } }, getSettings: () => ({ voice: {} }) });
  return { hf, log, media, speak };
}

test('a spoken turn is sent, the reply is read aloud, then it listens again', async () => {
  const { hf, log, media, speak } = rig();
  hf.start(); assert.ok(hf.active());
  media.on = false; assert.equal(hf.transcript('hello there', true), true);
  hf.replyDone({ status: 'complete' }, 'Hi! How can I help?');
  speak.end(); await new Promise((r) => setTimeout(r, 350));
  assert.deepEqual(log, ['listen', 'send', 'speak:Hi! How can I help?', 'listen']);
  hf.stop(); assert.ok(!hf.active());
});

test('two silent turns end hands-free; cancel ends it at once', () => {
  let r = rig(); r.hf.start(); r.media.on = false;
  r.hf.transcript('', true); assert.ok(r.hf.active());
  r.media.on = false; r.hf.transcript('', true); assert.ok(!r.hf.active());
  r = rig(); r.hf.start(); r.hf.transcript('', 'cancel'); assert.ok(!r.hf.active());
});

test('interim text is left to the composer and nothing happens while idle', () => {
  const { hf } = rig();
  assert.equal(hf.transcript('hi', true), false);
  hf.start(); assert.equal(hf.transcript('hi', false), false); hf.stop();
});
