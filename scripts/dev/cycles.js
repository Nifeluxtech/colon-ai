#!/usr/bin/env node
// Lists import cycles among the frontend ES modules (apps/*/src and packages/ui/js). Cycles are legal in ES
// modules and work here because no module reads an imported binding while it is first evaluated (only inside
// functions called later). This tool shows where that rule matters. Usage: node scripts/dev/cycles.js [--strict]
// (--strict exits 1 when any cycle exists).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['apps/chat/src', 'apps/browser/src', 'apps/admin/src', 'packages/ui/js'].map((d) => path.join(ROOT, d));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const graph = new Map();
for (const f of DIRS.flatMap((d) => walk(d))) {
  const src = fs.readFileSync(f, 'utf8');
  const deps = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?(?:from\s*)?(['"])(\.[^'"]+)\1/gm)) {
    deps.push(path.resolve(path.dirname(f), m[2]));
  }
  graph.set(f, deps);
}

// Tarjan's strongly connected components: every component with more than one module is a cycle group.
let index = 0;
const idx = new Map(), low = new Map(), stack = [], on = new Set(), groups = [];
function visit(v) {
  idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
  for (const w of graph.get(v) || []) {
    if (!graph.has(w)) continue;
    if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
  }
  if (low.get(v) === idx.get(v)) {
    const g = [];
    let w;
    do { w = stack.pop(); on.delete(w); g.push(w); } while (w !== v);
    if (g.length > 1 || (graph.get(v) || []).includes(v)) groups.push(g);
  }
}
for (const v of graph.keys()) if (!idx.has(v)) visit(v);

console.log(`${graph.size} modules, ${groups.length} cycle group(s)`);
groups.forEach((g, i) => console.log(`\n#${i + 1} (${g.length} modules)\n  ` + g.map(rel).sort().join('\n  ')));
if (groups.length && process.argv.includes('--strict')) process.exit(1);
