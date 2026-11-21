// Developer mode: a .zip project archive becomes a stored "snapshot" at upload time (chat_attachments.text, JSON),
// so every later message in the conversation can rebuild the project context without unpacking the zip again.
// Safety: the shared safe ZIP reader refuses path traversal, absolute paths and zip bombs; ignored folders are
// only counted; binaries, lockfiles and secret files (.env, keys) are listed without their contents.
// v0.24.0: fromEntries() builds the same snapshot from any file list (a connected repository, modules/repos).
const extract = require('../extract');
const rules = require('./rules');
const gitignore = require('./gitignore');

const MAX_LISTED = 3000;          // files listed in the snapshot (the rest are counted)
const FILE_MAX = 200000;          // characters kept per file
const SNAPSHOT_MAX = 2000000;     // characters of file text kept per archive (MEDIUMTEXT holds 16 MB)
const READ_MAX = 1048576;         // bytes inflated per file

// Valid UTF-8 text without NUL bytes, or null.
function asText(buf) {
  if (!buf || buf.subarray(0, 8192).includes(0)) return null;
  const t = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const bad = (t.match(/\uFFFD/g) || []).length;
  if (bad > Math.max(4, t.length * 0.01)) return null;
  return t.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
}

// "my-app-main/src/x.js" for every entry → strip the single top folder GitHub-style downloads add.
function commonRoot(names) {
  if (!names.length) return '';
  const first = names[0].split('/');
  if (first.length < 2) return '';
  const root = first[0] + '/';
  return names.every((n) => n.startsWith(root) && n.length > root.length) ? root : '';
}

/**
 * fromZip(buf, name, opts) -> { text: JSON snapshot, meta }
 *   snapshot: { v: 1, kind: 'project', name, files: [{ p, n, t?, s?, cut? }], ignored: { count, dirs }, more }
 *     p path, n size in bytes, t text, s skip reason (rules.REASON_TEXT), cut: text shortened to FILE_MAX
 *   opts: see fromEntries
 */
function fromZip(buf, name = 'project.zip', opts = {}) {
  const list = extract.zip.entries(buf, { strict: true });
  extract.zip.assertSane(list);
  const entries = list.filter((e) => !e.dir).map((e) => ({ name: e.name, size: e.size,
    read: (max) => extract.zip.read(buf, e, max) }));
  return fromEntries(entries, name, opts);
}

/**
 * fromEntries(entries, name, { maxFiles, maxChars, fileMax, extra }) -> { text, meta }
 *   entries: [{ name (relative path), size, read(maxBytes) -> Buffer | null }] from a .zip or a fetched repository.
 *   The single top folder GitHub-style downloads add is stripped; the root .gitignore and .colonignore apply on top
 *   of the fixed ignore rules (v0.24.0). maxFiles / maxChars / fileMax: caps (repositories pass their config).
 *   extra: fields added to the snapshot (a repository's provider, branch and commit).
 */
function fromEntries(entries, name = 'project', o = {}) {
  const maxFiles = o.maxFiles || MAX_LISTED, maxChars = o.maxChars || SNAPSHOT_MAX, fileMax = o.fileMax || FILE_MAX;
  const root = commonRoot(entries.map((e) => e.name));
  const ignoreText = (file) => { const e = entries.find((x) => x.name === root + file);
    return e ? asText(e.read(65536)) || '' : ''; };
  const ignore = gitignore.compile(ignoreText('.gitignore'), ignoreText('.colonignore'));
  const files = [];
  const ignored = { count: 0, dirs: {} };
  let kept = 0, more = 0;
  for (const e of entries) {
    const p = e.name.slice(root.length);
    const fixed = rules.ignoredDir(p);
    if (fixed || (ignore && ignore(p))) {
      ignored.count++;
      const d = fixed ? p.split('/').find((x) => rules.IGNORE_DIRS.has(x)) : (p.includes('/') ? p.split('/')[0]
        : '.gitignore');
      ignored.dirs[d] = (ignored.dirs[d] || 0) + 1;
      continue;
    }
    if (files.length >= maxFiles) { more++; continue; }
    const f = { p, n: e.size };
    let reason = rules.skipReason(p, e.size);
    if (!reason) {
      const text = asText(e.read(READ_MAX));
      if (text == null) reason = 'not_text';
      else if (kept >= maxChars) reason = 'snapshot';
      else {
        const room = Math.min(fileMax, maxChars - kept);
        f.t = text.length > room ? text.slice(0, room) : text;
        if (text.length > room) f.cut = true;
        kept += f.t.length;
      }
    }
    if (reason) f.s = reason;
    files.push(f);
  }
  files.sort((a, b) => a.p.localeCompare(b.p));
  const snap = { v: 1, kind: 'project', name: String(name).slice(0, 180), files, ignored, more, ...(o.extra || {}) };
  return { text: JSON.stringify(snap), meta: summary(snap) };
}

// Upload metadata the app shows: file count, languages, ignored files.
function summary(snap) {
  const langs = {};
  for (const f of snap.files) { const l = rules.languageOf(f.p); if (l) langs[l] = (langs[l] || 0) + 1; }
  const top = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);
  const n = snap.files.length + (snap.more || 0);
  return { format: 'zip', files: n, languages: top, ignored: snap.ignored.count || undefined,
    note: `Project archive: ${n} file${n === 1 ? '' : 's'}${top.length ? ' (' + top.join(', ') + ')' : ''}.` };
}

// The stored snapshot, or null when the text is not one (an older or damaged row).
function parse(text) {
  if (!text || text[0] !== '{') return null;
  try {
    const s = JSON.parse(text);
    return s && s.kind === 'project' && Array.isArray(s.files) ? s : null;
  } catch { return null; }
}

module.exports = { fromZip, fromEntries, parse, summary, asText, commonRoot, MAX_LISTED, FILE_MAX, SNAPSHOT_MAX };
