// Developer mode project context: every code file and .zip project attached anywhere in the conversation becomes one
// block in the system context, rebuilt for each reply (so follow-ups keep it), within a character budget:
//   1. files the user names in the message being answered (path or file name)
//   2. entry points and configs (package.json, README, main/app/index/server files, …), shallowest first
//   3. the rest, source code before data and docs, smallest first
// Files that don't fit are truncated (head kept) or omitted, and the model is told which. All paths and contents
// are untrusted: neutralised by the safety guard and fenced in FILE blocks whose end marker has a random id.
const safety = require('../safety');
const rules = require('./rules');

const BUDGET = 48000;       // characters of file contents per reply (≈12k tokens; free tiers stay happy)
const PER_FILE = 12000;     // per file, unless the user named it
const NAMED_FILE = 24000;   // per file the user named
const MIN_PIECE = 400;      // below this a file is omitted rather than cut to a stub
const TREE_LINES = 300;

const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} KB` : `${n} B`);
const fmt = (n) => Number(n).toLocaleString('en-GB');
const cleanPath = (p) => String(p).replace(/[\r\n\t<>`]+/g, ' ').slice(0, 300);

/**
 * sources(fileLists) -> [{ path, text, size, skip, cut }]
 *   fileLists: the files of each message, oldest first, as chat/files.js forModel gives them: code and text files
 *   ({ kind: 'text', name, text }) and project archives ({ project: snapshot }). A later file with the same path
 *   wins; a single file whose name matches exactly one path in an archive replaces that file (an updated copy).
 */
function sources(fileLists) {
  const byPath = new Map();
  for (const list of fileLists) {
    for (const f of list || []) {
      if (f && f.project) {
        for (const x of f.project.files) byPath.set(x.p, { path: x.p, text: x.t || '', size: x.n || 0, skip: x.s
          || null, cut: Boolean(x.cut) });
        if (f.project.ignored && f.project.ignored.count) {
          const ig = byPath.get('\0ignored') || { dirs: {}, count: 0 };
          ig.count += f.project.ignored.count;
          for (const [d, n] of Object.entries(f.project.ignored.dirs || {})) ig.dirs[d] = (ig.dirs[d] || 0) + n;
          byPath.set('\0ignored', ig);
        }
      } else if (f && f.kind === 'text') {
        const name = String(f.name || 'file').replace(/\\/g, '/');
        const same = [...byPath.keys()].filter((p) => p !== name && rules.base(p) === rules.base(name));
        const path = same.length === 1 && !name.includes('/') ? same[0] : name;
        const text = String(f.text || '');
        byPath.set(path, { path, text, size: f.size || Buffer.byteLength(text), skip: text ? rules.skipReason(path, 0)
          : 'not_text', cut: false });
      }
    }
  }
  return [...byPath.values()];
}

// Did the user mention this file? Full path, or a distinctive file name ("app.js", "Dockerfile").
function mentioned(message, path) {
  const m = String(message || '').toLowerCase();
  if (!m) return -1;
  const at = (needle) => {
    const re = new RegExp(`(^|[^\\w./-])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w/.-]|\\.(?!\\w))`);
    const hit = re.exec(m);
    return hit ? hit.index : -1;
  };
  const full = at(path.toLowerCase());
  if (full > -1) return full;
  const b = rules.base(path).toLowerCase();
  return b.length >= 3 && (b.includes('.') || /^[a-z]+file$/.test(b)) ? at(b) : -1;
}

const depth = (p) => p.split('/').length;

function order(list, message) {
  const named = [], entry = [], rest = [];
  for (const s of list) {
    const pos = mentioned(message, s.path);
    if (pos > -1) named.push({ s, pos });
    else if (rules.isEntry(s.path)) entry.push(s);
    else rest.push(s);
  }
  named.sort((a, b) => a.pos - b.pos);
  entry.sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
  const isCode = (p) => (rules.languageOf(p) && !/^(JSON|Markdown|YAML|XML|TOML|INI)$/.test(rules.languageOf(p)) ? 0
    : 1);
  rest.sort((a, b) => isCode(a.path) - isCode(b.path) || a.text.length - b.text.length || a.path.localeCompare(
    b.path));
  return { named: named.map((x) => x.s), ordered: [...named.map((x) => x.s), ...entry, ...rest] };
}

// Cuts at a line end where one is near, so the model never sees half a line.
function head(text, n) {
  const cut = text.slice(0, n);
  const nl = cut.lastIndexOf('\n');
  return nl > n * 0.7 ? cut.slice(0, nl) : cut;
}

