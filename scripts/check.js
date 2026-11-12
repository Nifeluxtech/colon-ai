// Repository checks (CI: node scripts/check.js). Exits 1 when any rule fails.
//   1. Syntax: every .js file parses (node --check).
//   2. Size: source files are at most 300 lines and no line is longer than 120 characters.
//   3. API layers (services/api/src): http and ws -> modules -> shared, db, config.
//      - routes (http/routes) import only modules/<name>/index.js, shared/, config/, http/middleware/,
//        http/router.js and other route files;
//      - nothing imports another module's internals (modules/<name>/... other than its index.js);
//      - modules, shared, db and config never import http/ or ws/; shared, db and config never import modules/.
//   4. Web apps: apps import packages/ui only through its public entry files, never another app; every asset
//      and module URL in apps/*/public/index.html is on the package.json version (/v<version>/... or ?v=<version>);
//      Colon.version and every package.json version match it.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const MAX_LINE = 120;
const MAX_LINES = 300;
const CODE = /\.(js|cjs|mjs|css|html|sh|ya?ml|sql)$/;
// Data, generated or third-party content: exempt from the size rules (still syntax-checked when .js).
const EXEMPT = [
  /(^|\/)tests?\/fixtures\//,        // captured pages and payloads used by tests
  /^services\/api\/bench\/(sets|results)\//, // benchmark question sets and recorded runs
  /^database\/migrations\//,          // SQL migrations are append-only history
  /^packages\/ui\/fonts\//,           // font files
];
const SKIP_DIRS = new Set(['node_modules', '.git']);

const failures = [];
const fail = (rule, msg) => failures.push(`✗ [${rule}] ${msg}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT);

/* ---------- 1. Syntax ---------- */
const jsFiles = files.filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { fail('syntax', `${rel(f)}\n${e.stderr}`); }
}
console.log(`Syntax: ${jsFiles.length} files checked`);

/* ---------- 2. Size ---------- */
let sized = 0;
for (const f of files) {
  const r = rel(f);
  if (!CODE.test(r) || EXEMPT.some((x) => x.test(r))) continue;
  sized++;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length > MAX_LINES) fail('size', `${r}: ${lines.length} lines (max ${MAX_LINES})`);
  lines.forEach((l, i) => {
    if (l.length > MAX_LINE) fail('size', `${r}:${i + 1}: ${l.length} characters (max ${MAX_LINE})`);
  });
}
console.log(`Size: ${sized} source files checked (≤${MAX_LINES} lines, ≤${MAX_LINE} characters per line)`);

/* ---------- 3. API layers ---------- */
const API_SRC = path.join(ROOT, 'services', 'api', 'src');
// Local require()s of a file, resolved to absolute paths (node built-ins and packages are ignored).
function localRequires(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(/require\(\s*(['"])(\.{1,2}\/[^'"]*|\.{1,2})\1\s*\)/g)) {
    let t = path.resolve(path.dirname(file), m[2]);
    if (fs.existsSync(t) && fs.statSync(t).isDirectory()) t = path.join(t, 'index.js');
    else if (!t.endsWith('.js') && fs.existsSync(t + '.js')) t += '.js';
    out.push({ spec: m[2], target: t });
  }
  return out;
}
// Where a path sits: { layer: 'http'|'ws'|'modules'|'shared'|'db'|'config'|..., module, internal, routes }
function place(p) {
  const r = path.relative(API_SRC, p).split(path.sep);
  if (r[0] === '..') return { layer: 'outside' };
  const at = { layer: r[0] };
  if (r[0] === 'modules') { at.module = r[1]; at.internal = !(r.length === 3 && r[2] === 'index.js'); }
  if (r[0] === 'http') {
    at.routes = r[1] === 'routes'; at.middleware = r[1] === 'middleware'; at.router = r[1] === 'router.js';
  }
  return at;
}
let apiFiles = 0;
const apiEntry = path.join(ROOT, 'services', 'api', 'app.js');
for (const f of files.filter((x) => x.startsWith(API_SRC + path.sep) && x.endsWith('.js')).concat([apiEntry])) {
  if (!fs.existsSync(f)) continue;
  apiFiles++;
  const from = place(f);
  for (const { spec, target } of localRequires(f)) {
    const to = place(target);
    const where = `${rel(f)} requires '${spec}'`;
    if (to.layer === 'modules' && to.internal && from.module !== to.module) {
      fail('layers', `${where}: another module's internals (use modules/${to.module}/index.js)`);
    }
    if (from.routes && to.layer !== 'outside') {
      const ok = (to.layer === 'modules' && !to.internal) || to.layer === 'shared' || to.layer === 'config'
        || to.middleware || to.router || to.routes;
      if (!ok) fail('layers', `${where}: routes may import only modules/*/index.js, shared/, config/ and http/`);
    }
    if (['modules', 'shared', 'db', 'config'].includes(from.layer) && ['http', 'ws'].includes(to.layer)) {
      fail('layers', `${where}: ${from.layer}/ must not import ${to.layer}/ (layers point http -> modules -> shared)`);
    }
    if (['shared', 'db', 'config'].includes(from.layer) && to.layer === 'modules') {
      fail('layers', `${where}: ${from.layer}/ must not import modules/`);
    }
    if (!fs.existsSync(target)) fail('layers', `${where}: file not found`);
  }
}
console.log(`API layers: ${apiFiles} files checked`);

