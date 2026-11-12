#!/usr/bin/env node
// Finds broken repository links: relative Markdown links ([text](path#anchor)) in every .md file, and repo
// paths mentioned in text or code comments (docs/..., config/..., scripts/..., services/..., apps/...,
// packages/...) that no longer exist. Usage: node scripts/dev/linkcheck.js   (exits 1 on any broken link)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.git']);
const TEXT = /\.(md|js|sh|ya?ml|html|json)$/;
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const broken = [];
const exists = (p) => fs.existsSync(p);
// Repo-rooted paths named in prose or comments. Placeholders (<run>, *, {a,b}) are skipped.
const MENTION = /(?:^|[\s`'"(])((?:docs|config|scripts)\/[A-Za-z0-9_./-]*[A-Za-z0-9_])/g;

for (const f of walk(ROOT).filter((x) => TEXT.test(x))) {
  const r = rel(f);
  if (/^services\/api\/bench\/sets\//.test(r) || /fixtures\//.test(r)) continue;
  const text = fs.readFileSync(f, 'utf8');
  if (r.endsWith('.md')) {
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const abs = target.startsWith('/') ? path.join(ROOT, target) : path.resolve(path.dirname(f), target);
      if (!exists(abs)) broken.push(`${r}: link ${m[1]}`);
    }
  }
  for (const m of text.matchAll(MENTION)) {
    const p = m[1].replace(/[.]+$/, '');
    if (/[<>*{}]/.test(p)) continue;
    // docs/decisions/0002 is the short form for docs/decisions/0002-*.md
    if (/^docs\/decisions\/\d{4}$/.test(p)) {
      const dir = path.join(ROOT, 'docs', 'decisions');
      if (!fs.readdirSync(dir).some((n) => n.startsWith(p.slice(-4)))) broken.push(`${r}: mentions ${p}`);
      continue;
    }
    if (!/\.[a-z]{1,5}$/.test(p)) continue; // prose like "scripts/styles/iframes", or a directory
    // Repo-rooted, or relative to a package (a path named from inside services/api).
    let dir = path.dirname(f);
    let found = exists(path.join(ROOT, p));
    while (!found && dir.startsWith(ROOT) && dir !== ROOT) { found = exists(path.join(dir, p)); dir = path.dirname(dir); }
    if (!found) broken.push(`${r}: mentions ${p}`);
  }
}

if (broken.length) {
  console.error(broken.join('\n'));
  console.error(`\n${broken.length} broken link(s)`);
  process.exit(1);
}
console.log('Links: no broken repository links');
