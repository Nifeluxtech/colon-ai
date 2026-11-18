// Ownership tests for memory and projects (v0.15.0, Blueprint B9-B10 and E19): one user can never list, read,
// change, delete or use another user's memories or projects, nor attach a memory to another user's chat or project.
// Every attempt answers 404 (no hint that the id exists) and leaves the other user's data untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../../src/modules/memory');
const projects = require('../../src/modules/projects');
const billing = require('../../src/modules/billing');

const ada = { id: 1, role: 'user' };
const bayo = { id: 2, role: 'user' };
const is404 = (x) => x.status === 404 && x.code === 'not_found';

function setup() {
  const pstore = projects.memoryStore({ conversations: [{ id: 'c-ada', user_id: 1, project_id: null }], files: [] });
  const proj = projects.create({ store: pstore, bill: { mode: () => 'off', billable: billing.billable,
    planFor: async () => null } });
  const mstore = memory.memoryStore({ projects: pstore._s.projects, conversations: pstore._s.conversations });
  return { proj, mem: memory.create({ store: mstore, cfg: { tokenBudget: 500, maxItems: 50 } }), ms: mstore._s };
}

test('memories: another user cannot list, edit, delete or retrieve them', async () => {
  const { mem, ms } = setup();
  await mem.setConsent(ada, true);
  await mem.setConsent(bayo, true);
  const m = await mem.add(ada, { content: 'My bank is in Yaba' });
  assert.deepEqual(await mem.list(bayo), []);
  await assert.rejects(mem.edit(bayo, m.id, { content: 'hacked' }), is404);
  await assert.rejects(mem.remove(bayo, m.id), is404);
  assert.equal(await mem.clear(bayo), 0);
  assert.equal((await mem.contextFor({ user: bayo, query: 'bank Yaba' })).block, '');
  assert.deepEqual([ms.memories.length, ms.memories[0].content], [1, 'My bank is in Yaba']);
  assert.equal((await mem.status(bayo)).count, 0);
});

test('memories: cannot be attached to another user\'s project or chat', async () => {
  const { proj, mem, ms } = setup();
  const { project } = await proj.add(ada, { name: 'Ada only' });
  await mem.setConsent(bayo, true);
  await assert.rejects(mem.add(bayo, { content: 'x', scope: 'project', project_id: project.id }), is404);
  await assert.rejects(mem.add(bayo, { content: 'x', scope: 'task', conversation_id: 'c-ada' }), is404);
  assert.equal(ms.memories.length, 0);
});

test('memories: consent is per user', async () => {
  const { mem } = setup();
  await mem.setConsent(ada, true);
  assert.equal((await mem.status(bayo)).enabled, false);
  await assert.rejects(mem.add(bayo, { content: 'x' }), (x) => x.code === 'memory_off');
});

test('projects: another user cannot list, open, rename, delete or use them in chat', async () => {
  const { proj } = setup();
  const { project } = await proj.add(ada, { name: 'Ada only', instructions: 'secret plan' });
  assert.deepEqual((await proj.list(bayo)).projects, []);
  await assert.rejects(proj.get(bayo, project.id), is404);
  await assert.rejects(proj.edit(bayo, project.id, { name: 'mine now' }), is404);
  await assert.rejects(proj.remove(bayo, project.id), is404);
  await assert.rejects(proj.owned(2, project.id), is404);       // POST /conversations, PATCH, POST /uploads
  assert.equal(await proj.contextFor(2, project.id), null);     // a reply never gets another user's instructions
  assert.equal((await proj.get(ada, project.id)).project.name, 'Ada only');
});

test('unauthenticated calls are refused', async () => {
  const { proj, mem } = setup();
  await assert.rejects(mem.list(null), (x) => x.status === 401);
  await assert.rejects(proj.list({}), (x) => x.status === 401);
});

test('routes: every memory and project route requires a signed-in user', () => {
  for (const file of ['memory', 'projects']) {
    const r = require(`../../src/http/routes/${file}`);
    assert.ok(r.routes.length >= 5, file);
    for (const route of r.routes) {
      assert.ok(route.handlers.some((h) => h.name === 'requireUser'), `${route.method} ${route.re}`);
    }
  }
});
