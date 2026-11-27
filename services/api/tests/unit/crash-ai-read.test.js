// Unit tests for the AI read of the guess (0.39.3, modules/crash/ai-read.js) with a mocked AI client: the prompt
// carries only computed numbers and the rules, one call per new round, the template on error / off / bad text,
// and the verdict is the same with or without it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crash = require('../../src/modules/crash');
const { aiReader, facts, clean, SYSTEM, AI_LABEL } = require('../../src/modules/crash/ai-read');
const G = crash.guess;
const E = crash.engine;

const ada = { id: 1, name: 'Ada Obi', email: 'ada@example.com' };
const T0 = Date.UTC(2026, 10, 27, 9, 30, 0);
const READ = 'Recent rounds were mostly low, with a median near 1.9x. My guess for the next round is 1.40–2.30x, '
  + 'but each round is random.';

function mock(reply = READ) {
  const calls = [];
  const fn = async (o) => {
    calls.push(o);
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(o);
    return { text: reply, model: 'gemma-test' };
  };
  return { fn, calls };
}
function series(n, seed = 5) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  return Array.from({ length: n }, () => Math.max(1, Math.floor((0.97 / (1 - rnd())) * 100) / 100));
}
async function setup(xs, o = {}) {
  let now = T0;
  const store = crash.memoryStore();
  const add = (list, from) => store.insertRounds(1, 'jetx', list.map((m, i) => ({ round_id: `r${from + i}`,
    multiplier: m, observed_at: new Date(T0 - 1e7 + (from + i) * 10000), source: 'collector' })));
  await add(xs, 0);
  const e = crash.create({ store, clock: () => new Date(now), aiWaitMs: 2000, ...o });
  return { e, store, add, tick: (ms) => { now += ms; } };
}

