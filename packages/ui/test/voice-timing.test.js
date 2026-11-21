// 0.22.1: apps/chat/src/lib/voice-timing.js, one voice turn's timings against the budgets.
const test = require('node:test');
const assert = require('node:assert/strict');
const { BUDGET, createTiming } = require('../../../apps/chat/src/lib/voice-timing.js');

function at(times) { let i = 0; return () => times[i++]; }

test('a chat turn: mic ready, first token and first audio from the end of speech', () => {
  const t = createTiming(at([0, 250, 4000, 4700, 5600]));
  t.mark('listen'); t.mark('ready'); t.mark('speechEnd'); t.mark('firstToken'); t.mark('firstAudio');
  const s = t.summary(false);
  assert.deepEqual([s.micReady, s.firstToken, s.firstAudio], [250, 700, 1600]);
  assert.deepEqual(s.over, []);
  assert.match(s.line, /mic ready 250 ms .* first token 700 ms .* first audio 1600 ms/);
});

test('a slow local command is over its 500 ms budget; a mark is kept once', () => {
  const t = createTiming(at([0, 900, 1000, 1700, 1800, 9999]));
  t.mark('listen'); t.mark('ready'); t.mark('speechEnd'); t.mark('firstToken'); t.mark('firstAudio');
  t.mark('firstAudio');
  const s = t.summary(true);
  assert.deepEqual(s.over, ['micReady', 'localReply']);
  assert.equal(s.firstAudio, 800);
  assert.equal(BUDGET.firstAudio, 2000);
});
