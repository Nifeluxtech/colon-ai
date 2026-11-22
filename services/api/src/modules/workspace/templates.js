// Workspace starter templates (v0.25.0, Workspace step 1). Each is a folder in ./starters/<id>/ holding a small
// static site (index.html, style.css, script.js). "{{TITLE}}" in a text file becomes the workspace's title
// (HTML-escaped). Files are read once and cached.
const fs = require('fs');
const path = require('path');

const TEMPLATES = [
  { id: 'blank', name: 'Blank', about: 'An empty page to start from' },
  { id: 'portfolio', name: 'Portfolio', about: 'Work, about and contact sections' },
  { id: 'business', name: 'Business', about: 'Services, about and contact for a company' },
  { id: 'landing', name: 'Landing page', about: 'A launch page with a waitlist form' },
];
const DIR = path.join(__dirname, 'starters');
const cache = new Map();

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  "'": '&#39;' }[c]));

function read(id) {
  if (cache.has(id)) return cache.get(id);
  const dir = path.join(DIR, id);
  const files = fs.readdirSync(dir).sort().map((name) => ({ path: name, text: fs.readFileSync(path.join(dir, name),
    'utf8') }));
  cache.set(id, files);
  return files;
}

const known = (id) => TEMPLATES.some((t) => t.id === id);

// -> [{ path, content: Buffer }] for a new workspace called `title`.
function filesFor(id, title) {
  const t = escHtml(title);
  return read(known(id) ? id : 'blank').map((f) => ({ path: f.path,
    content: Buffer.from(f.text.split('{{TITLE}}').join(t), 'utf8') }));
}

module.exports = { TEMPLATES, filesFor, known };