test('system prompt and facts: random and provably fair, no certainty, no betting advice, numbers only', () => {
  assert.match(SYSTEM, /random and provably fair/);
  assert.match(SYSTEM, /Never claim certainty/);
  assert.match(SYSTEM, /Never tell the user to bet/);
  assert.match(SYSTEM, /consistent with the calibrated range/);
  const xs = series(60);
  const g = G.guess(xs);
  const f = facts(g, { action: 'WAIT' }, xs.slice(-10));
  assert.match(f, /Last 10 rounds, oldest to newest: /);
  assert.match(f, /mean .*median /);
  assert.match(f, new RegExp(`Calibrated guess range: ${g.range.low.toFixed(2)}x–${g.range.high.toFixed(2)}x`));
  assert.match(f, /Big-round range: /);
  assert.match(f, /After rounds in the newest round's bucket/);
  assert.match(f, /2x \d+% \(published odds 49%\); 5x \d+% \(published odds 19%\); 10x \d+% \(published odds 10%\)/);
  assert.match(f, /verdict for the next round: WAIT/);
  assert.doesNotMatch(f, /ada|@|Obi/i);
});

test('clean: rejects certainty and betting advice, strips markdown, trims long text', () => {
  assert.equal(clean('**Guess** 1.4–2.3x.'), 'Guess 1.4–2.3x.');
  assert.equal(clean('This round will reach 3x for sure.'), null);
  assert.equal(clean('It is guaranteed.'), null);
  assert.equal(clean('You should bet now.'), null);
  assert.equal(clean(''), null);
  assert.ok(clean('word '.repeat(150)).length <= 600);
});

test('live: the AI read once per new round, labelled, cached by the newest round id', async () => {
  const m = mock();
  const { e, add } = await setup(series(40), { aiGenerate: m.fn });
  const a = await e.live(ada);
  assert.deepEqual(a.guess.ai_reasoning, { text: READ, source: 'ai', label: AI_LABEL, model: 'gemma-test' });
  assert.equal(AI_LABEL, 'AI read · guess, not a prediction');
  assert.equal(m.calls.length, 1);
  const call = m.calls[0];
  assert.equal(call.context, SYSTEM);
  assert.equal(call.fun, false);
  assert.ok(call.signal);
  assert.match(call.messages[0].content, /Calibrated guess range/);
  await e.live(ada);
  await e.analysis(ada);
  assert.equal(m.calls.length, 1); // same newest round: cached
  await add([2.5], 40);
  const b = await e.live(ada);
  assert.equal(m.calls.length, 2);
  assert.equal(b.guess.ai_reasoning.source, 'ai');
  assert.ok(typeof b.guess.reasoning === 'string' && b.guess.reasoning.startsWith('Last round 2.50x'));
});

test('fallbacks: error, banned text, switched off, under 10 rounds, rate limit', async () => {
  const bad = mock(new Error('provider_down'));
  let r = await (await setup(series(40), { aiGenerate: bad.fn })).e.live(ada);
  assert.equal(r.guess.ai_reasoning.source, 'template');
  assert.equal(r.guess.ai_reasoning.text, r.guess.reasoning);
  const sure = mock('The next round will reach 5x.');
  r = await (await setup(series(40), { aiGenerate: sure.fn })).e.live(ada);
  assert.equal(r.guess.ai_reasoning.source, 'template');
  const off = mock();
  r = await (await setup(series(40), { aiGenerate: off.fn, aiOn: () => false })).e.live(ada);
  assert.equal(r.guess.ai_reasoning.source, 'template');
  assert.equal(off.calls.length, 0);
  const few = mock();
  r = await (await setup([1.5, 2, 3], { aiGenerate: few.fn })).e.live(ada);
  assert.equal(r.guess, null);
  assert.equal(few.calls.length, 0);
  const lim = mock();
  const reader = aiReader({ generate: lim.fn, perHour: 2, waitMs: 1000 });
  const g = G.guess(series(40));
  for (let i = 0; i < 4; i += 1) await reader.annotate(7, `k${i}`, g, { action: 'WAIT' }, []);
  assert.equal(lim.calls.length, 2);
});

test('slow model: the template now (pending), the AI read on the next poll; timeout gives the template', async () => {
  let release;
  const slow = mock(() => new Promise((res) => { release = () => res({ text: READ }); }));
  const reader = aiReader({ generate: slow.fn, waitMs: 20 });
  const g = G.guess(series(40));
  const first = await reader.annotate(1, 'r9', g, { action: 'WAIT' }, []);
  assert.equal(first.ai_reasoning.source, 'template');
  assert.equal(first.ai_reasoning.pending, true);
  release();
  await new Promise((res) => setTimeout(res, 5));
  const next = await reader.annotate(1, 'r9', g, { action: 'WAIT' }, []);
  assert.equal(next.ai_reasoning.source, 'ai');
  assert.equal(slow.calls.length, 1);
  const hang = mock((o) => new Promise((res, rej) => o.signal.addEventListener('abort', () => rej(new Error('t')))));
  const t = aiReader({ generate: hang.fn, timeoutMs: 30, waitMs: 200 });
  assert.equal((await t.annotate(1, 'x', g, { action: 'WAIT' }, [])).ai_reasoning.source, 'template');
});

test('the AI read never changes the verdict or an auto-bet decision', async () => {
  const xs = [...series(30, 2), ...Array.from({ length: 40 }, (_, i) => (i % 2 ? 1.5 : 1.35))];
  const bare = E.verdict(E.analyse(xs, 1.3), null);
  for (const reply of ['BET everything, it is a sure win.', READ, new Error('down')]) {
    const m = mock(reply);
    const { e } = await setup(xs, { aiGenerate: m.fn });
    const live = await e.live(ada);
    const an = await e.analysis(ada);
    const d = await e.decide(ada, { control: 'ai', dry_run: true });
    assert.equal(live.verdict.action, bare.action);
    assert.equal(live.verdict.reason, bare.reason);
    assert.deepEqual(an.verdict.numbers, bare.numbers);
    assert.equal(d.verdict.action, bare.action);
    assert.equal(d.allow, bare.action === 'BET');
    assert.equal(d.ai_reasoning, undefined);
  }
});
