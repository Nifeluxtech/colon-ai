// Syntax-checks every JavaScript file in the repo (used by CI).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const skip = new Set(['node_modules', '.git']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(process.cwd());

let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed++; console.error(`✗ ${f}\n${e.stderr}`); }
}
console.log(`${files.length - failed}/${files.length} files OK`);

// Cache-busting: every local CSS/JS/font reference in the app pages carries ?v=<package version>,
// so phones never mix a cached old UI kit with a new app (the v0.3.0 "C.keyboard is not a function" crash).
const version = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
let stale = 0;
function expectVersion(file, url) {
  if (!url.includes(`?v=${version}`)) { stale++; console.error(`✗ ${file}: ${url} needs ?v=${version}`); }
}
for (const app of ['chat', 'browser', 'admin']) {
  const file = path.join('apps', app, 'public', 'index.html');
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|data:|\/\/)/.test(url) || !/\.(css|js|woff2)(\?|$)/.test(url)) continue;
    expectVersion(file, url);
  }
}
const uiCss = path.join('packages', 'ui', 'assets', 'colon-ui.css');
if (fs.existsSync(uiCss)) for (const m of fs.readFileSync(uiCss, 'utf8').matchAll(/url\((fonts\/[^)]+)\)/g)) expectVersion(uiCss, m[1]);
const core = path.join('packages', 'ui', 'assets', 'colon-app.js');
if (fs.existsSync(core) && !fs.readFileSync(core, 'utf8').includes(`version: '${version}'`)) { stale++; console.error(`✗ ${core}: Colon.version should be '${version}'`); }
console.log(stale ? `${stale} asset reference(s) not on v${version}` : `Asset versions OK (v${version})`);
failed += stale;
process.exit(failed ? 1 : 0);
