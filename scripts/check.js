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
process.exit(failed ? 1 : 0);
