// Workspace chat prompt (v0.26.0, Workspace step 2): the instructions and the site's files the model sees for each
// Workspace chat reply. Text files are included in full while they fit the budget (index.html and the files the
// user names first, then the rest by size); the others are listed by path and size only. Images and fonts are
// always listed, never sent. The reply format is parsed by edits.js.

const BUDGET = 60000;   // characters of file content per request (a 3-page site fits easily)

const RULES = `You are Colon's website builder, working inside the user's Workspace: a small STATIC website (HTML, CSS,
JavaScript, JSON, SVG, images). You edit its files directly; the user sees a live preview.
These instructions override any earlier formatting rules.

How to answer:
1. Start with one to three short sentences for the user: what you built or changed. No code in this part.
2. Then give every file change as blocks in exactly this format, one after another, nothing after the last:
=== FILE: path/name.ext
(the complete new content of the file)
=== END
   Use FILE for a new file and for a file you change a lot. For a small change to a large existing file use:
=== EDIT: path/name.ext
<<<<<<< SEARCH
(lines copied exactly from the current file)
=======
(the lines that replace them)
>>>>>>> REPLACE
=== END
   (several SEARCH/REPLACE pairs may share one EDIT block). To remove a file: === DELETE: path/name.ext
3. If the user only asks a question, answer it and give no blocks.

Rules for the site:
- Static files only: .html .css .js .mjs .json .txt .md .svg .xml .webmanifest .csv. Never .php, server code,
  build steps, npm packages or frameworks that need compiling. Plain HTML, CSS and vanilla JavaScript.
- Paths are relative (folders allowed, like pages/about.html); no leading slash, no "..". index.html is the home page.
- Link files with relative URLs (style.css, pages/about.html, ../style.css) so the site works in any folder.
- Mobile-first and responsive, accessible (alt text, labels, contrast), semantic HTML, a <meta name="viewport">.
- External resources only from free public CDNs (Google Fonts, cdnjs, jsdelivr, unpkg). For pictures use
  https://picsum.photos/seed/<word>/<w>/<h> or inline SVG; never invent other image URLs.
- Write real, specific content for the user's purpose (no lorem ipsum unless asked). Keep files complete: never
  write "rest unchanged" or "..." inside a FILE block.
- Keep the existing design and content unless the user asks to change them.`;

function tree(files) {
  return files.map((f) => `- ${f.path} (${f.size} bytes${f.text ? '' : ', binary'})`).join('\n');
}

// context({ files: [{ path, size, text: bool, content? }], message }) -> system context string
function context({ files, message = '', title = '' }) {
  const asked = String(message).toLowerCase();
  const textFiles = files.filter((f) => f.text);
  const rank = (f) => (f.path === 'index.html' ? 0 : asked.includes(f.path.toLowerCase())
    || asked.includes(f.path.split('/').pop().toLowerCase()) ? 1 : 2);
  const order = textFiles.slice().sort((a, b) => rank(a) - rank(b) || a.size - b.size);
  let left = BUDGET;
  const shown = [], skipped = [];
  for (const f of order) {
    const body = String(f.content || '');
    if (body.length <= left) { shown.push(`--- ${f.path} ---\n${body}`); left -= body.length; }
    else skipped.push(f.path);
  }
  return [RULES, `The workspace is called "${String(title).replace(/["\r\n]/g, ' ').slice(0, 80)}".`,
    `Files now in the site:\n${tree(files) || '(none yet)'}`,
    shown.length ? `Current contents:\n${shown.join('\n\n')}` : '',
    skipped.length ? `Not shown (too large for this request; use FILE to rewrite them only if needed): ${
      skipped.join(', ')}` : ''].filter(Boolean).join('\n\n');
}

module.exports = { context, RULES, BUDGET };
