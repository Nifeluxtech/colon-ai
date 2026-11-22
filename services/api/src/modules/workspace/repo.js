// Workspace + repositories (v0.27.3). From the chat box's + menu:
//   clone(u, id, { url })  copies a repository's website files into the workspace as ONE version (replacing what
//                          was there, so the chat's Undo brings the old files back). A site kept in public/, docs/,
//                          dist/, build/, site/, www/, _site/ or out/ is taken from that folder.
//   learn(u, id, { url })  reads the repository's key files (README, pages, styles, scripts) into ~40 KB of text that
//                          every build then sees as a reference; nothing is copied unless the user asks.
//   forget(u, id)          stops learning from it.
// GitHub repositories come as a zip from codeload.github.com (no git needed on the server); any other https Git
// address is a shallow clone. Both reuse the Projects repository code (SSRF-guarded, size-capped). Public
// repositories only. Each action leaves a note in the chat.
const extract = require('../extract');
const { commonRoot } = require('../developer').snapshot;
const paths = require('./paths');
const { LIMITS } = paths;

const SKIP = /(^|\/)(node_modules|\.git|vendor|bower_components|\.next|\.cache|coverage|__pycache__)(\/|$)/;
const SITE_ROOTS = ['', 'public/', 'docs/', 'dist/', 'build/', 'site/', 'www/', '_site/', 'out/'];
const LEARN_TEXT = /\.(html?|css|scss|js|mjs|jsx|ts|tsx|vue|svelte|json|md|txt)$/i;
const LEARN_BUDGET = 40000, LEARN_FILE = 8000;
const err = (status, code, message) => Object.assign(new Error(message), { status, code });

// "owner/name", a github.com page (…/tree/branch too) or any https Git address -> { kind, url, label, … }
function source(raw, providers) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) throw err(422, 'invalid', 'Paste a repository link, like https://github.com/owner/name.');
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  let u;
  try { u = new URL(short ? `https://github.com/${s}` : s); } catch {
    throw err(422, 'invalid', 'That doesn’t look like a repository link.');
  }
  if (u.hostname.toLowerCase().replace(/^www\./, '') === 'github.com') {
    const parts = u.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parts.length < 2 || !parts.slice(0, 2).every((p) => /^[\w.-]+$/.test(p))) {
      throw err(422, 'invalid', 'Use a GitHub link like https://github.com/owner/name.');
    }
    const [owner, name] = parts;
    const branch = parts[2] === 'tree' && parts[3] ? decodeURIComponent(parts.slice(3).join('/')) : null;
    if (branch && !/^[\w./-]{1,200}$/.test(branch)) throw err(422, 'invalid', 'That branch name isn’t supported.');
    return { kind: 'github', owner, name, branch, url: `https://github.com/${owner}/${name}`,
      label: `${owner}/${name}` };
  }
  const g = providers.parseGitUrl(s);
  return { kind: 'git', url: g.url, label: `${g.owner}/${g.name}`, branch: null };
}

const stripRoot = (entries) => {
  const root = commonRoot(entries.map((e) => e.name));
  return root ? entries.map((e) => ({ ...e, name: e.name.slice(root.length) })) : entries;
};

// -> { entries: [{ name, size, read(max) }], cleanup() }
async function fetchEntries(src, { download, git, cfg, net = {}, exec }) {
  if (src.kind === 'github') {
    const ref = src.branch ? `refs/heads/${src.branch}` : 'HEAD';
    const r = await download.get(`https://codeload.github.com/${src.owner}/${src.name}/zip/${ref}`,
      { ...net, maxBytes: cfg.archiveMaxMb * 1048576, timeoutMs: cfg.timeoutMs });
    if (r.status === 404) {
      throw err(422, 'repo_not_found', 'That repository or branch wasn’t found. Only public repositories work here.');
    }
    if (r.status !== 200) throw err(502, 'repo_unreachable', 'GitHub didn’t send the repository. Try again soon.');
    const list = extract.zip.entries(r.buf, { strict: true });
    extract.zip.assertSane(list);
    const files = list.filter((e) => !e.dir).map((e) => ({ name: e.name, size: e.size,
      read: (max) => extract.zip.read(r.buf, e, max) }));
    return { entries: stripRoot(files), cleanup: async () => {} };
  }
  const c = await git.clone({ url: src.url, branch: src.branch, lookup: net.lookup, exec, cfg });
  try { return { entries: await git.walk(c.dir), cleanup: c.cleanup }; } catch (e) { await c.cleanup(); throw e; }
}

