// Unit tests for memory that remembers (0.24.0): personal facts saved from a chat when memory is on (English and
// Pidgin patterns, never questions or secrets), a newer fact of the same kind replacing the older note, identity
// notes always in a reply's context, and the one-time offer to turn memory on. In-memory store.
const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../../src/modules/memory');
const extra = require('../../src/modules/chat/extra-context');
const { extract, kindOf, isIdentity } = memory.facts;

const CFG = { tokenBudget: 500, maxItems: 50 };
const ada = { id: 1, role: 'user' };
let tick = 0;
function engine(cfg = CFG) {
  const store = memory.memoryStore({ projects: [{ id: 'p1', user_id: 1 }], conversations: [{ id: 'c1', user_id: 1,
    project_id: null }, { id: 'c2', user_id: 1, project_id: null }],
  clock: () => new Date(Date.UTC(2026, 10, 21, 10, 0, tick++)) });
  return { e: memory.create({ store, cfg }), s: store._s };
}
const noProjects = { contextFor: async () => null };
const one = (text) => extract(text).map((f) => [f.kind, f.content]);

test('facts: name, nickname and what to call me, in English and Pidgin', () => {
  assert.deepEqual(one('My nickname is Elijah'), [['nickname', 'My nickname is Elijah']]);
  assert.deepEqual(one('Always call me Elijah.'), [['call_me', 'Call me Elijah']]);
  assert.deepEqual(one('you can call me Dami from now on'), [['call_me', 'Call me Dami']]);
  assert.deepEqual(one('I go by Tobi'), [['call_me', 'Call me Tobi']]);
  assert.deepEqual(one('Abeg call me Baba T'), [['call_me', 'Call me Baba T']]);
  assert.deepEqual(one('My name na Tunde'), [['name', 'My name is Tunde']]);
  assert.deepEqual(one('Hi, my name is ada and I live in Ibadan.'), [['name', 'My name is Ada'],
    ['home', 'I live in Ibadan']]);
  assert.deepEqual(one('My name is not important'), []);
});

test('facts: where I live, school, job, likes, dislikes, always and never', () => {
  assert.deepEqual(one('I dey stay for Lekki'), [['home', 'I live in Lekki']]);
  assert.deepEqual(one('I study at UNILAG'), [['school', 'I study at UNILAG']]);
  assert.deepEqual(one('I work as a nurse'), [['job', 'I work as a nurse']]);
  assert.deepEqual(one('I love jollof rice'), [['pref:jollof rice', 'I like jollof rice']]);
  assert.deepEqual(one('I no like pepper'), [['pref:pepper', 'I don\'t like pepper']]);
  assert.deepEqual(one('My favourite colour is blue'), [['fav:colour', 'My favourite colour is blue']]);
  assert.deepEqual(one('Always answer in Pidgin'), [[null, 'Always answer in Pidgin']]);
  assert.deepEqual(one('Never use emojis'), [[null, 'Never use emojis']]);
});

test('facts: never questions, requests, small talk or secrets', () => {
  for (const t of ['What is my nickname?', 'What\'s my name', 'Do you know where I live?',
    'Write a poem that says my name is Ada', 'I like how you explain things', 'I like to know how to bake bread',
    'I am tired', 'My password is hunter22', 'my pin is 1234', 'I live in 4111 1111 1111 1111',
    'Remember that my name is Ada', 'What is the capital of Kenya?', '']) {
    assert.deepEqual(extract(t), [], t);
  }
});

test('kindOf reads old notes by their wording; identity = name, nickname, call me', () => {
  assert.equal(kindOf('my name is Ada'), 'name');
  assert.equal(kindOf('I am vegetarian'), null);
  assert.equal(isIdentity({ content: 'Call me Elijah' }), true);
  assert.equal(isIdentity({ content: 'whatever', kind: 'nickname' }), true);
  assert.equal(isIdentity({ content: 'I live in Ibadan' }), false);
});

test('chat: facts are saved (source auto, every chat) only when memory is on', async () => {
  const { e, s } = engine();
  assert.deepEqual(await e.fromChatAll({ user: ada, text: 'My nickname is Elijah' }), []);
  assert.equal(s.memories.length, 0);
  await e.setConsent(ada, true);
  const [m] = await e.fromChatAll({ user: ada, text: 'My nickname is Elijah', conversationId: 'c1' });
  assert.deepEqual([m.content, m.source, m.kind, m.scope], ['My nickname is Elijah', 'auto', 'nickname', 'user']);
  assert.deepEqual(await e.fromChatAll({ user: ada, text: 'my nickname is Elijah.' }), []);   // already saved
  assert.deepEqual(await e.fromChatAll({ user: ada, text: 'What is my nickname?' }), []);
  assert.equal(s.memories.length, 1);
});

