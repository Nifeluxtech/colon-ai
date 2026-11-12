// Colon benchmark: runs model-written JavaScript against unit tests, isolated from the API process.
// The code runs in a separate Node child process (killed after a timeout), inside a fresh vm context with
// no require, process, network or file access, and its own CPU timeout. Only JSON goes in and out.
const { spawnSync } = require('child_process');

const CHILD = `
const vm = require('vm');
const assert = require('assert');
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const { code, fn, tests, timeoutMs } = JSON.parse(input);
  const out = { passed: 0, total: tests.length, error: null, fails: [] };
  const ctx = vm.createContext({ module: { exports: {} }, exports: {}, console: { log() {}, error() {}, warn() {} } });
  const src = code.replace(/^\\s*export\\s+(default\\s+)?/gm, '').replace(/^\\s*import\\s.*$/gm, '')
    + '\\n;globalThis.__fn = (typeof ' + fn + ' === "function") ? ' + fn + ' : (module.exports && (module.exports.' + fn + ' || (typeof module.exports === "function" ? module.exports : undefined)));';
  try { vm.runInContext(src, ctx, { timeout: timeoutMs }); }
  catch (e) { out.error = 'does not run: ' + String(e && e.message || e).slice(0, 160); process.stdout.write(JSON.stringify(out)); return; }
  if (typeof ctx.__fn !== 'function') { out.error = 'function ' + fn + ' not found'; process.stdout.write(JSON.stringify(out)); return; }
  for (const t of tests) {
    try {
      ctx.__args = JSON.parse(JSON.stringify(t.args));
      const got = vm.runInContext('JSON.stringify(__fn(...__args))', ctx, { timeout: timeoutMs });
      assert.deepStrictEqual(got === undefined ? undefined : JSON.parse(got), t.expect);
      out.passed++;
    } catch (e) { if (out.fails.length < 2) out.fails.push(String(e && e.message || e).split('\\n')[0].slice(0, 120)); }
  }
  if (out.fails.length) out.error = out.fails.join('; ');
  process.stdout.write(JSON.stringify(out));
});`;

/** runCode(code, fn, tests[{args, expect}], timeoutMs=2000) -> { passed, total, error } */
function runCode(code, fn, tests, timeoutMs = 2000) {
  if (!/^[A-Za-z_$][\w$]*$/.test(String(fn))) return { passed: 0, total: tests.length, error: 'bad function name' };
  const r = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', CHILD], {
    input: JSON.stringify({ code: String(code || ''), fn, tests, timeoutMs }),
    timeout: timeoutMs * (tests.length + 2) + 2000, encoding: 'utf8', env: {}, maxBuffer: 1 << 20,
  });
  if (r.error || r.status !== 0) return { passed: 0, total: tests.length, error: r.error && r.error.code === 'ETIMEDOUT' ? 'timed out' : `crashed: ${String(r.stderr || r.error).slice(0, 160)}` };
  try { return JSON.parse(r.stdout); } catch { return { passed: 0, total: tests.length, error: 'no result' }; }
}

module.exports = { runCode };
