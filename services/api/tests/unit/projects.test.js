// Unit tests for projects (v0.15.0, Blueprint B10): CRUD, the plan limit (entitlement 'projects') in enforce,
// shadow and off modes, staff, delete keeps chats and files. In-memory store, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../../src/modules/projects');
const billing = require('../../src/modules/billing');

const ada = { id: 1, role: 'user' };
const staff = { id: 9, role: 'admin' };
const PLANS = { free: { code: 'free', name: 'Free', entitlements: { projects: { enabled: true, limit: 2 } } },
  max: { code: 'max', name: 'Max', entitlements: { projects: { enabled: true, limit: null } } },
  none: { code: 'none', name: 'Lite', entitlements: {} } };

function engine(mode = 'enforce', plan = 'free', seed = {}) {
  const store = projects.memoryStore(seed);
  const bill = { mode: () => mode, billable: billing.billable, planFor: async () => PLANS[plan] };
  return { e: projects.create({ store, bill }), s: store._s };
}

test('create, list, rename, instructions, get and delete', async () => {
  const { e } = engine('enforce', 'max');
  const { project, over_limit } = await e.add(ada, { name: '  Final   year thesis ', instructions: 'Use APA.' });
  assert.deepEqual([project.name, project.instructions, over_limit], ['Final year thesis', 'Use APA.', false]);
  assert.equal((await e.edit(ada, project.id, { name: 'Thesis' })).name, 'Thesis');
  assert.equal((await e.edit(ada, project.id, { instructions: '' })).instructions, '');
  const l = await e.list(ada);
  assert.deepEqual([l.projects.length, l.limit.limit, l.limit.used], [1, null, 1]);
  await assert.rejects(e.add(ada, { name: '' }), (x) => x.field === 'name');
  await assert.rejects(e.add(ada, { name: 'x'.repeat(81) }), (x) => x.field === 'name');
  await assert.rejects(e.add(ada, { name: 'ok', instructions: 'x'.repeat(4001) }), (x) => x.field === 'instructions');
  await e.remove(ada, project.id);
  await assert.rejects(e.get(ada, project.id), (x) => x.status === 404);
});

test('plan limit: enforce blocks the project over the limit', async () => {
  const { e, s } = engine('enforce', 'free');
  await e.add(ada, { name: 'One' });
  await e.add(ada, { name: 'Two' });
  await assert.rejects(e.add(ada, { name: 'Three' }), (x) => x.status === 402 && x.code === 'quota'
    && x.reason === 'projects' && /Free plan includes 2 projects/.test(x.message));
  assert.equal(s.projects.length, 2);
});

test('plan limit: shadow allows and flags it; off and staff have no limit', async () => {
  const sh = engine('shadow', 'free');
  await sh.e.add(ada, { name: 'One' });
  await sh.e.add(ada, { name: 'Two' });
  const third = await sh.e.add(ada, { name: 'Three' });
  assert.equal(third.over_limit, true);
  assert.equal(sh.s.projects.length, 3);
  const off = engine('off', 'free');
  for (let i = 0; i < 4; i++) assert.equal((await off.e.add(ada, { name: `P${i}` })).over_limit, false);
  const st = engine('enforce', 'free');
  for (let i = 0; i < 4; i++) await st.e.add(staff, { name: `P${i}` });
  assert.equal((await st.e.limitFor(staff)).limit, null);
});

test('plan limit: a plan without the projects entitlement gets none in enforce mode', async () => {
  const { e } = engine('enforce', 'none');
  await assert.rejects(e.add(ada, { name: 'One' }), (x) => x.code === 'quota' && /includes 0 projects/.test(x.message));
});

test('deleting a project keeps its chats and files, moved out of it', async () => {
  const seed = { conversations: [], files: [] };
  const { e, s } = engine('enforce', 'max', seed);
  const { project } = await e.add(ada, { name: 'Trip' });
  s.conversations.push({ id: 'c1', user_id: 1, project_id: project.id, title: 'Flights' });
  s.files.push({ id: 'f1', user_id: 1, project_id: project.id, name: 'visa.pdf', kind: 'pdf', meta: '{"pages":2}' });
  const got = await e.get(ada, project.id);
  assert.deepEqual([got.project.chats, got.project.files, got.chats[0].id, got.files[0].pages], [1, 1, 'c1', 2]);
  const ctx = await e.contextFor(1, project.id);
  assert.equal(ctx.name, 'Trip');
  await e.remove(ada, project.id);
  assert.deepEqual([s.conversations[0].project_id, s.files[0].project_id], [null, null]);
  assert.equal(await e.contextFor(1, project.id), null);
});
