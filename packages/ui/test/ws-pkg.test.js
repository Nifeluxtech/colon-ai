// Unit tests for apps/chat/src/lib/ws-pkg.js (v0.30.1): npm / pip in the Workspace terminal.
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../../../apps/chat/src/lib/ws-pkg.js');
const { createShell } = require('../../../apps/chat/src/lib/ws-shell.js');
const { buildPage } = require('../../../apps/chat/src/lib/ws-site.js');
const server = require('../../../services/api/src/modules/workspace/pkgmap.js');

function rig(runOk) {
  const files = { 'index.html': '<html><head></head><body></body></html>' }, lines = [], runs = [];
  const io = {
    fs: {
      list: () => Object.keys(files).map((p) => ({ path: p, size: 1 })),
      read: (p) => (p in files ? { encoding: 'utf8', content: files[p] } : Promise.reject(new Error('none'))),
      write: (p, t) => { files[p] = t; return Promise.resolve(); },
      remove: () => Promise.resolve(), move: () => Promise.resolve(),
    },
    files: () => Promise.resolve(Object.assign({}, files)),
    run: (lang, code, o) => { runs.push([lang, code]); return Promise.resolve({ ok: runOk !== false }); },
    print: (k, t) => lines.push([k, t]), clear: () => {}, open: () => {},
  };
  return { sh: createShell(io), files, lines, runs };
}

test('import map from package.json', () => {
  const m = pkg.importMap(JSON.stringify({ dependencies: { '@supabase/supabase-js': '^2.119.2', bad$: '1' } }));
  assert.equal(m.imports['@supabase/supabase-js'], 'https://esm.sh/@supabase/supabase-js@2.119.2');
  assert.equal(m.imports['@supabase/supabase-js/'], 'https://esm.sh/@supabase/supabase-js@2.119.2/');
  assert.equal(m.imports.bad$, undefined);
  assert.equal(pkg.importMap('{}'), null);
  assert.equal(pkg.importMap('nope'), null);
  assert.deepEqual(server.importMap(JSON.stringify({ dependencies: { a: '~1.2.3' } })), pkg.importMap(
    JSON.stringify({ dependencies: { a: '~1.2.3' } })));
});

test('withImportMap adds once, after <head>', () => {
  const m = { imports: { a: 'https://esm.sh/a@1' } };
  const h = pkg.withImportMap('<head><title>x</title></head>', m);
  assert.match(h, /^<head><script type="importmap">/);
  assert.equal(pkg.withImportMap(h, m), h);
  assert.equal(server.withImportMap('<head></head>', m), pkg.withImportMap('<head></head>', m));
});

test('preview adds the import map', () => {
  const files = [{ path: 'index.html', content: '<head></head><script type="module">import "a"</script>' },
    { path: 'package.json', content: '{"dependencies":{"a":"^1.0.0"}}' }];
  assert.match(buildPage(files, 'index.html', '').html, /"a":"https:\/\/esm.sh\/a@1.0.0"/);
});

test('rewriteImports for node', () => {
  const m = pkg.importMap('{"dependencies":{"lodash-es":"^4.17.21"}}');
  assert.equal(pkg.rewriteImports("await import('lodash-es/chunk')", m),
    "await import('https://esm.sh/lodash-es@4.17.21/chunk')");
  assert.equal(pkg.rewriteImports('import("other")', m), 'import("other")');
});

test('requirements parsing', () => {
  assert.deepEqual(pkg.reqLines('numpy\n# c\n-r x\nrequests==2.31.0  # pin\n\n'), ['numpy', 'requests==2.31.0']);
  assert.match(pkg.pyInstallCode(['numpy'], false), /_colon_req/);
});

test('npm install supabase writes package.json', async () => {
  const r = rig();
  global.fetch = async (url) => {
    assert.match(url, /registry\.npmjs\.org\/@supabase%2fsupabase-js\/latest/);
    return { ok: true, status: 200, json: async () => ({ version: '2.119.2' }) };
  };
  await r.sh.exec('npm install supabase');
  assert.equal(JSON.parse(r.files['package.json']).dependencies['@supabase/supabase-js'], '^2.119.2');
  assert.ok(r.lines.some((l) => /\+ @supabase\/supabase-js@2.119.2/.test(l[1])));
  await r.sh.exec('npm install node');
  assert.ok(r.lines.some((l) => l[0] === 'err' && /runtime/.test(l[1])));
  await r.sh.exec('npm uninstall supabase');
  assert.deepEqual(JSON.parse(r.files['package.json']).dependencies, {});
  global.fetch = async () => ({ ok: false, status: 404 });
  await r.sh.exec('npm i nopenopenope');
  assert.ok(r.lines.some((l) => l[0] === 'err' && /no package/.test(l[1])));
});

test('pip install records requirements and python reinstalls them', async () => {
  const r = rig();
  await r.sh.exec('pip install numpy');
  assert.equal(r.files['requirements.txt'], 'numpy\n');
  await r.sh.exec('pip install numpy');
  assert.equal(r.files['requirements.txt'], 'numpy\n');
  r.runs.length = 0;
  await r.sh.exec('python -c "print(1)"');
  assert.equal(r.runs.length, 2);
  assert.match(r.runs[0][1], /micropip/);
  await r.sh.exec('pip uninstall numpy');
  assert.equal(r.files['requirements.txt'].trim(), '');
  const bad = rig(false);
  await bad.sh.exec('pip install notreal');
  assert.equal(bad.files['requirements.txt'], undefined);
});
