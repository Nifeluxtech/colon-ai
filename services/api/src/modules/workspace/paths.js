// Workspace file rules (v0.25.0, Workspace step 1): which paths and file types a website workspace may hold.
// v1 sites are static (docs/workspace/plan.md): HTML, CSS, JS, data, images and fonts. Nothing that a server would
// run (.php, .cgi, .htaccess…) is ever accepted, and paths can't climb out of the workspace.
const TEXT = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', txt: 'text/plain', md: 'text/markdown', svg: 'image/svg+xml', xml: 'application/xml',
  webmanifest: 'application/manifest+json', csv: 'text/csv',
};
const BINARY = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', avif: 'image/avif', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};
const LIMITS = {
  workspaces: 20,          // per user (plan quotas arrive in step 5)
  files: 200,              // per workspace
  textBytes: 512 * 1024,   // one text file
  fileBytes: 1024 * 1024,  // one image or font
  totalBytes: 4 * 1024 * 1024, // all files in a workspace
  pathChars: 200,
  depth: 6,
  versions: 20,            // newest snapshots kept
};
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
// v0.31.0: an empty folder is kept as <folder>/.gitkeep (the IDE's New folder; Git keeps it too)
const KEEP = '.gitkeep';

const bad = (message) => Object.assign(new Error(message), { status: 422, code: 'invalid', field: 'path' });

// -> the clean path ("css/site.css"), or throws 422. Leading "/" and "./" are dropped; "\" counts as "/".
function cleanPath(v) {
  let p = String(v == null ? '' : v).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  p = p.replace(/\/{2,}/g, '/');
  if (!p) throw bad('Give the file a name, like index.html.');
  if (p.length > LIMITS.pathChars) throw bad(`File paths can be up to ${LIMITS.pathChars} characters.`);
  const parts = p.split('/');
  if (parts.length > LIMITS.depth) throw bad(`Folders can be up to ${LIMITS.depth - 1} levels deep.`);
  for (const [i, s] of parts.entries()) {
    if (s === '..' || s === '.') throw bad('File paths can’t contain “..”.');
    if (s === KEEP && i === parts.length - 1 && i > 0) continue;
    if (!SEGMENT.test(s)) {
      throw bad(`“${s}” isn’t allowed. Use letters, numbers, dots, dashes and underscores, not starting with a dot.`);
    }
  }
  if (!typeOf(p)) throw bad(`“.${ext(p) || '(none)'}” files aren’t supported. Websites here are static: HTML, CSS, `
    + 'JS, JSON, text, images and fonts.');
  return p;
}

function ext(p) { const m = /\.([A-Za-z0-9]+)$/.exec(String(p)); return m ? m[1].toLowerCase() : ''; }

// -> { mime, text: bool } or null when the type isn't allowed.
function typeOf(p) {
  if (String(p).split('/').pop() === KEEP) return { mime: 'text/plain', text: true };
  const e = ext(p);
  if (TEXT[e]) return { mime: TEXT[e], text: true };
  if (BINARY[e]) return { mime: BINARY[e], text: false };
  return null;
}

// body { content, encoding: 'utf8' | 'base64' } -> Buffer, checked against the size limits for its type.
function contentBuffer(path, content, encoding) {
  const t = typeOf(path);
  if (typeof content !== 'string') throw Object.assign(bad('Send the file content as a string.'), { field: 'content' });
  const enc = encoding === 'base64' ? 'base64' : 'utf8';
  if (!t.text && enc !== 'base64') {
    throw Object.assign(bad('Send images and fonts base64-encoded.'), { field: 'encoding' });
  }
  const buf = Buffer.from(content, enc);
  const max = t.text ? LIMITS.textBytes : LIMITS.fileBytes;
  if (buf.length > max) {
    throw Object.assign(new Error(`That file is over ${Math.round(max / 1024)} KB.`), { status: 413,
      code: 'too_large', field: 'content' });
  }
  return buf;
}

module.exports = { cleanPath, typeOf, contentBuffer, LIMITS, TEXT, BINARY, KEEP };
