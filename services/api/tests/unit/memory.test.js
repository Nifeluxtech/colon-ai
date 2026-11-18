// Unit tests for memory (v0.15.0, Blueprint B9): consent (off by default), CRUD, "remember that …", retrieval by
// keyword overlap + recency within the token budget, and what reaches a reply's context. In-memory store.
const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../../src/modules/memory');
const extra = require('../../src/modules/chat/extra-context');
const { select, estimateTokens, block } = memory.retrieve;

const CFG = { tokenBudget: 500, maxItems: 5 };
const ada = { id: 1, role: 'user' };
function engine(seed = {}, cfg = CFG) {
  const store = memory.memoryStore({ projects: [{ id: 'p1', user_id: 1 }], conversations: [{ id: 'c1', user_id: 1,
    project_id: 'p1' }, { id: 'c2', user_id: 1, project_id: null }], ...seed });
  return { e: memory.create({ store, cfg }), s: store._s };
}

test('consent is off until the user turns it on; nothing can be saved before', async () => {
  const { e } = engine();
  const st = await e.status(ada);
  assert.deepEqual([st.enabled, st.chosen, st.count], [false, false, 0]);
  assert.match(st.notice, /Nothing is saved without you asking/);
  await assert.rejects(e.add(ada, { content: 'I am vegetarian' }), (x) => x.code === 'memory_off' && x.status === 409);
  assert.equal((await e.setConsent(ada, true)).enabled, true);
  const m = await e.add(ada, { content: '  I am   vegetarian ' });
  assert.deepEqual([m.content, m.scope, m.source], ['I am vegetarian', 'user', 'settings']);
  await assert.rejects(e.setConsent(ada, 'yes'), (x) => x.code === 'invalid');
});

test('create, edit, delete, clear and the per-user cap', async () => {
  const { e } = engine();
  await e.setConsent(ada, true);
  const m = await e.add(ada, { content: 'My exam is in June' });
  assert.equal((await e.edit(ada, m.id, { content: 'My exam is in July' })).content, 'My exam is in July');
  await assert.rejects(e.edit(ada, m.id, { content: '   ' }), (x) => x.code === 'invalid');
  await assert.rejects(e.add(ada, { content: 'x'.repeat(1001) }), (x) => x.field === 'content');
  await e.remove(ada, m.id);
  await assert.rejects(e.remove(ada, m.id), (x) => x.status === 404);
  for (let i = 0; i < 5; i++) await e.add(ada, { content: `note ${i}` });
  await assert.rejects(e.add(ada, { content: 'one more' }), (x) => x.code === 'memory_full');
  assert.equal(await e.clear(ada), 5);
  assert.equal((await e.list(ada)).length, 0);
});

test('project and task scopes need the user\'s own project or chat', async () => {
  const { e } = engine();
  await e.setConsent(ada, true);
  const p = await e.add(ada, { content: 'Use APA style', project_id: 'p1' });
  assert.deepEqual([p.scope, p.project_id], ['project', 'p1']);
  const t = await e.add(ada, { content: 'Draft is v3', scope: 'task', conversation_id: 'c1' });
  assert.deepEqual([t.scope, t.conversation_id, t.project_id], ['task', 'c1', 'p1']);
  await assert.rejects(e.add(ada, { content: 'x', scope: 'project', project_id: 'nope' }), (x) => x.status === 404);
  await assert.rejects(e.add(ada, { content: 'x', scope: 'task' }), (x) => x.status === 404);
  await assert.rejects(e.add(ada, { content: 'x', scope: 'galaxy' }), (x) => x.field === 'scope');
  assert.deepEqual((await e.list(ada, { projectId: 'p1' })).map((m) => m.id).sort(), [p.id, t.id].sort());
});

test('"remember that …" is recognised; questions and "remember when" are not', () => {
  assert.equal(memory.rememberCommand('Remember that I am allergic to groundnuts'), 'I am allergic to groundnuts');
  assert.equal(memory.rememberCommand('please remember: my name is Ada'), 'my name is Ada');
  assert.equal(memory.rememberCommand('remember this - exam on 3 June'), 'exam on 3 June');
  assert.equal(memory.rememberCommand('Do you remember my name?'), null);
  assert.equal(memory.rememberCommand('remember when we spoke about Lagos'), null);
  assert.equal(memory.rememberCommand('remember?'), null);
  assert.equal(memory.rememberCommand('What is the capital of Kenya'), null);
});

