// 0.22.1: apps/chat/src/lib/voice-errors.js, why voice input stopped. Voice mode says it and ends instead of sitting
// on "Listening…" with a dead microphone (the overlay-over-WhatsApp bug).
const test = require('node:test');
const assert = require('node:assert/strict');
const { errorKind, spokenError, voiceErrorText } = require('../../../apps/chat/src/lib/voice-errors.js');

test('recognizer error names map to kinds; aborted is not an error', () => {
  const rows = [['not-allowed', 'denied'], ['service-not-allowed', 'denied'], ['audio-capture', 'nomic'],
    ['network', 'network'], ['busy', 'busy'], ['language', 'language'], ['client', 'other'], ['whatever', 'other'],
    ['aborted', null]];
  for (const [name, kind] of rows) assert.equal(errorKind(name), kind, name);
});

test('every kind has words to show and to say', () => {
  for (const k of ['denied', 'nomic', 'unsupported', 'network', 'insecure', 'busy', 'language', 'other']) {
    assert.equal(voiceErrorText(k).length, 2, k);
    assert.ok(spokenError(k, true).length > 10, k);
  }
  assert.match(spokenError('denied', true), /Microphone permission needed.*Open Colon/);
  assert.doesNotMatch(spokenError('denied', false), /Open Colon/);
});