// The website part of a repository -> { root, files: [{ path, content }], skipped }
function siteFiles(entries) {
  const usable = entries.filter((e) => !SKIP.test(e.name));
  const root = SITE_ROOTS.find((r) => usable.some((e) => e.name === `${r}index.html`)) || '';
  const files = [];
  let skipped = 0, total = 0;
  for (const e of usable) {
    if (!e.name.startsWith(root)) continue;
    let p;
    try { p = paths.cleanPath(e.name.slice(root.length)); } catch { skipped += 1; continue; }
    const max = paths.typeOf(p).text ? LIMITS.textBytes : LIMITS.fileBytes;
    const fits = e.size <= max && files.length < LIMITS.files && total + e.size <= LIMITS.totalBytes;
    const buf = fits ? e.read(max) : null;
    if (!buf) { skipped += 1; continue; }
    files.push({ path: p, content: buf }); total += buf.length;
  }
  return { root, files, skipped };
}

// The key files of a repository as reference text -> { text, files }
function learnText(entries, label) {
  const usable = entries.filter((e) => !SKIP.test(e.name) && !/(^|\/)\./.test(e.name));
  const rank = (n) => (/^readme/i.test(n) ? 0 : /(^|\/)index\.html?$/i.test(n) ? 1 : n === 'package.json' ? 2
    : /\.(html?|css|scss)$/i.test(n) ? 3 : /\.(js|mjs|jsx|ts|tsx|vue|svelte)$/i.test(n) ? 4 : 5);
  const order = usable.filter((e) => LEARN_TEXT.test(e.name) && !/\.min\.|lock\.json$/i.test(e.name))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.split('/').length - b.name.split('/').length
      || a.size - b.size);
  const parts = [];
  let left = LEARN_BUDGET;
  for (const e of order) {
    if (left < 500) break;
    const buf = e.read(LEARN_FILE * 4);
    if (!buf) continue;
    let t = buf.toString('utf8');
    if (t.includes('\u0000')) continue;
    if (t.length > Math.min(LEARN_FILE, left)) t = `${t.slice(0, Math.min(LEARN_FILE, left))}\n… (cut)`;
    parts.push(`--- ${e.name} ---\n${t}`); left -= t.length;
  }
  const tree = usable.slice(0, 150).map((e) => e.name).join('\n');
  return { text: `Repository ${label}\nFiles:\n${tree}${usable.length > 150 ? '\n…' : ''}\n\n${parts.join('\n\n')}`,
    files: parts.length };
}

function createRepo({ engine, deps = {} }) {
  const store = engine.store;
  const lib = () => ({ download: deps.download || require('../repos').download, git: deps.git
    || require('../repos').git, providers: deps.providers || require('../repos').providers,
  cfg: deps.cfg || require('../../config').repos, net: deps.net || {}, exec: deps.exec });
  async function load(u, id, body) {
    const w = await engine.owned(u, id);
    const L = lib();
    if (L.cfg && L.cfg.enabled === false) throw err(501, 'repos_off', 'Using repositories is switched off.');
    const src = source(body && body.url, L.providers);
    return { w, src, got: await fetchEntries(src, L) };
  }
  const note = (w, m) => store.addMessage(w.id, { kind: 'done', ...m });

  async function clone(u, id, body = {}) {
    const { w, src, got } = await load(u, id, body);
    let site;
    try { site = siteFiles(got.entries); } finally { await got.cleanup(); }
    if (!site.files.some((f) => paths.typeOf(f.path).text)) {
      throw err(422, 'no_site', `${src.label} has no website files Colon can use (HTML, CSS, JS, images, fonts).`);
    }
    const r = await engine.importFiles(u, id, site.files, `Cloned ${src.label}`);
    await note(w, { role: 'user', content: `Clone ${src.url}` });
    await note(w, { role: 'assistant', content: `Cloned ${src.label}${site.root ? ` (from its ${site.root} folder)`
      : ''}: ${site.files.length} file${site.files.length === 1 ? '' : 's'}${site.skipped ? `; skipped ${site.skipped}`
      + ' that aren’t website files or are too big' : ''}.`, changes: r.changes, version_before: r.before,
    version_after: r.version });
    return { cloned: site.files.length, skipped: site.skipped, version: r.version };
  }

  async function learn(u, id, body = {}) {
    const { w, src, got } = await load(u, id, body);
    let ref;
    try { ref = learnText(got.entries, src.label); } finally { await got.cleanup(); }
    if (!ref.files) throw err(422, 'no_text', `Colon couldn’t find readable code in ${src.label}.`);
    await store.update(u.id, w.id, { ref_url: src.url, ref_text: ref.text, ref_files: ref.files });
    await note(w, { role: 'user', content: `Learn from ${src.url}` });
    await note(w, { role: 'assistant', content: `I studied ${src.label} (${ref.files} key files). I’ll follow its `
      + 'structure and style when I build. Ask me to copy something from it whenever you want.' });
    return { reference: { url: src.url, files: ref.files } };
  }

  async function forget(u, id) {
    const w = await engine.owned(u, id);
    await store.update(u.id, w.id, { ref_url: null, ref_text: null, ref_files: null });
    return { reference: null };
  }
  return { clone, learn, forget };
}

module.exports = { createRepo, source, siteFiles, learnText };