test('chat: "remember that" saves only when memory is on', async () => {
  const { e, s } = engine();
  assert.equal(await e.fromChat({ user: ada, text: 'remember that I live in Ibadan' }), null);
  assert.equal(s.memories.length, 0);
  await e.setConsent(ada, true);
  const m = await e.fromChat({ user: ada, text: 'remember that I live in Ibadan', projectId: 'p1',
    conversationId: 'c1' });
  assert.deepEqual([m.content, m.source, m.scope, m.project_id], ['I live in Ibadan', 'chat', 'project', 'p1']);
  assert.equal(await e.fromChat({ user: ada, text: 'what is 2 + 2' }), null);
});

const at = (days) => new Date(Date.UTC(2026, 10, 18) - days * 86400000);
const NOW = Date.UTC(2026, 10, 18);

test('retrieval: relevant memories first, then the most recent, never past the token budget', () => {
  const rows = [
    { id: 1, scope: 'user', content: 'I live in Ibadan and work as a nurse', updated_at: at(90) },
    { id: 2, scope: 'user', content: 'My JAMB exam subjects are physics, chemistry and biology', updated_at: at(60) },
    { id: 3, scope: 'user', content: 'I prefer short answers', updated_at: at(1) },
    { id: 4, scope: 'user', content: 'x'.repeat(400), updated_at: at(0) },
  ];
  const picked = select(rows, { query: 'Help me revise chemistry for my exam', budget: 60, now: NOW });
  assert.equal(picked[0].id, 2);                          // keyword overlap wins over recency
  assert.ok(!picked.some((m) => m.id === 4));             // 100 tokens: never fits, never cut
  const used = picked.reduce((a, m) => a + estimateTokens(m.content) + 2, 0);
  assert.ok(used <= 60, `used ${used}`);
  assert.deepEqual(picked.map((m) => m.id), [2, 3, 1]);   // then newest first while they fit
  assert.deepEqual(select(rows, { query: 'chemistry', budget: 0 }), []);
  assert.deepEqual(select(rows, { query: 'chemistry', budget: 10, now: NOW }).map((m) => m.id), [3]);
  assert.match(block(picked), /^What the user asked Colon to remember[\s\S]*- My JAMB exam/);
  assert.equal(block([]), '');
});

test('retrieval: this chat\'s and this project\'s memories only, and the budget from config', async () => {
  const { e } = engine({}, { tokenBudget: 12, maxItems: 50 });
  await e.setConsent(ada, true);
  await e.add(ada, { content: 'Project one uses APA', project_id: 'p1' });
  await e.add(ada, { content: 'Chat two is about cooking', scope: 'task', conversation_id: 'c2' });
  const r = await e.contextFor({ user: ada, query: 'APA cooking', projectId: 'p1', conversationId: 'c1' });
  assert.match(r.block, /APA/);
  assert.doesNotMatch(r.block, /cooking/);
  await e.add(ada, { content: 'A long general note that will not fit in twelve tokens at all, sadly' });
  const r2 = await e.contextFor({ user: ada, query: 'general note', projectId: null, conversationId: 'c2' });
  assert.doesNotMatch(r2.block, /long general note/);
  assert.match(r2.block, /cooking/);
});

test('consent off = nothing injected, even with saved memories', async () => {
  const { e } = engine();
  await e.setConsent(ada, true);
  await e.add(ada, { content: 'I am vegetarian' });
  await e.setConsent(ada, false);
  assert.deepEqual(await e.contextFor({ user: ada, query: 'vegetarian dinner' }), { block: '', ids: [] });
  assert.equal((await e.list(ada)).length, 1);   // still visible and deletable
  const built = await extra.build({ user: ada, conv: { id: 'c2', project_id: null }, text: 'vegetarian dinner',
    deps: { memory: e, projects: { contextFor: async () => null } } });
  assert.equal(built.block, '');
  assert.deepEqual(await e.contextFor({ user: null, query: 'x' }), { block: '', ids: [] });
});

test('a reply\'s extra context: project instructions, fenced project files, then memories', async () => {
  const { e } = engine();
  await e.setConsent(ada, true);
  await e.add(ada, { content: 'I am vegetarian' });
  const proj = { contextFor: async (uid, pid) => (uid === 1 && pid === 'p1' ? { id: 'p1', name: 'Thesis',
    instructions: 'Write in British English.', files: [{ name: 'notes.txt', kind: 'text', text: 'Chapter one' }] }
    : null) };
  const r = await extra.build({ user: ada, conv: { id: 'c1', project_id: 'p1' }, text: 'vegetarian thesis food',
    deps: { memory: e, projects: proj } });
  assert.match(r.block, /project “Thesis”[\s\S]*British English[\s\S]*<<<FILE untrusted[\s\S]*Chapter one/);
  assert.match(r.block, /- I am vegetarian/);
  assert.equal(r.memoryIds.length, 1);
});
