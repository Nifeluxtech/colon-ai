# Colon Workspace — agreed 5-step plan

Status: **Steps 1–5 shipped (v0.25.0, v0.26.0, v0.27.0, v0.28.0, v0.29.0)** (Nov 23, 2026). Next: Step 6. Details per step: `step-N.md`. Source of truth for this feature.
Origin: two ChatGPT "Design Colon Workspace" chats from the owner (chat-first builder + free tools list),
summarised in `source-notes.md`. Where they differ from this file, **this file wins**.

## What it is
**Workspace** is a chat-first website builder inside Colon AI: describe a site → Colon writes the files →
live preview → ask for changes → Publish → the site is live at `apparatus.name.ng/<name>/`. Code and Files are optional tabs;
chat is the default view.

## Decisions (owner, Nov 22, 2026)
- Name: **Workspace** (not "Colon Dev"). Sidebar/nav entry sits **directly after Projects**
  (`apps/chat/src/pages/chat.js` navLink list, `main.js` routes, Settings row after Projects).
- Domain: use the current domain, **no new subdomains** (owner, Nov 22, 2026). Published sites live at
  **`https://apparatus.name.ng/<name>/`** (a folder under the main domain's document root, not
  `<name>.apparatus.name.ng`, not colon.site). Name = lowercase a–z, 0–9, hyphen, 3–30 chars; reserved:
  chat, browser, admin, api, www, mail, cpanel, webmail, ftp, cgi-bin, well-known, assets, static, v, and any
  folder or file that already exists in the main domain's document root.
- Best FREE tools only: no Vercel/Netlify/Replit/Codespaces/E2B/hosted sandboxes, no paid APIs.
  Use the existing Saga/Colon model connection, existing MySQL, cPanel hosting, Monaco (already vendored for
  Developer mode, `components/code-edit.js`).
- Keep the current stack: vanilla ES modules in `apps/chat`, Node API in `services/api`.
  No React/Next/shadcn rewrite (ChatGPT suggested it; rejected).
- v1 is **static sites only** (HTML/CSS/JS + assets). No user code ever runs on the server.
  Dynamic apps / multi-language execution (self-hosted Piston or Judge0 CE on a separate machine) = later.
- Logical "agents" (planner, frontend, debug…) are just prompts/modes on the same model, not separate services.
- Free plan gets Workspace with quotas from billing plans (projects, files, size, publishes per day).

## The 5 steps

### Step 1 — Workspace shell + project storage
- Route `#/workspace` (list) and `#/w/:id` (one workspace); nav link "Workspace" right after Projects;
  signed-in only. Mobile-first from 360px, same look as Projects (v0.24.0 Claude-app style).
- One workspace page has tabs: **Chat** (default), **Preview**, **Code**, **Files**, **Publish**.
- API: `GET/POST /workspaces`, `GET/PATCH/DELETE /workspaces/:id`,
  `GET/PUT/DELETE /workspaces/:id/files/*path` (text files + small images), limits from plan.
- MySQL: `workspaces` (id, user_id, title, slug NULL, created_at, updated_at, published_at NULL,
  published_version NULL), `workspace_files` (workspace_id, path, content MEDIUMTEXT/BLOB, size, updated_at),
  `workspace_versions` (id, workspace_id, n, note, files_json/snapshot, created_at). Migration in the
  repo's existing db folder style.
- Templates: blank, portfolio, business, landing page (static files in repo).

### Step 2 — Chat builds the site
- Workspace chat calls the model with the file tree + relevant file contents (reuse
  `modules/developer` snapshot/relevance) and a Workspace system prompt.
- Model replies with structured edits (whole-file writes or search/replace patches) → API validates paths
  (no `..`, allowed extensions, size caps) → saves → new version row. Chat shows "Created 5 files…" card
  with file names; one-tap Undo = restore previous version.
- Follow-ups ("make the header blue", "add a pricing page") edit the same files.

### Step 3 — Live preview + Code/Files tabs
- Preview: sandboxed `<iframe sandbox="allow-scripts">` built from the files via blob/srcdoc
  (rewrite relative links to blob URLs), phone/desktop width toggle, refresh after every edit.
  No server execution.
