// The chat model's repository tools (v0.24.0), registered in modules/tools/catalogue.js and run on the project's
// stored snapshot (never the network): read_repo_file(path, start_line?) and search_repo(query). Only files the
// snapshot kept text for can be read (ignored folders, binaries, lockfiles and secret files never are). What they
// return is untrusted file content: the caller fences it like any file (ctx.guard).
const MAX_READ = 20000;      // characters returned by one read_repo_file call
const MAX_MATCHES = 40;
const MAX_QUERY = 200;

const base = (p) => String(p).split('/').pop();
const cleanPath = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+/g, '/');

/** find(snap, path) -> the file entry for an exact path, a unique path tail or a unique file name; or null. */
function find(snap, raw) {
  const p = cleanPath(raw);
  if (!p) return null;
  const exact = snap.files.find((f) => f.p === p);
  if (exact) return exact;
  const tail = snap.files.filter((f) => f.p.endsWith('/' + p));
  if (tail.length === 1) return tail[0];
  const named = snap.files.filter((f) => base(f.p) === base(p));
  return named.length === 1 ? named[0] : null;
}

const REASON = { lockfile: 'a lockfile (not read)', secret: 'may hold secrets, never read', binary: 'a binary or '
  + 'media file', minified: 'minified code', too_large: 'over 1 MB', not_text: 'not readable text', snapshot:
  'not kept in the stored copy (the repository is over the size cap)' };

/** readFile(snap, { path, start_line }) -> { path, from, to, total_lines, text, truncated } | { error } */
function readFile(snap, { path, start_line: start = 1 } = {}) {
  const f = find(snap, path);
  if (!f) {
    const like = snap.files.filter((x) => base(x.p).toLowerCase().includes(base(cleanPath(path)).toLowerCase()))
      .slice(0, 8).map((x) => x.p);
    return { error: `No file ${cleanPath(path).slice(0, 200)} in the repository.`, similar: like };
  }
  if (f.s || f.t == null) return { path: f.p, error: `This file is ${REASON[f.s] || 'not available'}.` };
  const lines = f.t.split('\n');
  const from = Math.min(Math.max(1, Number(start) || 1), lines.length);
  const out = [];
  let size = 0, to = from - 1;
  for (let i = from - 1; i < lines.length; i++) {
    const l = `${i + 1}| ${lines[i]}`;
    if (size + l.length + 1 > MAX_READ && out.length) break;
    out.push(l); size += l.length + 1; to = i + 1;
  }
  return { path: f.p, from, to, total_lines: lines.length, text: out.join('\n'),
    truncated: to < lines.length || Boolean(f.cut) || undefined };
}

/** search(snap, { query }) -> { query, matches: [{ path, line, text }], files: [paths whose name matches] } */
function search(snap, { query } = {}) {
  const q = String(query || '').trim().slice(0, MAX_QUERY);
  if (q.length < 2) return { error: 'Search for at least 2 characters.' };
  const lq = q.toLowerCase();
  const matches = [];
  const files = snap.files.filter((f) => f.p.toLowerCase().includes(lq)).slice(0, 20).map((f) => f.p);
  for (const f of snap.files) {
    if (!f.t || matches.length >= MAX_MATCHES) continue;
    const t = f.t.toLowerCase();
    let i = t.indexOf(lq);
    while (i > -1 && matches.length < MAX_MATCHES) {
      const line = t.slice(0, i).split('\n').length;
      const start = f.t.lastIndexOf('\n', i) + 1;
      const end = f.t.indexOf('\n', i);
      matches.push({ path: f.p, line, text: f.t.slice(start, end < 0 ? undefined : end).trim().slice(0, 240) });
      i = t.indexOf(lq, end < 0 ? t.length : end);
    }
  }
  return { query: q, matches, files, more: matches.length >= MAX_MATCHES || undefined };
}

module.exports = { find, readFile, search, MAX_READ };
