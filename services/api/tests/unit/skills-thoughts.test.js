// v0.32.0: bundled skills (modules/skills) and the "Thought process" (reasoning passed to onThought).
const test = require('node:test');
const assert = require('node:assert/strict');
const skills = require('../../src/modules/skills');
const { thinkFilter } = require('../../src/modules/ai/sse');
const { geminiChunk, geminiBody } = require('../../src/modules/ai/providers/google');
const { tracker, skillStep } = require('../../src/modules/workspace/steps');

const ids = (t, mode) => skills.pick(t, { mode }).map((s) => s.id);

test('skills: picks by words, at most two, by mode; named skills win; nothing for small talk', () => {
  assert.deepEqual(ids('hi there', 'general'), []);
  assert.deepEqual(ids('Write out the 5 phase plan', 'workspace'), ['writing-plans']);
  assert.equal(ids('Start phase 2', 'workspace')[0], 'executing-plans');
  assert.deepEqual(ids('my login is broken, error 500', 'developer'), ['systematic-debugging']);
  assert.deepEqual(ids('write unit tests', 'general'), []);   // TDD is for code modes only
  assert.equal(ids('use the brainstorming skill for app names', 'general')[0], 'brainstorming');
  assert.ok(ids('make the landing page beautiful with a better colour palette and typography', 'workspace')
    .length <= 2);
});

test('skills: every bundled skill file is there, with a description, a source and a licence', () => {
  const all = skills.list();
  assert.ok(all.length >= 15);
  for (const s of all) {
    assert.ok(s.description, s.id);
    assert.match(s.source, /^https:\/\/github\.com\//);
    assert.match(s.license, /^(MIT|Apache-2\.0)$/);
  }
  const b = skills.block(skills.pick('plan the phases', { mode: 'workspace' }));
  assert.match(b, /--- Skill: Writing plans \(https:\/\/github\.com\/obra\/superpowers, MIT\) ---/);
  assert.ok(b.length < skills.CAP + 1000);
  assert.equal(skills.block([]), '');
});

test('thinkFilter hands <think> text to onThink, even split across chunks', () => {
  const seen = [];
  const f = thinkFilter((t) => seen.push(t));
  const out = f.push('Hi <thi') + f.push('nk>step one, ') + f.push('step two</th') + f.push('ink> there') + f.flush();
  assert.equal(out, 'Hi there');
  assert.equal(seen.join(''), 'step one, step two');
});

test('Gemini: thought parts come back as thought; includeThoughts only for Gemini models with onThought', () => {
  const parts = [{ text: 'Plan it.', thought: true }, { text: 'Hi' }];
  const g = geminiChunk({ candidates: [{ content: { parts } }] });
  assert.equal(g.thought, 'Plan it.');
  assert.equal(g.text, 'Hi');
  const p = { thinkingLevel: 'minimal' };
  const on = geminiBody({ messages: [], model: 'gemini-3.5-flash-lite', provider: p, onThought: () => {} });
  assert.deepEqual(on.generationConfig.thinkingConfig, { thinkingLevel: 'minimal', includeThoughts: true });
  const gemma = geminiBody({ messages: [], model: 'gemma-4-26b-a4b-it', provider: p, onThought: () => {} });
  assert.deepEqual(gemma.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  const off = geminiBody({ messages: [], model: 'gemini-3.5-flash-lite', provider: { ...p, showThoughts: false },
    onThought: () => {} });
  assert.equal(off.generationConfig.thinkingConfig.includeThoughts, undefined);
});

test('Workspace: a skill step, and the reasoning kept on the running step', async () => {
  const saved = [];
  const t = tracker(async (s) => saved.push(s));
  assert.match(skillStep(t, 'Write out the 5 phase plan'), /Skill: Writing plans/);
  assert.equal(skillStep(t, 'hello'), '');
  await t.start('Thinking and writing the code');
  t.think('First, '); t.think('the hero.');
  t.think(null);
  await t.done();
  const l = t.list();
  assert.equal(l[0].label, 'Using the Writing plans skill');
  assert.equal(l[1].thought, 'First, the hero.');
});
