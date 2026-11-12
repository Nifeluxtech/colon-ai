// Integration test: the model-change gate wired into the real admin routes and handlers (fake db module):
// adding, changing or re-enabling a model, or a new first choice in routing, needs a fresh benchmark.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const report = require('../../src/modules/bench/report');
/* ---------- gate wired into the admin save paths ---------- */
test('admin: adding, changing or re-enabling a model, or a new first choice in routing, needs a fresh benchmark',
  async () => {
  const dbPath = require.resolve('../../src/db');
  const state = { runs: [], sql: [], model: { id: 7, provider_id: 'nvidia', model: 'z-ai/glm-5.3-flash', enabled: 1 } };
  const fakeDb = {
    async query(sql, p) {
      state.sql.push(sql);
      if (/COUNT\(\*\)/.test(sql)) return [{ c: 1 }];
      if (/FROM eval_runs/.test(sql)) return state.runs.filter(r => !p || (r.provider === p[0] && r.model === p[1]));
      if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) return { insertId: 99, affectedRows: 1 };
      return [];
    },
    async one(sql) { return /FROM ai_models/.test(sql) ? state.model : null; },
  };
  const saved = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(
    dbPath)] };
  for (const k of Object.keys(require.cache)) if (/src[\\/](http|modules[\\/]admin|shared[\\/](audit|settings))/.test(
    k)) delete require.cache[k];
  try {
    const r = require('../../src/http/routes/admin');
    const find = (m, p) => r.routes.find(x => x.method === m && x.re.test(p)).handlers[1];
    const req = (body, role = 'admin', params = {}) => ({ user: { id: 1, role, totp_enabled: 1 }, params, body, ip: '',
      headers: {} });
    const fresh = { provider: 'nvidia', model: 'minimaxai/minimax-m3.1-flash', kind: 'bench', status: 'done',
      created_at: new Date() };

    const add = find('POST', '/admin/models');
    const body = { target: 'minimax', provider_id: 'nvidia', model: 'minimaxai/minimax-m3.1-flash' };
    await assert.rejects(add(req(body)), (e) => e.status === 409 && e.code === 'needs_benchmark');
    await assert.rejects(add(req({ ...body, skip_benchmark: 'urgent' })), (e) => e.code === 'needs_benchmark',
      'only a super admin can skip');
    const [st] = await add(req({ ...body, skip_benchmark: 'provider outage, benchmark running' }, 'super_admin'));
    assert.equal(st, 201);
    assert.ok(state.sql.some(s => /audit/i.test(s)), 'the skip is audited');
    const [, disabled] = await add(req({ ...body, enabled: false }));
    assert.equal(disabled.ok, true, 'adding a disabled model is not gated');
    state.runs = [fresh];
    assert.equal((await add(req(body)))[0], 201);

    const patch = find('PATCH', '/admin/models/7');
    await assert.rejects(patch(req({ model: 'brand-new/model' }, 'admin', { id: '7' })),
      (e) => e.code === 'needs_benchmark');
    assert.equal((await patch(req({ priority: 3 }, 'admin', { id: '7' })))[0], 200, 'reordering is not a model change');
    state.model = { ...state.model, enabled: 0 };
    await assert.rejects(patch(req({ enabled: true }, 'admin', { id: '7' })), (e) => e.code === 'needs_benchmark',
      're-enabling an unbenchmarked model');
    state.runs = [{ ...fresh, model: 'z-ai/glm-5.3-flash' }];
    assert.equal((await patch(req({ enabled: true }, 'admin', { id: '7' })))[0], 200);

    const routingPatch = find('PATCH', '/admin/routing');
    require('../../src/modules/ai/dynamic').clear();
    state.runs = [];
    await assert.rejects(routingPatch(req({ routes: { general: ['glm', 'deepseek'] } })),
      (e) => e.code === 'needs_benchmark', 'new Saga default');
    assert.equal((await routingPatch(req({ routes: { general: ['gemma', 'glm'] } })))[0], 200,
      'same first choice, new fallbacks');

    const imp = find('POST', '/admin/evaluation/bench');
    const evalRows = report.evalRows(report.buildReport({ run: 'x', suite: 'colon-bench-1', started: '',
      finished: new Date().toISOString(),
      models: [{ provider: 'nvidia', model: 'z-ai/glm-5.3-flash', rows: [{ set: 'waec', id: 'w', pass: true, score: 1,
        first_token_ms: 1, total_ms: 2 }], expected: 1 }] }));
    const [ist, ires] = await imp(req(JSON.parse(JSON.stringify({ runs: evalRows }))));
    assert.equal(ist, 201);
    assert.equal(ires.ids.length, 1);
    await assert.rejects(imp(req({ runs: [{ provider: 'nvidia', model: 'm', score: 140, created_at: new Date(
      ).toISOString() }] })), (e) => e.status === 422);
  } finally {
    if (saved) require.cache[dbPath] = saved; else delete require.cache[dbPath];
  }
});