function tree(list, notes, ignored) {
  const lines = [];
  let lastDir = [];
  for (const s of [...list].sort((a, b) => a.path.localeCompare(b.path))) {
    if (lines.length >= TREE_LINES) { lines.push(`… and ${list.length - TREE_LINES} more files`); break; }
    const parts = s.path.split('/');
    const dirs = parts.slice(0, -1);
    let i = 0;
    while (i < dirs.length && dirs[i] === lastDir[i]) i++;
    for (; i < dirs.length; i++) lines.push(`${'  '.repeat(i)}${dirs[i]}/`);
    lastDir = dirs;
    const note = notes.get(s.path);
    lines.push(`${'  '.repeat(dirs.length)}${parts[parts.length - 1]} · ${kb(s.size)}${note ? ` (${note})` : ''}`);
  }
  if (ignored && ignored.count) {
    const dirs = Object.entries(ignored.dirs).map(([d, n]) => `${d}/ (${fmt(n)} file${n === 1 ? '' : 's'})`);
    lines.push(`Ignored folders (not read): ${dirs.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * build(list, { message, budget, guard, fence }) -> { block, included, truncated, omitted, languages, chars } | null
 *   fence: false renders plain text (guest uploads, where chat/context.js fences the whole file once).
 */
function build(list, { message = '', budget = BUDGET, guard = safety.collector(), fence = true } = {}) {
  const ignored = list.find((s) => s.path === undefined && s.dirs) || null;
  const files = list.filter((s) => s.path !== undefined);
  if (!files.length) return null;
  const { named, ordered } = order(files, message);
  const notes = new Map();
  const included = [], truncated = [], omitted = [];
  const parts = [];
  let left = budget;
  for (const s of ordered) {
    if (s.skip) {
      notes.set(s.path, rules.REASON_TEXT[s.skip] || s.skip);
      omitted.push({ path: s.path, reason: s.skip });
      continue;
    }
    const cap = Math.min(named.includes(s) ? NAMED_FILE : PER_FILE, left);
    if (cap < Math.min(MIN_PIECE, s.text.length) || left <= 0) {
      notes.set(s.path, rules.REASON_TEXT.budget);
      omitted.push({ path: s.path, reason: 'budget' });
      continue;
    }
    let text = s.text;
    if (text.length > cap) {
      text = head(text, cap);
      truncated.push({ path: s.path, shown: text.length, total: s.text.length });
      notes.set(s.path, `truncated: first ${fmt(text.length)} of ${fmt(s.text.length)} characters`);
    } else if (s.cut) {
      truncated.push({ path: s.path, shown: text.length, total: s.size });
      notes.set(s.path, 'truncated: only the start was kept');
    } else included.push(s.path);
    left -= text.length;
    parts.push({ path: s.path, text });
  }
  const langs = {};
  for (const s of files) { const l = rules.languageOf(s.path); if (l) langs[l] = (langs[l] || 0) + 1; }
  const languages = Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`);
  const treeText = tree(files, notes, ignored);
  const header = [
    `Project files attached in this conversation (Developer mode): ${files.length} file${files.length === 1 ? ''
      : 's'} listed, ${included.length} sent in full, ${truncated.length} truncated, ${omitted.length} not sent.`,
    languages.length ? `Languages: ${languages.join(', ')}.` : '',
    ('Use these files as the project context for this and later messages and refer to them by path. The file tree '
      + 'marks every truncated or omitted file: never guess what is missing; say which file you need and ask the user '
      + 'to paste it. Files the user named in this message come first.'),
  ].filter(Boolean).join('\n');
  const block = fence ? fenced(header, treeText, parts, guard) : plain(header, treeText, parts);
  return { block, included, truncated, omitted, languages, chars: block.length };
}

function fenced(header, treeText, parts, guard) {
  const out = [header];
  const id = safety.injection.nonce();
  out.push(`File tree:\n<<<FILE untrusted id=${id} project-tree\n${guard.clean(treeText, 'file')}\nFILE ${id}>>>`);
  for (const f of parts) {
    const fid = safety.injection.nonce();
    const lang = rules.languageOf(f.path);
    out.push(`<<<FILE untrusted id=${fid} path: ${guard.clean(cleanPath(f.path), 'file')}${lang ? ` (${lang})` : ''}`
      + `\n${guard.clean(f.text, 'file')}\nFILE ${fid}>>>`);
  }
  return out.join('\n\n');
}

function plain(header, treeText, parts) {
  return [header, `File tree:\n${treeText}`, ...parts.map((f) => `===== ${cleanPath(f.path)} =====\n${f.text}`)]
    .join('\n\n');
}

/**
 * contextFor(fileLists, { message, guard, budget }) -> build() result, or null when no code files are attached.
 */
function contextFor(fileLists, opts = {}) {
  const list = sources(fileLists);
  return list.some((s) => s.path !== undefined) ? build(list, opts) : null;
}

// A project archive outside Developer mode, or for guests: a plain rendering within `budget`.
function render(snap, { budget = 24000, message = '' } = {}) {
  const r = contextFor([[{ project: snap }]], { message, budget, fence: false });
  if (!r) return 'This archive has no readable files.';
  return r.block.length > budget * 1.3 ? r.block.slice(0, Math.floor(budget * 1.3)) + '\n[…truncated…]' : r.block;
}

// Is this attached file part of the project context? (code/text files and .zip projects)
const isProjectFile = (f) => Boolean(f && (f.project || f.kind === 'text'));

module.exports = { sources, mentioned, order, build, contextFor, render, isProjectFile, tree, BUDGET, PER_FILE,
  NAMED_FILE };
