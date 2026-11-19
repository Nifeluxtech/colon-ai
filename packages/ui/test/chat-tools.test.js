// 0.17.0: chat tools in the chat app (apps/chat/src/lib/chat-tools.js): /image, deep research, the code editor.
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../../../apps/chat/src/lib/chat-tools.js');

test('/image command: prompt parsed, other slashes left alone', () => {
  assert.deepEqual(t.parseImageCommand('/image a red bus in  Lagos'), { prompt: 'a red bus in Lagos' });
  assert.deepEqual(t.parseImageCommand('  /IMAGE\nsunset over the lagoon '), { prompt: 'sunset over the lagoon' });
  assert.deepEqual(t.parseImageCommand('/image'), { prompt: '' });
  assert.equal(t.parseImageCommand('/images of cats'), null);
  assert.equal(t.parseImageCommand('/imagine'), null);
  assert.equal(t.parseImageCommand('draw /image cat'), null);
  assert.equal(t.parseImageCommand(''), null);
  assert.equal(t.parseImageCommand(null), null);
});

test('/image prompt checks match the server limits', () => {
  assert.match(t.imagePromptProblem(''), /Describe the image/);
  assert.match(t.imagePromptProblem('ab'), /Describe the image/);
  assert.equal(t.imagePromptProblem('a cat'), null);
  assert.match(t.imagePromptProblem('x'.repeat(2001)), /2,000/);
  assert.equal(t.imagePromptProblem('x'.repeat(2000)), null);
});

test('deep research: consent from a 409, credit wording', () => {
  assert.deepEqual(t.consentNeeded({ status: 409, code: 'consent_required', credits: 25 }), { credits: 25 });
  assert.deepEqual(t.consentNeeded({ status: 409, code: 'consent_required' }), { credits: 0 });
  assert.equal(t.consentNeeded({ status: 409, code: 'conflict', credits: 5 }), null);
  assert.equal(t.consentNeeded({ status: 402, code: 'consent_required' }), null);
  assert.equal(t.consentNeeded(null), null);
  assert.equal(t.creditText(1), '1 credit');
  assert.equal(t.creditText(40), '40 credits');
  assert.match(t.consentBody(40), /40 credits.*given back/);
});

test('deep research: progress text, terminal states and poll gaps', () => {
  const p = t.researchProgress({ status: 'running', stage: 'search', label: 'Searching the web', steps: 2, total: 8 });
  assert.deepEqual(p, { label: 'Searching the web', pct: 25, steps: 2, total: 8, live: true,
    text: 'Searching the web · step 3 of 8' });
  assert.equal(t.researchProgress({ status: 'queued', steps: 0, total: 0 }).text, 'Waiting to start');
  assert.equal(t.researchProgress({ status: 'done', steps: 8, total: 8 }).text, 'Report ready');
  assert.equal(t.researchProgress({ status: 'running', steps: 12, total: 8 }).pct, 100);
  assert.equal(t.researchProgress(null).label, 'Working');
  ['done', 'failed', 'cancelled'].forEach((s) => assert.equal(t.isTerminal({ status: s }), true));
  ['queued', 'running'].forEach((s) => assert.equal(t.isTerminal({ status: s }), false));
  assert.equal(t.isTerminal(null), false);
  assert.equal(t.pollDelay(0), 3000);
  assert.equal(t.pollDelay(10), 6000);
  assert.equal(t.pollDelay(50), 15000);
});

test('code editor: pinned Monaco, language ids, same-origin worker', () => {
  assert.equal(t.MONACO_VERSION, '0.52.2');
  assert.equal(t.MONACO_BASE, 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min');
  assert.equal(t.monacoLanguage('js'), 'javascript');
  assert.equal(t.monacoLanguage(' PY '), 'python');
  assert.equal(t.monacoLanguage('c++'), 'cpp');
  assert.equal(t.monacoLanguage('brainfuck'), 'plaintext');
  assert.equal(t.monacoLanguage(), 'plaintext');
  const url = t.monacoWorkerUrl();
  assert.ok(url.startsWith('data:text/javascript;charset=utf-8,'));
  const src = decodeURIComponent(url.split(',').slice(1).join(','));
  assert.equal(src, 'self.MonacoEnvironment={baseUrl:"https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/"};'
    + 'importScripts("https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/base/worker/workerMain.js");');
});

test('code editor: load timeout falls back, a fast load wins', async () => {
  let fire = null, cleared = 0;
  const setT = (fn) => { fire = fn; return 1; };
  const clearT = () => { cleared++; };
  const slow = t.withTimeout(new Promise(() => {}), 12000, setT, clearT);
  fire();
  await assert.rejects(slow, (e) => e.code === 'timeout');
  assert.equal(await t.withTimeout(Promise.resolve('monaco'), 12000, setT, clearT), 'monaco');
  assert.equal(cleared, 1);
  await assert.rejects(t.withTimeout(Promise.reject(new Error('blocked')), 12000, setT, clearT), /blocked/);
  assert.equal(cleared, 2);
});
