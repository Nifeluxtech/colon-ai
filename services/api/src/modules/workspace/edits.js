// Workspace chat edits (v0.26.0, Workspace step 2). The model answers with a short note to the user followed by
// file blocks in this plain-text format (see prompt.js), which parse() turns into operations:
//
//   === FILE: path            whole new content of the file, up to "=== END"     -> { op: 'write', path, content }
//   === EDIT: path            one or more SEARCH/REPLACE blocks, up to "=== END"  -> { op: 'edit', path, blocks }
//     <<<<<<< SEARCH / ======= / >>>>>>> REPLACE
//   === DELETE: path          remove the file (no END line)                       -> { op: 'delete', path }
//
// Code fences the model wraps around a file's content are dropped. Paths are checked later by paths.cleanPath.
// applyEdit() applies SEARCH/REPLACE blocks to a file's text: exact match first, then a match that ignores each
// line's leading and trailing spaces. A block that matches nowhere fails the whole edit (nothing half-applied).

const HEAD = /^===\s*(FILE|EDIT|DELETE)\s*:\s*(.+?)\s*$/i;
const END = /^===\s*END\s*===?\s*$|^===\s*END\s*$/i;
const FENCE = /^\s*```[\w-]*\s*$/;
const MAX_NOTE = 2000;

function stripFences(lines) {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  if (b - a >= 2 && FENCE.test(lines[a]) && FENCE.test(lines[b - 1])) { a++; b--; }
  return lines.slice(a, b);
}

function parseBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^<{5,}\s*SEARCH\s*$/i.test(lines[i].trim())) { i++; continue; }
    const search = [], replace = [];
    i++;
    while (i < lines.length && !/^={5,}\s*$/.test(lines[i].trim())) search.push(lines[i++]);
    i++;
    while (i < lines.length && !/^>{5,}\s*REPLACE\s*$/i.test(lines[i].trim())) replace.push(lines[i++]);
    i++;
    blocks.push({ search: search.join('\n'), replace: replace.join('\n') });
  }
  return blocks;
}

// parse(text) -> { note, ops[] }
function parse(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const note = [], ops = [];
  let i = 0;
  while (i < lines.length) {
    const m = HEAD.exec(lines[i].trim());
    if (!m) { note.push(lines[i++]); continue; }
    const kind = m[1].toUpperCase(), path = m[2].replace(/^[`'"]+|[`'"]+$/g, '');
    i++;
    if (kind === 'DELETE') { ops.push({ op: 'delete', path }); continue; }
    const body = [];
    while (i < lines.length && !END.test(lines[i].trim()) && !HEAD.test(lines[i].trim())) body.push(lines[i++]);
    if (i < lines.length && END.test(lines[i].trim())) i++;
    if (kind === 'FILE') {
      const content = stripFences(body).join('\n');
      ops.push({ op: 'write', path, content: content ? content + '\n' : '' });
    } else {
      const blocks = parseBlocks(body);
      if (blocks.length) ops.push({ op: 'edit', path, blocks });
    }
  }
  const clean = stripFences(note).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { note: clean.length > MAX_NOTE ? clean.slice(0, MAX_NOTE) + '…' : clean, ops };
}

// Finds `search` in `text` ignoring each line's outer spaces; returns [start, end] character offsets or null.
function looseFind(text, search) {
  const want = search.split('\n').map((l) => l.trim());
  while (want.length && !want[want.length - 1]) want.pop();
  while (want.length && !want[0]) want.shift();
  if (!want.length) return null;
  const lines = text.split('\n');
  const starts = [];
  let pos = 0;
  for (const l of lines) { starts.push(pos); pos += l.length + 1; }
  for (let i = 0; i + want.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j++) ok = lines[i + j].trim() === want[j];
    if (ok) {
      const last = i + want.length - 1;
      return [starts[i], starts[last] + lines[last].length];
    }
  }
  return null;
}

// applyEdit(text, blocks) -> new text; throws { code: 'edit_failed' } when a SEARCH block isn't in the file.
function applyEdit(text, blocks) {
  let out = String(text);
  for (const b of blocks) {
    if (!b.search.trim()) { out = out.replace(/\n?$/, '\n') + b.replace + '\n'; continue; }   // empty SEARCH: append
    const at = out.indexOf(b.search);
    if (at > -1) { out = out.slice(0, at) + b.replace + out.slice(at + b.search.length); continue; }
    const loose = looseFind(out, b.search);
    if (!loose) {
      throw Object.assign(new Error('A change didn’t match the file.'), { code: 'edit_failed',
        search: b.search.slice(0, 200) });
    }
    out = out.slice(0, loose[0]) + b.replace + out.slice(loose[1]);
  }
  return out;
}

module.exports = { parse, applyEdit, looseFind };
