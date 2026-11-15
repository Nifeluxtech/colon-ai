// 0.11.5 (owner): Saga must act. It never finishes by telling the user to tap something ("tap it yourself"), even
// after the usual 3 refusals of a finish, and it hands the browser over only for real secret fields (password, code,
// card, PIN), a captcha or a payment, as in 0.11.4: a requestUserControl "other" on a page without one is refused
// and sent back as an observation. The model and the phone are scripted fakes.
const test = require('node:test');
const assert = require('node:assert/strict');
const goal = require('../../src/modules/saga/goal');
const prompt = require('../../src/modules/saga/prompt');
const safety = require('../../src/modules/safety');
const { run } = require('../../src/modules/saga/loop');

console.log = () => {};
const LIMITS = { maxSteps: 12, taskTimeoutMs: 5000, modelTimeoutMs: 1000, stepTimeoutMs: 500, approvalTimeoutMs: 800 };
const REPO = { url: 'https://github.com/Nifeluxtech/colon-ai', title: 'Nifeluxtech/colon-ai' };

test('goal.handsBack: "tap it yourself" and its kin are refused; outcomes in the past tense are not', () => {
  for (const a of ['The repository is on screen, tap it yourself.', 'You will need to click the repository to open '
    + 'it.', 'Tap the colon-ai link to open it.', 'Go ahead and open the first result.', 'You\'ll have to scroll down '
    + 'and click it yourself.', 'I am going to open it now.']) {
    assert.equal(goal.handsBack(a), goal.HANDS_BACK, a);
  }
  for (const a of ['I opened the colon-ai repository.', 'I tapped the second result: Infinix Smart 20, ₦98,000.',
    'You\'re already signed in to github.com as Nifeluxtech.', 'Your tasks page shows 3 open tasks.']) {
    assert.equal(goal.handsBack(a), null, a);
  }
});

test('loop: a "tap it yourself" finish is refused every time, also after MAX_REFUSALS; then Saga opens it',
  async () => {
  const lazy = { say: 'Found it', action: 'finish', args: { result: 'Found the repo', answer: 'The colon-ai '
    + 'repository is on screen, tap it yourself to open it.' } };
  const replies = [...Array(goal.MAX_REFUSALS + 2).fill(lazy),
    { say: 'Opening it', action: 'openUrl', args: { url: REPO.url } },
    { say: 'Done', action: 'finish', args: { result: 'Opened colon-ai',
      answer: 'I opened the colon-ai repository.' } }];
  let i = 0;
  const seen = [];
  const decide = async (messages) => { seen.push(messages.at(-1).content); return JSON.stringify(replies[i++]); };
  const command = async (name) => ({ ok: true, result: name === 'open_url' ? REPO : {} });
  const r = await run({ goal: 'Show me the colon-ai repository', limits: LIMITS, isStopped: async () => false,
    decide, command, pageState: () => ({ url: 'https://github.com/', title: 'GitHub', at: 1 }) });
  assert.equal(r.status, 'done');
  assert.equal(r.answer, 'I opened the colon-ai repository.');
  const refusals = seen.filter((c) => /you never finish by telling the user to tap|do not ask the user to tap/
    .test(c));
  assert.equal(refusals.length, goal.MAX_REFUSALS + 2);
});

test('loop: requestUserControl "other" on a page with no secret field is refused; a password field is handed over',
  async () => {
    const replies = [
      { say: 'Asking the user', action: 'requestUserControl', args: { reason: 'other', instructions: 'Tap the repo' } },
      { say: 'Opening it', action: 'openUrl', args: { url: REPO.url } },
      { say: 'Done', action: 'finish', args: { result: 'Opened', answer: 'I opened the colon-ai repository.' } }];
    let i = 0;
    const seen = [];
    const handed = [];
    const decide = async (messages) => { seen.push(messages.at(-1).content); return JSON.stringify(replies[i++]); };
    const dashboard = { url: 'https://github.com/', title: 'GitHub', text: 'Top repositories', elements: [
      { id: 'c1', tag: 'a', text: 'Nifeluxtech/colon-ai', href: REPO.url }] };
    const command = async (name) => ({ ok: true, result: name === 'open_url' ? REPO : name === 'get_page_content'
      ? dashboard : {} });
    const r = await run({ goal: 'Open the colon ai repository', limits: LIMITS, isStopped: async () => false, decide,
      command, handoff: async (info) => { handed.push(info); return 'return_to_ai'; } });
    assert.equal(r.status, 'done');
    assert.equal(handed.length, 0);
    assert.ok(seen.some((c) => c === goal.SELF));
    // The same request on a sign-in page with a password field goes to the user.
    const login = { url: 'https://bank.example.ng/login', title: 'Sign in', text: '', elements: [
      { id: 'c1', tag: 'input', type: 'password', secret: 'password', label: 'Password' }] };
    let j = 0;
    const two = [{ say: 'Need the password', action: 'requestUserControl', args: { reason: 'other' } },
      { say: 'Reading', action: 'getPageContent', args: {} },
      { say: 'Done', action: 'finish', args: { result: 'Signed in', answer: 'You signed in.' } }];
    const r2 = await run({ goal: 'Check my balance', limits: LIMITS, isStopped: async () => false,
      decide: async () => JSON.stringify(two[j++]), command: async () => ({ ok: true, result: login }),
      handoff: async (info) => { handed.push(info); return 'return_to_ai'; } });
    assert.equal(handed.length, 1);
    assert.equal(r2.status, 'done');
    assert.equal(goal.selfStep({ kind: 'consent' }, { overlay: { frame: true } }), null);   // a frame Saga can't read
    assert.equal(goal.selfStep({ kind: 'captcha' }, {}), null);
  });

test('prompt: hand-overs only for secrets, a captcha or a payment; a cleared cookie banner is named', () => {
  const sys = prompt.system({ maxSteps: 10, mode: 'ai' });
  assert.match(sys, /ONLY when the page needs a secret only they can type/);
  assert.match(sys, /"tap it yourself"/);
  const ob = prompt.observe({ name: 'get_page_content', tool: 'getPageContent', args: {} }, { ok: true, result: {
    url: 'https://www.bbc.com/', title: 'BBC', text: 'News', elements: [],
    consent: { cleared: true, cmp: 'onetrust' } } },
  { guard: safety.collector(), pages: [] });
  assert.match(ob.text, /Colon closed a cookie banner \(onetrust\) by rejecting it/);
});
