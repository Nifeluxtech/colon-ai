// Download as ZIP (v0.31.0): every file of a workspace, with its folders, in one .zip (zip.js, no dependency).
//   exportZip(u, id)  -> { name: '<site>-v<version>.zip', folder, buffer, files, bytes }; owner only (owned() answers
//                        404 for anyone else's workspace). Inside, everything sits in one folder named after the site.
//   Empty folders are kept (their .gitkeep file and a folder entry). Nothing secret is in it: the Data tab's secret
//   keys, server keys and tokens live in their own tables, never in the files, and SECRET_FILE skips a stray
//   .env / key file defensively (paths.js doesn't accept those names today).
// The Workspace chat (chat.js) uses wants() / stripMark() / line(): when the user asks for their files as a zip (or
// the model adds "=== EXPORT: zip" to its note), the reply carries a "=== EXPORT: zip -- <files>, <size>" line that
// the app shows as a Download ZIP card (apps/chat/src/lib/ws-needs.js).
const { zip } = require('./zip');

const SECRET_FILE = /(^|\/)(\.env(\.[\w.-]*)?|[^/]*\.(pem|key|p12|pfx)|id_rsa[^/]*|\.npmrc|\.netrc)$/i;
const MARK = /^\s*===\s*EXPORT\s*:\s*zip\b.*$/gim;
const ASK_ZIP = new RegExp('\\b(as|in|into|to)\\s+(a\\s+)?zip\\b|\\bzip\\s+(file|archive|it|them|everything|all|my|'
  + 'the)\\b|\\.zip\\b|\\bzipped\\b', 'i');
const ASK_EXPORT = new RegExp('\\b(export|download|back ?up)\\s+(all\\s+)?(of\\s+)?(my|the|our|these|this)?\\s*'
  + '(files|project|code|workspace|site files|website files|source|everything)\\b', 'i');
// "add a download button / link / page for the files" is a site feature, not an export
const FEATURE = /\b(button|link|page|feature|section|form|field|code field)\b/i;
const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function slug(title) {
  return String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'site';
}

function createExporter({ store, owned }) {
  async function exportZip(u, id) {
    const w = await owned(u, id);
    const all = (await store.allFiles(w.id)).filter((f) => !SECRET_FILE.test(f.path));
    const folder = slug(w.title), version = Number(w.version) || 0;
    const entries = all.map((f) => ({ path: `${folder}/${f.path}`, content: Buffer.from(f.content),
      date: f.updated_at ? new Date(f.updated_at) : undefined }));
    const buffer = zip(entries);
    return { name: `${folder}-v${version}.zip`, folder, buffer,
      files: all.filter((f) => !/(^|\/)\.gitkeep$/.test(f.path)).length,
      bytes: all.reduce((n, f) => n + Buffer.from(f.content).length, 0) };
  }
  return { exportZip };
}

/** The user's message asks for the files as a zip / an export (not a zip code, not a download button). */
function wants(text) {
  const t = String(text || '');
  if (/\bzip\s*code/i.test(t)) return false;
  return ASK_ZIP.test(t) || (ASK_EXPORT.test(t) && !FEATURE.test(t));
}
/** text -> { text without "=== EXPORT: zip" lines, marked: bool } */
function stripMark(text) {
  let marked = false;
  const out = String(text || '').replace(MARK, () => { marked = true; return ''; });
  return { text: marked ? out.replace(/\n{3,}/g, '\n\n').trim() : out, marked };
}
/** { files, bytes } -> the note line the app turns into a Download ZIP card */
const line = (x) => `=== EXPORT: zip -- ${x.files} file${x.files === 1 ? '' : 's'}, ${kb(x.bytes)}`;

module.exports = { createExporter, wants, stripMark, line, slug, SECRET_FILE };
