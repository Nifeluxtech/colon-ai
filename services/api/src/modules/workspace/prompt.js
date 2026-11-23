// Workspace chat prompt (v0.26.0, Workspace step 2): the instructions and the site's files the model sees for each
// Workspace chat reply. Text files are included in full while they fit the budget (index.html and the files the
// user names first, then the rest by size); the others are listed by path and size only. Images and fonts are
// always listed, never sent. The reply format is parsed by edits.js.

const { recipe } = require('./connect');

const REF_BUDGET = 12000;   // v0.31.3: characters of a linked repository per build (was all 40 KB)
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
4. If the user asks to export, download or back up their files (for example as a zip), add this line to your note:
=== EXPORT: zip
   Colon packs every file and folder into a .zip and shows the user a Download ZIP button. Don't write the zip
   yourself, and don't change files unless they also asked for changes.

Rules for the site:
- Static files only: .html .css .js .mjs .json .txt .md .svg .xml .webmanifest .csv. Never .php, server code,
  build steps or frameworks that need compiling. Plain HTML, CSS and vanilla JavaScript.
- npm packages listed in package.json "dependencies" (the user adds them with npm install in the Terminal) can be
  imported by bare name inside <script type="module"> (import { x } from 'name'); Colon adds the import map
  (esm.sh). Don't write your own import map for them. Add a package yourself by adding it to "dependencies".
- Paths are relative (folders allowed, like pages/about.html); no leading slash, no "..". index.html is the home page.
  Keep a tidy folder structure for bigger sites (css/, js/, images/, pages/).
- Link files with relative URLs (style.css, pages/about.html, ../style.css) so the site works in any folder.
- Mobile-first and responsive, accessible (alt text, labels, contrast), semantic HTML, a <meta name="viewport">.
- External resources only from free public CDNs (Google Fonts, cdnjs, jsdelivr, unpkg). For pictures use
  https://picsum.photos/seed/<word>/<w>/<h> or inline SVG; never invent other image URLs.
- Write real, specific content for the user's purpose (no lorem ipsum unless asked). Keep files complete: never
  write "rest unchanged" or "..." inside a FILE block.
- Keep the existing design and content unless the user asks to change them.
- To save data (orders, sign-ups, messages) or use an API key, use Colon's database and keys (described below).`;

// v0.29.0 (step 5): the site's database and keys, and how to ask the user for one it doesn't have yet.
function dataRules(d) {
  const script = `${d.api}/sites/${d.key}/colon.js`;
  const tables = d.collections.length ? d.collections.map((c) => `- ${c.name} (visitors can read: ${
    c.read === 'public' ? 'yes' : 'no'}, visitors can add: ${c.add === 'public' ? 'yes' : 'no'}, ${c.records} records)`)
    .join('\n') : '(none yet)';
  const keys = d.secrets.length ? d.secrets.map((s) => `- ${s.name}${s.host ? ` for ${s.host}` : ' (no API host set)'}`)
    .join('\n') : '(none yet)';
  return `Database and secret keys (Colon keeps them on its server; the site stays static):
- Load <script src="${script}"></script> before your own scripts on any page that needs them.
- await Colon.data('table').add({...}) saves one object (8 KB max); await Colon.data('table').list({ limit: 20 })
  returns [{ id, data, created_at }], newest first. Visitors can only read or add where the table allows it; the
  owner sees, edits and deletes everything in Colon's Data tab.
- await Colon.call('KEY_NAME', '/path?x=1', { method: 'POST', body: {...} }) calls the key's API host with the key
  added by Colon and returns the answer. NEVER put an API key, token or password in the site's files.
- Show friendly loading, empty and error states (Colon.* calls can fail).
Tables now:\n${tables}\nKeys now (values are hidden from you):\n${keys}
If the site needs a table or a key that isn't listed, still write the code, and add a line to your note for each:
=== NEEDS: table <name> read=<public|owner> add=<public|owner> -- <why, a few words>
=== NEEDS: secret <NAME> host=<api.example.com> as=<bearer|header:Header-Name|query:param> -- <why>
(table names lowercase like orders; key names uppercase like OPENAI_KEY). Colon shows the user a card to create it.`;
}

function tree(files) {
  return files.map((f) => `- ${f.path} (${f.size} bytes${f.text ? '' : ', binary'})`).join('\n');
}

const refText = (r) => (String(r).length > REF_BUDGET ? `${String(r).slice(0, REF_BUDGET)}\n… (cut)`
  : String(r));

// v0.31.2: the readable text of pages the user linked ("make mine like https://...", "use the menu on this page").
function linksBlock(links) {
  return 'Pages the user linked in this message (read just now; text only, layout and images are not included). '
    + 'Use their content, structure and tone as the user asks; do not copy them wholesale unless asked:\n'
    + links.map((l) => (l.error ? `--- ${l.url} ---\n(Could not be read: ${l.error})`
      : `--- ${l.url}${l.title ? ` (${String(l.title).slice(0, 120)})` : ''} ---\n${l.text}`)).join('\n\n');
}

// context({ files: [{ path, size, text: bool, content? }], message }) -> system context string
function context({ files, message = '', title = '', instructions = '', reference = '', data = null, links = [] }) {
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
      skipped.join(', ')}` : '',
    // v0.27.3: the user's standing instructions, and a repository to learn from
    instructions ? `The user's standing instructions for this site (follow them unless this message says `
      + `otherwise):\n${String(instructions).slice(0, 4000)}` : '',
    reference ? 'Reference repository: follow its structure, conventions and visual style when building. Do not '
      + `copy it wholesale unless the user asks.\n${refText(reference)}` : '',
    links.length ? linksBlock(links) : '',   // v0.31.2: pages the user linked in this message
    data && data.key ? dataRules(data) : '',
    data && data.key ? recipe(data.connections || []) : '',
    data && data.tools ? data.tools : ''].filter(Boolean).join('\n\n');   // v0.31.0: tools.js
}

module.exports = { context, linksBlock, RULES, BUDGET };
