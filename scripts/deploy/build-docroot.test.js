// Builds each app's document root with build-docroot.sh (as .cpanel.yml does) and checks that every
// file the page asks for is there: index.html links, ES module imports, CSS url()s and the models list.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, 'build-docroot.sh');
const VERSION = require(path.join(REPO, 'package.json')).version;

function build(app, doc) { execFileSync('sh', [SCRIPT, REPO, app, doc], { stdio: 'pipe' }); }
const isLocal = (u) => !/^(https?:|data:|\/\/|#|mailto:)/.test(u);
const strip = (u) => u.replace(/[?#].*$/, '');

// Resolves a URL as the browser would against a file in the docroot (the page lives at "/").
function resolve(doc, fromFile, url) {
  const base = url.startsWith('/') ? doc : path.dirname(fromFile);
  return path.join(base, strip(url).replace(/^\//, ''));
}

function checkModule(doc, file, seen, missing) {
  if (seen.has(file)) return; seen.add(file);
  if (!fs.existsSync(file)) { missing.push(path.relative(doc, file)); return; }
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1] || m[2];
    if (spec.startsWith('.') || spec.startsWith('/')) checkModule(doc, resolve(doc, file, spec), seen, missing);
  }
}

for (const app of ['chat', 'browser', 'admin']) {
  test(`${app}: every asset the page loads exists in the built docroot`, () => {
    const doc = fs.mkdtempSync(path.join(os.tmpdir(), `docroot-${app}-`));
    build(app, doc);
    const index = path.join(doc, 'index.html');
    const html = fs.readFileSync(index, 'utf8');
    const missing = [], seen = new Set();
    for (const m of html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"[^>]*>/g)) {
      const url = m[1]; if (!isLocal(url)) continue;
      const file = resolve(doc, index, url);
      if (/type="module"/.test(m[0])) checkModule(doc, file, seen, missing);
      else if (!fs.existsSync(file)) missing.push(url);
      if (file.endsWith('.css') && fs.existsSync(file)) {
        for (const u of fs.readFileSync(file, 'utf8').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
          if (isLocal(u[1]) && !fs.existsSync(resolve(doc, file, u[1]))) missing.push(`${url} -> ${u[1]}`);
        }
      }
    }
    assert.ok(seen.size > 1, 'the module graph was followed');
    assert.deepEqual(missing, []);
    assert.ok(fs.existsSync(path.join(doc, `v${VERSION}`, 'apps', app, 'src', 'main.js')));
    if (app === 'chat') assert.ok(fs.existsSync(path.join(doc, 'assets', 'config', 'models.json')));
    // Unversioned mirrors older releases point at.
    assert.ok(fs.existsSync(path.join(doc, 'brand', 'colon-intro.js')));
    assert.ok(fs.existsSync(path.join(doc, 'ui', 'fonts', 'inter-latin.woff2')));
    fs.rmSync(doc, { recursive: true, force: true });
  });
}

test('a redeploy keeps the server-only .htaccess and older release folders', () => {
  const doc = fs.mkdtempSync(path.join(os.tmpdir(), 'docroot-redeploy-'));
  fs.writeFileSync(path.join(doc, '.htaccess'), 'Header set Cache-Control "no-cache"\n');
  fs.mkdirSync(path.join(doc, 'v0.0.1'));
  fs.writeFileSync(path.join(doc, 'v0.0.1', 'keep.js'), '');
  build('chat', doc);
  build('chat', doc);
  assert.equal(fs.readFileSync(path.join(doc, '.htaccess'), 'utf8'), 'Header set Cache-Control "no-cache"\n');
  assert.ok(fs.existsSync(path.join(doc, 'v0.0.1', 'keep.js')));
  assert.ok(!fs.existsSync(path.join(doc, `.v${VERSION}.tmp`)));
  fs.rmSync(doc, { recursive: true, force: true });
});

test('unknown app names are refused', () => {
  assert.throws(() => build('nope', path.join(os.tmpdir(), 'docroot-nope')));
});