/* ---------- 4. Web apps ---------- */
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const UI_JS = path.join(ROOT, 'packages', 'ui', 'js');
// The UI kit's public faces; everything else under packages/ui/js is internal to it.
const UI_ENTRIES = ['colon.js', 'store.js', 'url.js', 'markdown/index.js', 'browser/index.js', 'browser/data.js',
  'browser/saga-browse.js'].map((p) => path.join(UI_JS, p));
let appFiles = 0;
for (const f of files.filter((x) => /^apps\/[^/]+\/src\/.*\.js$/.test(rel(x)))) {
  appFiles++;
  const app = rel(f).split('/')[1];
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?(?:from\s*)?(['"])([^'"]+)\1/gm)) {
    const spec = m[2];
    if (!spec.startsWith('.')) {
      fail('apps', `${rel(f)}: imports '${spec}' (browsers load only relative ES module paths here)`); continue;
    }
    const t = path.resolve(path.dirname(f), spec);
    const r = rel(t);
    if (!fs.existsSync(t)) fail('apps', `${rel(f)}: '${spec}' not found`);
    if (r.startsWith('apps/') && r.split('/')[1] !== app) fail('apps', `${rel(f)}: imports another app (${r})`);
    if (t.startsWith(UI_JS + path.sep) && !UI_ENTRIES.includes(t)) {
      fail('apps', `${rel(f)}: imports UI kit internals (${r}); use its entry files`);
    }
  }
}
console.log(`Web apps: ${appFiles} app modules checked`);

// index.html: every local CSS/JS/font/icon URL is on this version, so a phone never mixes releases.
for (const app of ['chat', 'browser', 'admin']) {
  const file = path.join(ROOT, 'apps', app, 'public', 'index.html');
  if (!fs.existsSync(file)) { fail('versions', `apps/${app}/public/index.html is missing`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|data:|\/\/|#|mailto:)/.test(url) || !/\.(css|js|woff2|svg|png|json)(\?|$)/.test(url)) continue;
    const ok = url.startsWith('/') ? url.startsWith(`/v${version}/`) : url.endsWith(`?v=${version}`);
    if (!ok) fail('versions', `apps/${app}/public/index.html: ${url} is not on v${version}`);
  }
}
const core = path.join(UI_JS, 'colon.js');
if (!fs.readFileSync(core, 'utf8').includes(`version: '${version}'`)) {
  fail('versions', `packages/ui/js/colon.js: Colon.version should be '${version}'`);
}
for (const f of files.filter((x) => path.basename(x) === 'package.json')) {
  const v = JSON.parse(fs.readFileSync(f, 'utf8')).version;
  if (v !== undefined && v !== version) fail('versions', `${rel(f)}: version ${v} should be ${version}`);
}
console.log(`Versions: index.html assets, Colon.version and package.json files on v${version}`);

if (failures.length) {
  console.error('\n' + failures.join('\n'));
  console.error(`\n${failures.length} problem(s)`);
  process.exit(1);
}
console.log('All checks passed');
