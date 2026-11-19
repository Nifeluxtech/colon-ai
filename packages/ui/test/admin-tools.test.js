// 0.17.0: Admin › Tools (apps/admin/src/lib/tools-view.js and the route in apps/admin/src/core/router.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { creditCost, offReason, planAccess, summary, timeout, toolView } =
  require('../../../apps/admin/src/lib/tools-view.js');

const ROOT = path.resolve(__dirname, '../../..');
const IMAGE = { name: 'generate_image', description: 'Create a picture.', risk: 'medium', plans: null,
  entitlement: 'image_credits', credits: 2, timeout_ms: 60000, consent: false, guests: false, model: true,
  defer: false, enabled: false, runs_in: 'caller', note: 'Off while IMAGE_MODEL is empty.', stats: null };
const RESEARCH = { name: 'deep_research', risk: 'medium', plans: ['pro', 'max'], entitlement: 'research_tasks',
  credits: 20, timeout_ms: 15000, consent: true, guests: false, model: false, defer: true, enabled: true,
  runs_in: 'caller', note: '', stats: { calls: 3, ok: 2, failed: 1, refused: 0, gated: 0, last_error: 'timeout' } };
const READ = { name: 'read_url', risk: 'low', plans: null, entitlement: null, credits: 0, timeout_ms: 20000,
  consent: false, guests: true, enabled: true, runs_in: 'server', stats: null };
const BROWSE = { name: 'browse', risk: 'high', plans: null, credits: 0, timeout_ms: 15000, enabled: true };

test('plan access: every plan or listed plans, guests, and the allowance it draws on', () => {
  assert.equal(planAccess(READ), 'Every plan · guests too');
  assert.equal(planAccess(IMAGE), 'Every plan · signed-in only · uses the plan\'s image credits (Admin › Plans)');
  assert.equal(planAccess(RESEARCH), 'Plans: pro, max · signed-in only · uses the plan\'s deep research tasks '
    + '(Admin › Plans)');
  assert.equal(planAccess({ plans: [] }), 'No plan · signed-in only');
});

test('credits and timeouts', () => {
  assert.equal(creditCost(READ), 'No credits');
  assert.equal(creditCost({ credits: 1 }), '1 credit per call');
  assert.equal(creditCost(RESEARCH), '20 credits (reserved, settled when the work ends)');
  assert.equal(timeout(15000), '15 s');
  assert.equal(timeout(1500), '1.5 s');
  assert.equal(timeout(800), '800 ms');
});

test('feature-off state: image generation off while IMAGE_MODEL is empty', () => {
  const v = toolView(IMAGE);
  assert.equal(v.state, 'off');
  assert.equal(v.off, 'Off: IMAGE_MODEL is empty.');
  assert.equal(offReason({ ...IMAGE, enabled: true }), '');
  assert.equal(offReason({ name: 'other', enabled: false }), 'Off: its feature switch is off.');
  assert.deepEqual(v.flags, ['chat model', 'runs in its caller']);
  assert.equal(v.stats, 'No calls on this worker yet.');
});

test('row: risk badge, consent, stats', () => {
  const v = toolView(RESEARCH);
  assert.equal(v.riskClass, ' warn');
  assert.equal(toolView(BROWSE).riskClass, ' bad');
  assert.equal(v.consent, 'Asks the user first');
  assert.equal(toolView(READ).consent, 'No consent step');
  assert.deepEqual(v.flags, ['background', 'runs in its caller']);
  assert.equal(v.stats, '3 calls · 2 ok · 1 failed · 0 refused · 0 gated · last error: timeout');
});

test('summary tiles', () => {
  assert.deepEqual(summary([IMAGE, RESEARCH, READ, BROWSE]), { total: 4, on: 3, off: 1, high: 1 });
  assert.deepEqual(summary([]), { total: 0, on: 0, off: 0, high: 0 });
});

test('the real catalogue renders (the tools[] of GET /admin/tools, from registry.describe())', () => {
  const api = '../../../services/api/src/modules/tools/';
  const reg = require(api + 'catalogue.js').registerAll(require(api + 'registry.js').create());
  const d = { tools: reg.describe() };
  assert.ok(d.tools.length > 0);
  for (const t of d.tools) {
    const v = toolView(t);
    assert.ok(v.name && v.plans && v.credits && v.timeout && v.consent, t.name);
    assert.ok(['on', 'off'].includes(v.state));
  }
  const img = d.tools.find((t) => t.name === 'generate_image');
  if (img && !img.enabled) assert.equal(toolView(img).off, 'Off: IMAGE_MODEL is empty.');
});

test('route and menu entry are gated like Jobs (admin)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps/admin/src/core/router.js'), 'utf8');
  assert.match(src, /\['\/jobs', 'clock', 'Jobs', '[^']+', 'admin'\]/);
  assert.match(src, /\['\/tools', '[a-z]+', 'Tools', '[^']+', 'admin'\]/);
  assert.match(src, /r\('\/tools', toolsPage, 'Tools', 'admin'\)/);
  assert.match(src, /import \{ toolsPage \} from '\.\.\/pages\/tools\.js';/);
});
