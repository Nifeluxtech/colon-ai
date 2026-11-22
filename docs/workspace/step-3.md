# Workspace step 3 — preview, code, files and terminal (v0.27.0, Nov 22, 2026)

Everything in this step runs on the user's phone. No user code runs on the server.

## What shipped (all in `apps/chat`)
- **Preview** (`components/workspace-preview.js` + `lib/ws-site.js`): `GET /workspaces/:id/bundle` is turned into
  one self-contained page (local CSS/JS inlined, images/fonts as `data:` URLs, CSS `url()` resolved from the
  stylesheet's folder) and shown in `<iframe sandbox="allow-scripts allow-modals" srcdoc>`. An injected bridge
  reports `error` / `unhandledrejection` / `console.error`, turns clicks on site links into page changes, and stops
  form posts. Page picker, phone/desktop toggle (desktop = 1280 px scaled), Refresh. Broken links and links that
  start with `/` (they'd break at `apparatus.name.ng/<name>/`) are listed with the page's errors; **Fix it** sends
  them to the Chat tab (`workspace-chat.js` `send` option).
- **Code** (`components/workspace-code.js`): file picker + Monaco (`loadMonaco` from `code-edit.js`; plain textarea
  if the CDN fails). Save (and Ctrl/Cmd+S) → `PUT /file` → new version. Asks before leaving with unsaved edits.
- **Files** (`components/workspace-files.js`): New file (HTML starter), Upload (images → `images/`, fonts →
  `fonts/`, ≤1 MB each), per-file menu Edit / Rename or move / Delete, tap a text file to edit it, History + Restore.
- **Terminal** (`components/workspace-term.js`, `lib/ws-shell.js`, `lib/ws-runner.js`): a phone-friendly terminal
  (a plain input, not a canvas terminal like xterm.js, so the Android keyboard works), quick keys ↑ ↓ > " / Stop
  Clear. Commands: `ls tree cd pwd cat head wc touch echo >/>> mv cp rm grep find open help history clear`,
  `node`/`js` (prompt, `node file.js`, `js <code>`, `node -e`), `python`/`py` (prompt with multi-line blocks,
  `python -c`). File commands call the normal Workspace API, so each change is a version.
  - JavaScript runs in a Web Worker owned by a hidden `sandbox="allow-scripts"` iframe (opaque origin: no cookies or
    session), a fresh worker per run, stopped after 15 s.
  - Python is **Pyodide 0.29.0** from jsDelivr (≈10 MB, first use only), in a classic worker in the same iframe; it
    stays warm between runs and is restarted after Stop or a 60 s timeout. Pyodide 0.30+/314.x only runs in module
    workers, which an opaque-origin sandbox can't start, so stay on 0.29.x unless that changes.
  - Site text files are copied to Python's `/site` (working folder) and to `files` in JS. Not saved back.
- Icons `terminal` and `monitor` added to `packages/ui/js/colon/icons.js`. API client: `workspaceBundle`,
  `putWorkspaceFile`, `moveWorkspaceFile`, `deleteWorkspaceFile`.
- Tests: `packages/ui/test/ws-site.test.js`, `packages/ui/test/ws-shell.test.js`. The runner, preview bridge and
  components were also checked in headless Chromium (JS, endless-loop stop, Python with `/site`, preview errors,
  link navigation, Fix it, Monaco).

## Device test checklist
1. Open a workspace → Preview: the site shows; switch phone/desktop; pick another page; tap a link to another page.
2. Add `<script>oops()</script>` in Code, Save → Preview lists the error → Fix it → Chat sends it and Colon fixes it.
3. Code: edit `style.css`, Save → toast; History has "Edited style.css (code editor)"; Preview shows the change.
4. Files: New file `about.html`; Upload a photo (lands in `images/`); Rename; Delete; Restore from History.
5. Terminal: `help`, `ls`, `cat index.html`, `echo hi > notes.txt`, `js 2+2`, `node` then `[1,2].map(x=>x*2)` then
   `exit`, `python -c "print(1+1)"` (first time downloads Python), `python` then a `for` loop, `while(true){}` in
   `node` → Stop.

## For step 4 (publish)
Write the chosen version's files to `<docroot>/<name>/` (temp folder + rename) with Colon's own `.htaccess`.
The preview already treats links starting with `/` as broken, matching the published sub-path.