- Code: Monaco editor on any file, save = new version. Files: tree, add/rename/delete, upload image.
- Errors from the preview (window.onerror via postMessage) appear in chat with "Fix it" → sends to the model.
- Added by the owner (Nov 22, 2026): a **Terminal** tab. File commands over the workspace API plus JavaScript
  and Python (Pyodide) running on the user's phone in a sandboxed iframe's workers. Never a server shell.

### Step 4 — Publish to `apparatus.name.ng/<name>/`
- No DNS, subdomain or SSL work: the main domain already has HTTPS. Find the main domain's document root
  on cPanel (usually `/home/apparatu/public_html`) and confirm it is writable by the Node API user.
- Publish: API writes the chosen version's files to `<docroot>/<name>/` (write to a temp folder, then rename,
  so a site is never half-published). Static only; `.php`, `.htaccess` and server-side files are never written
  (paths.js already refuses them). Each published folder gets its own `.htaccess` written by Colon (not by the
  user) that turns off script handlers (`RemoveHandler`/`php_flag engine off`) and Options -Indexes.
- Sites use relative links (templates already do), so they work under `/<name>/`. The preview (step 3) must
  also serve files under a sub-path so what users see matches the published site.
- Name check refuses reserved names and any existing folder/file in the document root.
- Publish tab: pick name (availability check), Publish / Republish / Unpublish, Copy link, deploy history
  (versions), visibility Public. Custom domains = later.
- Abuse: report link in a tiny footer badge "Made with Colon", admin can take a site down (Admin Dashboard).

### Step 5 — Database and secret keys (added Nov 23, 2026 at the user's request)
- Data tab: per-workspace tables of JSON records with visitor read/add rules, and encrypted secret keys tied to
  one API host. Sites use them through `/sites/<key>/colon.js` (Colon.data, Colon.call); keys never enter files.
- The chat knows table and key names and shows "needs" cards (=== NEEDS: lines) to create what a build needs.
- Still static-only: no user code runs on the server. Details: step-5.md.

### Step 6 — Polish, limits, release
- Quotas wired to billing plans; Admin Dashboard list of published sites with takedown.
- Basic traffic count per site (Apache log or a tiny pixel hit endpoint), optional.
- Tests for path validation, slug rules, publish/unpublish; keep check.js rules (files ≤300 lines,
  lines ≤120 chars).
- Release with the normal recipe (version bump everywhere, CHANGELOG, version.json, android.yml release,
  cPanel deploy + `.cpanel.yml` task for `sites/` if needed, restart API, verify `/health`).
- Docs: `docs/workspace/step-N.md` per step with a device test checklist.

## For the next AI picking this up
- Repo rules: see root README/CONTRIBUTING and `scripts/check.js` (300 lines/file, 120 chars/line,
  versioned `/v<ver>/` URLs). 13 known pre-existing test failures on main — don't add new ones.
- Existing pieces to reuse: `apps/chat/src/pages/projects.js` (page layout), `components/code-edit.js`
  (Monaco loader), `services/api/src/modules/developer/*` (snapshot, relevance), `modules/projects/store.js`
  (MySQL store pattern), `http/routes/projects.js` (route + rate-limit pattern).
- Deploy: cPanel at cpanel.apparatus.name.ng, user `apparatu`, repo clone `/home/apparatu/repositories/colon-ai`,
  existing docroots `/home/apparatu/{chat,browser,admin}.apparatus.name.ng`.
- Update the **Status** line at the top and tick steps here as they ship.

## Progress
- [x] Step 1 — shell + storage (v0.25.0, see step-1.md)
- [x] Step 2 — chat builds the site (v0.26.0, see step-2.md)
- [x] Step 3 — preview + code/files + terminal (v0.27.0)
- [x] Step 4 — publish to `apparatus.name.ng/<name>/` (v0.28.0, see step-4.md)
- [x] Step 5 — database and secret keys (v0.29.0, see step-5.md)
- [ ] Step 6 — polish, limits, release
