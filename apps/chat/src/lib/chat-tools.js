/* Colon AI · chat tools (v0.17.0, Blueprint D15/D16): pure helpers for /image, deep research and the code editor.
   No DOM and no imports, so Node unit tests load it directly (packages/ui/test/chat-tools.test.js). */

/* ---------- /image <prompt> ---------- */
// "/image a red bus in Lagos" -> { prompt: 'a red bus in Lagos' }; "/image" alone -> { prompt: '' } (ask for one);
// anything else (including "/images", "/imagine") -> null, so it is sent as a normal message.
function parseImageCommand(text) {
  var m = /^\s*\/image(?:\s+([\s\S]*))?$/i.exec(String(text || ''));
  if (!m) return null;
  return { prompt: String(m[1] || '').replace(/\s+/g, ' ').trim() };
}
// What the composer says before calling the images endpoint; null = OK to send (the server checks again).
function imagePromptProblem(prompt) {
  var p = String(prompt || '').trim();
  if (p.length < 3) return 'Describe the image after /image, e.g. /image a sunset over Lagos lagoon.';
  if (p.length > 2000) return 'Keep the description under 2,000 characters.';
  return null;
}

/* ---------- Deep research ---------- */
var TERMINAL = ['done', 'failed', 'cancelled'];
function isTerminal(run) { return !!run && TERMINAL.indexOf(run.status) > -1; }
// A 409 consent_required answer -> { credits } for the confirm dialog; anything else -> null.
function consentNeeded(e) {
  if (!e || e.status !== 409 || e.code !== 'consent_required') return null;
  var n = Math.max(0, Math.floor(Number(e.credits) || 0));
  return { credits: n };
}
function creditText(n) { return n === 1 ? '1 credit' : n + ' credits'; }
function consentBody(credits) {
  return 'Deep research searches and reads many sources in the background and writes a report into this chat. '
    + 'It uses ' + creditText(credits) + '. If it fails or you stop it, your credits are given back.';
}
// Progress shown in the thread for one run (GET /research/:id -> run).
function researchProgress(run) {
  run = run || {};
  var steps = Math.max(0, Number(run.steps) || 0), total = Math.max(0, Number(run.total) || 0);
  var pct = total ? Math.min(100, Math.round(steps / total * 100)) : 0;
  var label = run.status === 'queued' ? 'Waiting to start' : run.status === 'done' ? 'Report ready'
    : run.status === 'failed' ? 'Research failed' : run.status === 'cancelled' ? 'Stopped'
    : run.label || 'Working';
  return { label: label, pct: pct, steps: steps, total: total, live: !isTerminal(run),
    text: label + (total && !isTerminal(run) ? ' · step ' + Math.min(steps + 1, total) + ' of ' + total : '') };
}
// Poll gap: quick at first, then slower; long runs are checked about every 15 s.
function pollDelay(attempt) {
  var a = Math.max(0, Number(attempt) || 0);
  return a < 5 ? 3000 : a < 20 ? 6000 : 15000;
}

/* ---------- Code editor (Developer mode, item 17) ---------- */
var MONACO_VERSION = '0.52.2';
var MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@' + MONACO_VERSION + '/min';
var MONACO_TIMEOUT_MS = 12000;
var LANGS = { js: 'javascript', javascript: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', typescript: 'typescript', tsx: 'typescript', py: 'python', python: 'python', html: 'html',
  css: 'css', scss: 'scss', json: 'json', md: 'markdown', markdown: 'markdown', sh: 'shell', bash: 'shell',
  shell: 'shell', zsh: 'shell', sql: 'sql', php: 'php', java: 'java', kotlin: 'kotlin', kt: 'kotlin', go: 'go',
  rust: 'rust', rs: 'rust', c: 'c', cpp: 'cpp', 'c++': 'cpp', cs: 'csharp', csharp: 'csharp', rb: 'ruby',
  ruby: 'ruby', swift: 'swift', dart: 'dart', yaml: 'yaml', yml: 'yaml', xml: 'xml', dockerfile: 'dockerfile' };
// A code block's label (```js) -> Monaco's language id ('plaintext' when unknown).
function monacoLanguage(label) { return LANGS[String(label || '').trim().toLowerCase()] || 'plaintext'; }
// Monaco's web workers must come from this page's origin: a tiny data: worker imports the CDN one.
function monacoWorkerUrl(base) {
  base = base || MONACO_BASE;
  return 'data:text/javascript;charset=utf-8,' + encodeURIComponent('self.MonacoEnvironment={baseUrl:'
    + JSON.stringify(base + '/') + '};importScripts(' + JSON.stringify(base + '/vs/base/worker/workerMain.js') + ');');
}
// p settles first, or the timeout rejects with code 'timeout' (the editor then falls back to a textarea).
function withTimeout(p, ms, setT, clearT) {
  setT = setT || setTimeout; clearT = clearT || clearTimeout;
  return new Promise(function (resolve, reject) {
    var t = setT(function () { reject(Object.assign(new Error('The editor took too long to load.'),
      { code: 'timeout' })); }, ms);
    Promise.resolve(p).then(function (v) { clearT(t); resolve(v); }, function (e) { clearT(t); reject(e); });
  });
}

export { MONACO_BASE, MONACO_TIMEOUT_MS, MONACO_VERSION, consentBody, consentNeeded, creditText, imagePromptProblem,
  isTerminal, monacoLanguage, monacoWorkerUrl, parseImageCommand, pollDelay, researchProgress, withTimeout };