test('dedupe: a newer name, nickname or "call me" replaces the old note of the same kind', async () => {
  const { e, s } = engine();
  await e.setConsent(ada, true);
  await e.fromChatAll({ user: ada, text: 'Call me Elijah' });
  await e.fromChatAll({ user: ada, text: 'My nickname is Eli' });
  const [r] = await e.fromChatAll({ user: ada, text: 'Always call me Lijah' });
  assert.deepEqual([r.content, r.replaced], ['Call me Lijah', 'Call me Elijah']);
  await e.fromChatAll({ user: ada, text: 'I like pepper soup' });
  await e.fromChatAll({ user: ada, text: 'I don\'t like pepper soup' });
  assert.deepEqual(s.memories.map((m) => m.content).sort(), ['Call me Lijah', 'I don\'t like pepper soup',
    'My nickname is Eli']);
  // A note from before 0.24.0 (no kind) is matched by its wording, and "remember that" dedupes too.
  s.memories.push({ id: 99, user_id: 1, scope: 'user', content: 'my name is Ada', source: 'settings', kind: null,
    project_id: null, conversation_id: null, created_at: new Date(0), updated_at: new Date(0) });
  const [n] = await e.fromChatAll({ user: ada, text: 'remember that my name is Adaeze' });
  assert.deepEqual([n.id, n.content, n.kind, n.replaced], ['99', 'my name is Adaeze', 'name', 'my name is Ada']);
  assert.equal(s.memories.filter((m) => m.kind === 'name').length, 1);
});

test('"My nickname is Elijah", then a new chat "What\'s my nickname?" has the note in context', async () => {
  const { e } = engine({ tokenBudget: 20, maxItems: 50 });
  await e.setConsent(ada, true);
  await e.fromChatAll({ user: ada, text: 'My nickname is Elijah', conversationId: 'c1' });
  // Newer notes that share no words with the question and fill most of the small budget.
  await e.add(ada, { content: 'I am preparing for JAMB physics and chemistry this year' });
  await e.add(ada, { content: 'Short answers please, with examples' });
  const r = await extra.build({ user: ada, conv: { id: 'c2', project_id: null }, text: 'What\'s my nickname?',
    deps: { memory: e, projects: noProjects } });
  assert.match(r.block, /- My nickname is Elijah/);
  // Identity wins even when the question shares no word with it.
  const r2 = await e.contextFor({ user: ada, query: 'who am I', conversationId: 'c2' });
  assert.match(r2.block.split('\n')[1], /My nickname is Elijah/);
});

test('identity notes go first and are never pushed out by keyword matches', () => {
  const { select } = memory.retrieve;
  const rows = [
    { id: 1, scope: 'user', content: 'My exam subjects are physics and chemistry', updated_at: new Date() },
    { id: 2, scope: 'user', content: 'Call me Elijah', updated_at: new Date(0) },
  ];
  assert.deepEqual(select(rows, { query: 'physics exam', budget: 500 }).map((m) => m.id), [2, 1]);
  assert.deepEqual(select(rows, { query: 'physics exam', budget: 8 }).map((m) => m.id), [2]);
});

test('offer: once memory was never chosen and the message shares a fact; never after a choice', async () => {
  const { e } = engine();
  assert.deepEqual(await e.offerFor({ user: ada, text: 'My nickname is Elijah' }), ['My nickname is Elijah']);
  assert.deepEqual(await e.offerFor({ user: ada, text: 'remember that I am vegetarian' }), ['I am vegetarian']);
  assert.deepEqual(await e.offerFor({ user: ada, text: 'What is 2 + 2?' }), []);
  assert.deepEqual(await e.offerFor({ user: null, text: 'My nickname is Elijah' }), []);
  await e.setConsent(ada, false);   // "Not now" records off: no more offers
  assert.deepEqual(await e.offerFor({ user: ada, text: 'My nickname is Elijah' }), []);
});

test('memory full: an auto fact is skipped quietly, never an error in the chat', async () => {
  const { e } = engine({ tokenBudget: 500, maxItems: 1 });
  await e.setConsent(ada, true);
  await e.add(ada, { content: 'I am vegetarian' });
  assert.deepEqual(await e.fromChatAll({ user: ada, text: 'My nickname is Elijah' }), []);
});
