# Changelog

## 0.31.2 (2026-11-23) · Workspace chat answers fast and reads links

Every Workspace chat message used to run a whole build (read all files, ask the code model, wait for the full
answer), so "Open browser" or "hi" sat behind "Thinking and writing the code" for close to a minute.

- **Triage** (`services/api/src/modules/workspace/triage.js`): rules first, no model call. Tab commands answer at
  once; greetings and questions get a quick answer; everything else builds as before. Any doubt means build, so a
  change request is never lost.
- **Tab commands**: "open browser", "open the preview", "show the code", "open terminal", "go to the database",
  "open publish". The reply comes back with an `action` and the app switches tab; "open browser" opens the live site
  when it is published, otherwise the preview. Commands cost no credit.
- **Quick answers**: a short answer from the file list, small file contents and the last few messages (20 s limit).
  When the model answers `BUILD:` (it was a change after all), fails or is slow, the message builds normally. Quick
  messages stay out of the build history.
- **Links**: http(s) links in a message (up to two) are read on the server with the safe page reader
  (`search/reader.readPage`: SSRF-checked, 8 s, readable text only) and given to the quick answer or the build, so
  "make my menu like https://..." or "read this site and tell me what they sell" work. A build shows a "Reading the
  link" step; a page that will not open is reported to the model, not fatal.
- Tests: `services/api/tests/unit/workspace-triage.test.js`.

## 0.31.1 (2026-11-23) · Light mode for the Code tab and the 0.31.0 Data cards

0.31.0's IDE, Shell, Git and database cards were designed in dark mode only. In light mode the active file tab was a
solid navy block with dark (unreadable) text, the editor sat in Monaco's stock "vs" theme (plain red and blue, a navy
strip around it), the Shell stayed dark and several labels fell under WCAG AA.

- **File tabs**: the tab bar is the light grey surface and the active tab is white with the blue top line, so every
  file name reads (the active tab used the chat code-block navy, `--code-bg`, which stays dark in light mode).
- **Code theme**: a new `colon-light` Monaco theme (`apps/chat/src/lib/ide-theme.js`) built from Colon's palette:
  ink text on white, royal-blue keywords and tags, cyan-700 attributes and JSON keys, green strings, amber numbers,
  slate italic comments, violet types, matching bracket colours, a soft current-line highlight and slate line
  numbers. Every token colour is at least 4.5:1 on the editor and on the current line (unit-tested). It also follows
  a theme switch while the editor is open, and the Developer-mode Edit sheet uses it too (Monaco's theme is global).
  Dark mode keeps `vs-dark`.
- **Shell panel and key row**: light in light mode (white output, grey header and key row, green prompt, red errors,
  readable dim lines). Its colours are now `--term-*` variables; dark mode keeps 0.31.0's exact colours.
- **Files drawer**: file-type badges in darker shades (the dark-mode yellow and cyan were about 1.5:1 on white) on a
  grey chip, folder icons in sky-600, and the closed drawer no longer casts a grey band down the editor's edge.
- **Run** button, **Colon can edit** badge: dark green on the green tint (was 3:1).
- **Data tab**: the Git repository card (last commit, Push / PR / Merge, open pull requests) and connected database
  cards are lifted off the page, the last-commit line and table rows sit on the grey surface (they were white on
  white) with readable secondary text, and the row viewer's sticky header is grey. Connect sheets: "Saved. Type to
  replace" placeholders are readable (4.7:1).
- **Download ZIP card** in the chat: its note is readable on the blue tint.
- New `--ide-*` / `--term-*` theme variables in `chat-ide.css` (both themes), tested in
  `packages/ui/test/ide-light-css.test.js` (every light text/surface pair at 4.5:1 or more, no hard-coded Shell
  colours left). Dark mode screenshots are pixel-identical to 0.31.0.

## 0.31.0 (2026-11-23) · Workspace: one Code tab, real databases and Git

- **Code tab**: Files, Code and Terminal are now one IDE screen. A file tree with real folders (open and close,
  New file / New folder / Upload anywhere, Rename, Move, Delete; moving or deleting a folder is one version), a
  tabbed editor (several files open, unsaved dots, Save / Ctrl+S) and the Shell. On wide screens the three sit
  side by side; on phones the tree is a drawer and the Shell a bottom panel, each one tap away. **Run** opens the
  current page in Preview. Empty folders are kept as `<folder>/.gitkeep`, so they publish and push too.
- **Download as ZIP**: the Files panel's Download button saves every file and folder of the workspace as one
  `.zip` (`<site>-v<version>.zip`, everything inside a `<site>/` folder; empty folders kept). It's built on Colon's
  server with a tiny built-in zip writer (no new dependency), only for the workspace's owner (another account gets
  404), and holds no secrets: secret keys, server keys and tokens live in their own encrypted tables, never in the
  files. In the Android app it goes to Downloads. Ask in Chat too (“export my files as zip”): Colon packs the files
  after any changes it made and puts a **Download ZIP** card in the thread. `GET /workspaces/:id/export`.
- **Server access for connections**: Supabase (service_role or secret key, plus an optional personal access token
  (`sbp_…`) for creating tables and adding columns through Supabase's Management API; the form warns that this
  token controls the whole Supabase account, keeps it encrypted, never puts it in the site, and shows whether it is
  saved), Firebase (service account), Appwrite (API key) and PocketBase
  (superuser login). Colon's chat can then read and change the database itself: list tables, select, insert,
  update, delete, create tables and add columns. The Data tab shows each connected database's tables and rows.
  Dropping or emptying a table, and an update or delete with no filter, are refused unless your message asks.
- **GitHub and Bitbucket**: connect a repository (with a folder in it if you like) and a token. Push commits every
  workspace file in one commit (files you deleted are deleted there too), PR opens a pull request, Merge merges a
  branch or a pull request; open pull requests are listed with a Merge button. Ask in Chat too: “commit and push”,
  “open a PR from colon-update”, “merge PR 7”. Bitbucket uses an Atlassian API token with your email, or a
  repository / workspace access token.
- The Workspace chat gets a small tool loop: when it needs to look at the database first it asks, gets the results
  and answers again (at most three extra rounds per message, no extra charge). Every database or Git step shows in
  the build steps, and its outcome is added to Colon's reply.
- Credentials are encrypted with APP_SECRET in the new `secret_enc` column, never returned and never reachable from
  a published site. Connections stay per workspace.
- Preview: a page copied from Colon's own app no longer shows “Please refresh”; it says what the file is.
  References that aren't site files are blanked instead of loading from Colon's address, and JS modules in folders
  (`import x from './lib/a.js'`) now work in Preview.
- Migration 0026: `colon_workspace_connections.secret_enc` and `.state`.

## 0.30.1 (2026-11-23) · Workspace Terminal: npm install and pip install

- `npm install <pkg>` (also `npm i`, `yarn add`, `npm uninstall`, `npm ls`) looks the package up on the npm
  registry and saves it in the site's package.json. Preview and published pages get an import map that loads it
  from esm.sh, so `import { createClient } from '@supabase/supabase-js'` works in `<script type="module">`; in
  `node`, use `await import('name')`. `npm install supabase` installs the browser client `@supabase/supabase-js`.
- `pip install <pkg>` (also `pip install -r requirements.txt`, `pip uninstall`, `pip list`) installs into the
  phone's Python (Pyodide micropip) and saves it in requirements.txt, which installs again whenever Python
  starts. `import numpy` and other Pyodide packages now load on their own.
- The site builder knows packages in package.json can be imported by name.
- Limits: everything runs in the browser, so packages that need Node built-ins, a server or native code can't run.

## 0.30.0 (2026-11-23) · Workspace: sign-in services and per-user site links

- Site links are now `apparatus.name.ng/<username>/<site>/`, so two people can both have a site called `shop`.
  You pick your publishing name once on the Publish tab (you can change it later; every site link follows). Sites
  published before 0.30.0 at `/<site>/` forward to their new link the next time they are republished.
- Data tab: **Sign-in & services** connects Supabase, Firebase, Appwrite, PocketBase or Clerk with their public
  client settings (private keys are refused and belong in Secret keys). The builder then writes login, register,
  log out and account pages with the connected service, and asks for a connection with a card when a site needs
  sign-in and none is connected.
- Preview gives sign-in libraries in-memory storage, so you can try login inside Preview (the session lasts until
  the preview reloads).
- Migration 0025: `colon_site_owners`, `colon_workspace_connections`, site names unique per user.

## 0.29.0 (2026-11-23) · Workspace step 5: database and secret keys

- Workspace chat opens on the newest message, follows new replies while you are at the bottom, and shows a
  **Latest** button to jump down when you have scrolled up.
- Every workspace gets a **Data** tab (before Publish) with a small database and a safe key store, so a static
  site can save orders, sign-ups or messages and call paid APIs without a key ever going into its files.
- Database: tables of JSON records (8 KB each, 5000 per workspace, 20 tables). Each table says whether visitors
  can read it and whether they can add to it; the owner sees, adds and deletes everything in Colon.
- Secret keys: `NAME` = value, encrypted with AES-256-GCM (APP_SECRET), never shown again. Each key is tied to
  one API host and sent as a Bearer token, a header or a URL parameter. A page calls the API through Colon's
  proxy, which adds the key (https only, public addresses only, no redirects) and masks it in the answer.
- Sites load `https://api.apparatus.name.ng/sites/<workspace>/colon.js` and use `Colon.data('orders').add({...})`,
  `.list()` and `Colon.call('KEY', '/path')`. The Workspace chat knows the tables and key names (never values)
  and, when a build needs one that doesn't exist, shows a card to create the table or add the key.
- Preview no longer reports code inside scripts (`${esc(src)}`, `{{ x }}`, `' + href + '`) or an SVG's
  `url(%23id)` as missing files.
- New: migration 0024_workspace_data; owner routes `GET /workspaces/:id/data`, `PUT|DELETE
  /workspaces/:id/secrets/:name`, `PUT|DELETE /workspaces/:id/tables/:name`, `GET|POST
  /workspaces/:id/tables/:name/records`, `DELETE .../records/:rid`; public routes (any origin, no cookies, limited
  per IP) `GET /sites/:key/colon.js`, `GET|POST /sites/:key/data/:name`, `POST /sites/:key/call/:name`. Details
  and the device checklist: docs/workspace/step-5.md.

## 0.28.0 (2026-11-22) · Workspace step 4: Publish

- The Publish tab puts a workspace live at `https://apparatus.name.ng/<name>/`: pick the name (checked as you
  type: 3 to 30 lowercase letters, numbers or hyphens; reserved names and existing folders are refused), tap
  Publish. Afterwards it shows the live link (Open, Copy link), the published version and "Changes not live yet"
  when the files changed since, with Republish and Take down.
- Publishing writes the current files to a hidden temp folder and swaps it in with one rename, so a site is never
  half-written. Static files only; every site gets a Colon-written `.htaccess` (no scripts, no folder listings) and
  a small "Made with Colon · Report" badge on each HTML page. Deleting a workspace takes its site down.
- New: `GET /workspaces/:id/publish/check?name=`, `POST /workspaces/:id/publish { name }`,
  `DELETE /workspaces/:id/publish` (audited). Sites are written under `WORKSPACE_PUBLISH_ROOT`, default
  `~/public_html`. Details and the device checklist: docs/workspace/step-4.md.

## 0.27.4 (2026-11-22) · Workspace builds no longer get stuck; "stop" stops

- Fixed: a build could sit on "Thinking and writing the code" forever when the API process running it ended
  (cPanel recycles processes) or a provider ignored the time limit. Builds now have a hard 4-minute limit, and a
  build with no progress for 6 minutes is reported once ("stopped before it finished", nothing changed) and the
  queue moves on. Only one API process can pick up or report a build.
- Sending "stop" (or "cancel") while Colon builds now stops it: nothing is changed and queued requests are
  dropped. Before, "stop" was queued as a change request.

## 0.27.3 (2026-11-22) · Workspace header, list menus, and the chat's + menu

- Inside a workspace, the tabs are the header: they stick to the top while you scroll, with Back beside Chat. The
  old title bar with its ⋯ menu is gone.
- The chat box floats at the bottom over the conversation.
- Rename and Delete moved to a ⋯ menu on each workspace in the Workspace list.
- A + beside the chat box opens:
  - Clone a repository: paste a GitHub link (owner/name, a repo page, or a /tree/branch page) or any https Git
    address; its website files replace the workspace's as one version, with Undo in the chat. A site kept in
    public/, docs/, dist/, build/, site/, www/, _site/ or out/ is taken from that folder.
  - Learn from a repository: Colon reads its key files (README, pages, styles, scripts; about 40 KB) and follows
    its structure and style in every build until you stop it (chip above the chat box).
  - Set instructions: standing rules for this site (up to 4,000 characters) sent with every build.
- New: `POST /workspaces/:id/repo { action: clone | learn, url }`, `DELETE /workspaces/:id/reference`,
  `PATCH /workspaces/:id { instructions }`; migration 0023 adds `instructions`, `ref_url`, `ref_text`, `ref_files`
  to `colon_workspaces`; `services/api/src/modules/workspace/repo.js` reuses the Projects repository download
  (GitHub zip from codeload, shallow git clone otherwise; public repositories only).
- Each build in the queue gets its own 4-minute limit and the workspace's latest instructions and reference.

## 0.27.2 (2026-11-22) · Workspace chat shows its steps live, and you can talk to it while it builds

- While Colon works, the chat shows each step as it happens, like other assistants show their tools: reading your
  site's files (count and size), thinking and writing the code (with the model used), checking the changes, then
  each file it created, edited or deleted and the version it saved. The running step has a spinner and a timer;
  finished steps get a tick, failed ones a warning.
- Finished replies keep a "N steps · time" line you can open to see them again.
- Steps are saved in the database (migration 0022 adds `colon_workspace_messages.steps`), so any API process can
  answer the app's poll. The poll runs every 1.5 s while Colon works.
- You can keep typing while Colon builds. A question ("how far are you?") gets a quick answer from the live steps
  without touching your files; a change or new feature is marked "Queued: builds next" and is built right after the
  current build (one at a time, oldest first). Migration 0022 also adds `colon_workspace_messages.kind`
  (running, queued, done, side). New `services/api/src/modules/workspace/side.js`.

## 0.27.1 (2026-11-22) · Fix: Workspace chat showed no reply

- The server runs several API processes, and the chat's "Colon is working" state lived in one process's memory.
  The app's poll often reached another process, saw "not working" and stopped, so only your message showed.
  "Working" now also comes from the database (newest message is yours and under 5 minutes old).
- If a reply is lost, the chat now says so ("Colon didn't answer this one…") instead of showing nothing.

## 0.27.0 (2026-11-22) · Workspace, step 3: preview, code, files, terminal

- **Preview tab**: the site as it will look once published, built on the phone from its files and shown in a
  sandboxed iframe. Phone/desktop width, page picker, Refresh, links between pages. Page errors, broken links and
  links starting with "/" are listed with **Fix it**, which sends them to the Chat tab.
- **Code tab**: edit any text file in Monaco (plain text box if it can't load); Save makes a new version.
- **Files tab**: New file, Upload (images and fonts up to 1 MB), Rename or move, Delete, tap to edit.
- **Terminal tab** (new): `ls`, `cd`, `cat`, `echo > file`, `mv`, `cp`, `rm`, `grep`, `find`, `open`… over the
  workspace's files, plus `node`/`js` and `python` (Pyodide 0.29.0, downloaded once, about 10 MB). Code runs on the
  phone in workers inside a sandboxed iframe (no cookies or session), JS stops after 15 s, Python after 60 s, and
  Stop ends a run. Nothing runs on the server. Details: `docs/workspace/step-3.md`.

## 0.26.1 (2026-11-22) · Workspace fix

- Fix: opening a workspace failed in 0.26.0 (`quiet()` was declared in the list page instead of the workspace
  page, so the Chat tab threw a ReferenceError). Moved it into `workspaceOne`.

## 0.26.0 (2026-11-22) · Workspace, step 2: chat builds the site

- **Workspace chat works**: describe the site ("a one-page site for my bakery with a menu and contact form") or a
  change ("make the header blue", "add a pricing page") and Colon writes or edits the files. Each reply lists the
  files it created, edited or deleted, with a one-tap **Undo** while it is the newest change. Ideas to start from
  when the chat is empty.
- How it works: `POST /workspaces/:id/chat` saves the message and builds in the background; the app polls
  `GET /workspaces/:id/chat`. The model (Developer mode, larger output) gets Workspace rules, the file tree and the
  files' contents (60k-character budget) and answers with `=== FILE` / `=== EDIT` (SEARCH/REPLACE) / `=== DELETE`
  blocks (`modules/workspace/edits.js`). Every block is checked first (static types only, sizes, file count), then
  the whole reply is saved as ONE version; a bad reply changes nothing. One reply at a time per workspace; each
  counts as one Developer-mode reply against the daily limits (refunded if it fails).
- Database: migration `0021_workspace_chat` (colon_workspace_messages).

## 0.25.0 (2026-11-22) · Workspace, step 1

- **New: Workspace** (sidebar, right after Projects; also in Settings). A chat-first website builder, planned in
  `docs/workspace/plan.md` (5 steps). Step 1: create a workspace from a template (Blank, Portfolio, Business,
  Landing page), five tabs (Chat, Preview, Code, Files, Publish), open any file, and a history of every change with
  one-tap restore. Chat building (step 2), live preview and code editor (step 3) and publishing to
  `apparatus.name.ng/<name>/` (step 4) come next.
- API: `/workspaces` (list, create, get, rename, delete), `/workspaces/:id/file` (read, write, move, delete),
  `/bundle`, `/versions` and restore. Static sites only: HTML, CSS, JS, JSON, text, SVG, images and fonts; `.php`,
  `.htaccess`, hidden files and `..` are refused. Limits: 20 workspaces, 200 files, 512 KB per text file, 1 MB per
  image or font, 4 MB per workspace, newest 20 versions kept.
- Database: migration `0020_workspaces` (colon_workspaces, colon_workspace_files, colon_workspace_versions).

## 0.24.4 (2026-11-22) · "Hey Colon" hears better, no web splash

- **Hey Colon is more eager**: keywords score 1.5 and threshold 0.2 (defaults 1.0 / 0.25). In sandbox tests with
  three synthetic voices, quiet and noisy, it caught more "Hey Colon"s (166 vs 162 of 216) with few extra false hits.
- **Settings › Voice shows what Hey Colon is doing**, refreshed every second: "Starting…" while the engine loads
  (it used to say "couldn't start on this phone"), the engine's error if it really fails, and while listening the
  mic level and how many times it heard "Hey Colon". A level under 5% means the mic is too quiet.
- **No flame splash**: the full-screen COLON intro no longer plays when Chat, Browser or Admin open; the Android app
  keeps its own launch screen.

## 0.24.3 (2026-11-22) · "Hey Colon" crash fixed

- **Fix: Colon AI stopped a few seconds after Hey Colon started listening.** The 0.24.2 crash report showed the
  cause: the `-mobile` gigaspeech KWS model aborts on its first decode in sherpa-onnx (Reshape
  `/downsample/Reshape_1`, input {17,1,128} vs {8,2,1,128}); reproduced with sherpa-onnx 1.13.8 and 2.0.x on x86.
  CI now bundles the regular `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` model (same file names: int8
  encoder and joiner, fp32 decoder), which decodes without error and still spots keywords.
- Hey Colon stays off after the crash; switch it back on in Settings › Voice.

## 0.24.2 (2026-11-21) · Native crash details for "Hey Colon"

- **Crash report shows the native trace**: on Android 12+ `CrashGuard` reads the tombstone Android keeps for a native
  crash and adds its readable lines (signal, abort message, libraries, functions). 0.24.1 only showed "crash".
- **Hey Colon steps**: `WakeWordService` notes each step (engine loading/ready, mic open/close, first audio, heard,
  yield to Colon, release) in a small file; the report includes the last 15, so we see what ran when it stopped.

## 0.24.1 (2026-11-21) · "Hey Colon" no longer stops the app

- **Fix: "Colon AI keeps stopping" with Hey Colon on** (Infinix SMART 20). `WakeWordService` now uses the native
  sherpa-onnx engine from one thread at a time (`engineLock` around feed, reset and release) and waits up to 1 s
  for the listening thread before reusing or freeing the engine (was 300 ms).
- **Hey Colon opens full voice mode** in the app instead of the shortcut's step-back behind the pill.
- **Works with battery saver**: "Pause with battery saver" is now off by default.
- **Crash guard** (`CrashGuard.kt`): Java crashes are written to a file; native crashes and ANRs are read from
  `ApplicationExitInfo` (Android 11+). On the next start Hey Colon is switched off if it was on, so the app always
  opens, and the chat screen shows the report once with Copy report.

## 0.24.0 (2026-11-21) · Memory that remembers, app help, updater, new chat page, Projects with repositories

- **Memory remembers what you tell it** (PR #40): with memory on, Colon saves name, nickname, "call me X", where
  you live or are from, school, job, likes, dislikes, favourites and "always/never" requests (English and simple
  Pidgin, `memory/facts.js`), source `auto`. A newer fact of the same kind replaces the old one (`kind` column,
  migration `0018_memory_auto.sql`); identity notes always go into the context. "Saved to memory" chip with Undo;
  a one-time offer to turn memory on. Questions, passwords, codes and card numbers are never saved.
- **Colon knows its own app** (PR #40): `docs/app-guide.md` (18 sections) and `modules/appguide`. "How do I … in
  Colon" answers with exact paths (Settings › Voice › Hey Colon); the chat sends its platform and version.
- **Update progress that survives minimizing** (PR #39): a progress sheet (percent, MB, Cancel, Hide), progress in
  the notification shade, a manifest receiver that verifies the APK even if the app was killed and posts "Colon AI
  X is ready · Tap to install". Reopens a running download instead of starting a second; cleans old APKs.
  `UpdateRules` with 13 unit tests.
- **New chat page** (PR #41): the Colon intro animation (drop, ripples, clouds, COLON) plays once and holds on the
  final frame (poster only with reduced motion); the four shortcuts are a list above the input with the mode chips.
- **Attach sheet** (PR #41): the paperclip lists Camera, Photos and Files. Android: TakePicture with CAMERA asked at
  use, the system photo picker and the document picker (`FileChooser.kt`, `FileChooserRules`).
- **Projects redesign + repositories** (PR #42): new Projects list (search, sort, "+ New project") and project page
  (Private badge, Context and Custom instructions cards, Memory row, sessions, "+ New session"). Context connects
  GitHub, GitLab, Bitbucket (token) or any https Git URL (`modules/repos`): archive download or shallow clone,
  ignore rules and caps, SSRF-checked hops, encrypted tokens never shown, Sync by commit. Repo projects open in
  Developer mode with the file tree, stack-trace files and `read_repo_file` / `search_repo` tools; diffs are
  coloured with Copy. Migration `0019_project_repos.sql`.

## 0.23.0 (2026-11-21) · Step 5: "Hey Colon" wake word

- **Say "Hey Colon"** to start talking, from any screen (Colon AI for Android, OS Assistant Step 5). Off by default:
  Settings › Voice › Hey Colon. Offline keyword spotting with sherpa-onnx 2.0.2 (Apache-2.0) and its gigaspeech
  3.3M mobile model, keywords `▁HE Y ▁COL ON`, no training, free. Behind a `WakeWordEngine` interface;
  openWakeWord is the documented backup.
- A microphone foreground service with a persistent notification and **Stop**. It pauses during calls, while
  Colon's own recognizer, voice mode or song ID use the mic, while another app records, and (option, on by default)
  on battery saver, and resumes by itself.
- On "Hey Colon": a chime, then the voice listener opens like the "Talk to Colon" shortcut, so the command or chat
  and its reply show in the thread. Without "Display over other apps", a "Tap to talk" notification instead.
- CI downloads the AAR and model from pinned sha256-checked URLs (nothing binary committed); Colon AI ships arm
  libraries only. Unit tests for the engine wrapper and the service state machine (`WakeWordTest`).
- Docs: `docs/os-assistant/step-5.md` (15-item release checklist, device test matrix, Crashlytics setup TODO).

## 0.22.1 (2026-11-21) · Video cards like the browser card, natural watch phrases, commands shown in chat

- **One video card per request**, like Saga's browser card: each "watch" or "play" adds a new card under its own
  reply and never replaces the old one. Only one plays at a time; the one before stops and collapses to a row with
  its thumbnail, title, **Play again** and Open in YouTube (`components/video-row.js`). Cards survive redraws and are
  saved in the chat (reply origin `video` with the video as its source), so a reload shows past cards collapsed.
  The 0.22.0 controls, the untappable video, no Next button and the silent embed fallback are unchanged.
- **Natural watch and play phrasing**, typed or spoken, case-insensitive, filler and punctuation removed: "let's
  watch X", "I wanna watch X", "can I watch X", "can you show me X", "show me X video", "put on X", "play X video",
  "open/find X on YouTube", "I'd like to watch X", "search YouTube for X"; music: "let's play X", "I want to listen
  to X", "put on X song", "can you play X". "watch out", "what should I watch", "watch your words", "I watched X
  yesterday" stay chat. One shared matcher (`lib/command-phrases.js`) for the web chat and the Android app (which
  runs the same page); 70+ table-driven cases.
- **Every command shows in the chat**: phone actions, music, watch, the card's player words and song recognition
  add the user's message and a short reply ("take me to WhatsApp" → "I'll take you to WhatsApp now."), 2–3 wordings
  per action, failures included ("I couldn't find WhatsApp on this phone."). Saved in history
  (`POST /conversations/:id/notes`, origin `command`; the note limit is now 120 per 10 minutes). Voice mode speaks
  the same words with the phone's TTS. The Android app now tells the page the opened app's own name (`label`).
- **Voice mode over other apps hears and answers again** (the "Talk to Colon" overlay over WhatsApp sat on
  "Listening…"): recognizer errors are logged (`ColonVoice`) and named instead of swallowed, restarts wait 250 ms
  (no more "recognizer busy"), a language the speech service lacks is retried in en-US, the turn ends on the phone's
  own end of speech instead of a page timer that sleeps in the background, and a dead mic is shown and spoken
  ("Microphone permission needed…") before voice mode ends. The overlay's wave follows the real mic level (flat in
  silence) and shows your words live. No speech: "I didn't catch that." See `docs/os-assistant/voice-ui.md`.
- **Voice mode answers faster** (targets: mic ready < 300 ms, a phone command answered < 500 ms after you stop
  speaking, first spoken word of a chat reply < 2 s). The server gives voice turns a brief spoken prompt (1–3
  sentences, no markdown), a 300-token cap (`CHAT_VOICE_MAX_TOKENS`), an 8 s first-token handover
  (`CHAT_VOICE_FIRST_TOKEN_MS`), skips the browser-tool pre-call and leaves out Gemma 4 31B. The page speaks each
  sentence as soon as it has streamed, and "watch/play X" says "Okay, finding X." before the search returns. The
  Android app pre-warms the speech recognizer when the app or the voice overlay opens, beeps and tells the page
  when the mic is ready, ends a turn after 0.7 s of silence, prefers on-device recognition where the phone has it,
  and starts text-to-speech at app start. Each turn's timings are logged (console, and logcat tag `ColonVoice`;
  `lib/voice-timing.js`).

## 0.22.0 (2026-11-21) · Music card in chat, watch videos, Step 4 song recognition

- **The video card is in the chat now**, under the message that was last when it started, instead of above the
  composer. It survives every redraw of the thread without reloading the video (a stable layer after `#cw-page`
  with a placeholder in the thread, `components/music-place.js`) and scrolls into view when it opens. A new chat,
  another chat or a page closes it.
- **The video can't be tapped** (no YouTube controls, keyboard or fullscreen; a clear shield over it, YouTube's
  branding still visible). Colon's own row: **Back 5 s**, **Play/Pause**, **Forward 10 s**, a progress bar with
  elapsed/total time, Open in YouTube and Close. **Next is gone**; a video that won't embed still falls back to the
  next search result silently.
- Voice/typed words while it is open: "pause", "resume", "forward" / "skip ahead" / "fast forward" (+10 s),
  "back" / "rewind" / "go back" (−5 s), "stop the music". "next" no longer controls the card.
- **Watch**: "watch X", "show me the video of X", "play the video of X", "watch X on YouTube" play any YouTube video
  in the card (`GET /music/search?kind=video` drops the Music category; the cache keeps music and video apart).
  Never the phone's songs. "watch out" and questions stay chat.
- **Step 4, recognise music around you** (free only, owner decision 2026-11-21; `docs/os-assistant/step-4.md`):
  `SongRecognizer.kt` runs songprint first; with no match or no network and the Shazam app installed, Colon hands
  off to Shazam ("Opening Shazam to listen.", code `handed_off`). Manifest `<queries>` adds `com.shazam.android`.
  ShazamKit and paid AudD are removed from the plan.
- "What song is this?" answers from the playing video card without the mic. After Colon names a song, "play it" /
  "play that song" (within 10 minutes) plays it in the card.

## 0.21.1 (2026-11-21)

- Colon Music stays in the app: when YouTube won't play a song inside Colon, the player card stays with the reason
  (for example "YouTube error 152") and its YouTube button, instead of jumping to the YouTube app.
- The player retries on the regular youtube.com host when the no-cookie host is refused (errors 150, 152, 153), and
  skips error 152 like the other embed errors.
- A failed music search now says why (signed out, offline, not set up) instead of opening YouTube.
- Mostly a chat-page change; the APKs are rebuilt only to keep the version in step.

## 0.21.0 — 2026-11-21 · Colon Music on YouTube

- **"Play <song>" plays it inside Colon.** Songs on the phone still come first (Android); otherwise Colon finds the
  song on YouTube (`GET /music/search`, YouTube Data API v3, embeddable music videos, region NG, answers cached 6 h)
  and plays it in a player card at the top of the composer (`components/music-dock.js`, YouTube's official IFrame
  player, `chat-music.css`). The card shows the title and channel, Next (the next search result), Open in YouTube
  and Close; a video whose owner blocks embedding is skipped. Works on the web too.
- "pause", "resume", "next", "stop the music" control the player while it is open.
- YouTube's rules: the player pauses when Colon goes to the background or the screen locks. Phone songs keep
  playing in the background as before.
- **Jamendo removed.** New env `YOUTUBE_API_KEY` replaces `JAMENDO_CLIENT_ID`; without it "play X" opens the YouTube
  app (or a YouTube tab on the web).

## 0.20.3 — 2026-11-21

- **Voice mode reads replies again on Android 11+.** The app didn't declare the text-to-speech engine or the speech
  recognizer in its manifest `<queries>`, so Android hid them: `TextToSpeech` failed to start, the page got an
  error and voice mode went straight back to listening just before the reply. Added `TTS_SERVICE` and
  `RecognitionService` intents.
- **Replies are read in plain English** (US voice) whatever English the mic listens in; Yorùbá, Hausa and Igbo
  still use Colon's voices.
- **New voice orb**: a glass sphere with a bright rim, cyan and violet ribbons orbiting it, the mic in a glowing ring
  with wave bars either side (they follow your voice while listening and pulse while Colon speaks), the state label
  and the Colon mark inside, and a glowing ring beneath (`voice-overlay.js`, `chat-voice.css`).

## 0.20.2 — 2026-11-21

- **Voice mode speaks its replies in the Android app.** Android System WebView has no working `speechSynthesis`, so a reply was never read out: the page heard "done" at once, went back to listening, and after two quiet turns voice mode ended. New bridge feature `speak` (`NativeSpeak.kt`, Android `TextToSpeech`, free) used by `read-aloud.js` for the phone's voice in the app.
- **Hands-free ignores late recognizer results** while Colon thinks or speaks, so a stray result can't restart the turn and drop the reply.
- **Phone commands**: "take me to WhatsApp", "go to …", "switch to …", "bring up …" and "open up …" open the app (names with no app still go on as a normal message).

## 0.20.1 — 2026-11-20

Voice mode fixes after the first test on an Infinix SMART 20.

- **English voice input uses the phone's own speech recognizer** (Android `SpeechRecognizer`, free). New bridge feature `listen` (`NativeListen.kt`, only advertised when the phone has a recognition service) and `apps/chat/src/lib/native-listen.js`, which stands in for the Web Speech API inside the app. Words show live, the orb follows the voice, and a turn no longer waits on a server upload. Other languages still go through Colon speech.
- **No more stuck "Transcribing…"**: the page gives up on a transcription after 40 s; the server tries Naija Speech for 15 s and Gemini for 22 s.
- **Hands-free bar removed**: the full-screen voice screen is the whole UI. While voice mode runs, the composer's voice button brings the voice screen back.
- **Floating pill taps**: a tap may wobble up to 24 dp and still expand the pill; holding to end now takes 0.9 s, and a swipe to end 72 dp. The pill no longer drags on a small wobble.

## [0.20.0] — 2026-11-20 · Voice mode redesign
Voice mode (hands-free) gets a new look in the app and over other apps. See `docs/os-assistant/voice-ui.md`.
### Added
- **Full-screen voice screen** (chat, all platforms; `voice-orb.js`, `voice-overlay.js`, `chat-voice.css`): blurred
  dark backdrop, a large orb that breathes and follows the mic while listening, swirls while thinking and pulses
  while speaking; a short live caption (what was heard, then the reply); **Mute** and **End** in the footer, Esc to
  end, **Show chat** to hide it (the hands-free pill brings it back). Respects `prefers-reduced-motion`.
- Hands-free **Mute**: pauses listening without ending the session (`mute(on)`, phase `muted`).
- **Android "dynamic island" pill** (Colon AI app): with voice mode on and Colon in the background, a pill at the top
  centre over other apps shows a wave and "Listening…" / "Thinking…" / "Speaking". **Tap** → Siri-style full
  screen: the screen's rounded edges glow (display corner radius on Android 12+, 24 dp before), a voice wave along
  the footer, live caption, Mute / Open Colon / Close; tap outside or Close to collapse. **Hold or swipe** the pill
  to end. From the Quick Settings tile or the "Talk to Colon" shortcut, Colon steps back behind the pill.
  `VoiceOverlay`, `VoiceOverlayViews`, `VoiceMode`, `VoiceUiRules` (+ `VoiceUiRulesTest`).
- `VoiceService`: microphone foreground service so voice mode keeps listening in the background, with an ongoing
  "Colon voice mode" notification (Mute, End). The chat WebView is no longer paused while voice mode runs.
- Bridge command and feature `voice_ui` (`{state, caption, muted}`), event `voice_action` (`end|mute|unmute`).
- Permissions (colonai manifest): `SYSTEM_ALERT_WINDOW` ("Display over other apps", asked once with a prompt that
  opens its settings page; without it the notification is used) and `FOREGROUND_SERVICE_MICROPHONE`.
### Changed
- Android in-app updates: the update check runs at most every **15 minutes** instead of every 12 hours
  (`UpdateChecker.CHECK_EVERY_MS`), so the update prompt appears on the next app open soon after a release.

### Design (premium pass)
- New design tokens (type scale, 4/8 spacing, radii, layered shadows, surfaces, motion, focus ring) and one button scale.
- Pop-ups: bottom sheets with a grab handle on phones, a centred card on desktop, enter and exit animations,
  scroll lock; confirm dialogs with icon tiles; toasts with status icon and action.
- Projects redesigned: header with count and New project, colour cards with stats, empty state, skeletons, and a
  project page with Instructions, Chats, Files and Memories panels.
- History, Memory, Explore, Help, sidebar and messages polished; shared page header.
- Fixes: sheets close on page change; menus no longer double-bind on revisits; Memory badge without a limit.
## [0.19.0] — 2026-11-20 · Colon Music (OS Assistant step 3)
Colon AI on Android plays music and names songs, free tools only. See `docs/os-assistant/step-3.md`.
### Added
- **"play X"**: the phone's own songs (MediaStore, permission asked once), then the best **Jamendo** match (free CC
  music, new `GET /music/search`, needs the free `JAMENDO_CLIENT_ID`), then opens **YouTube**; "on YouTube" /
  "on Audiomack" open there; "play my music" shuffles the library. Media3 ExoPlayer in a `MediaSessionService`
  (`ColonMusic`, `MusicService`): notification, lock screen and headset controls, keeps playing in the background.
- **"what song is this?"**: Colon's player first (tags, or a fingerprint of an untagged file), the mic only when the
  player is idle. Fingerprints by vendored **songprint** (MIT, pure Kotlin, Shazam-compatible); only the signature
  goes to Shazam's public, unofficial discovery endpoint (no key). Replaces the planned Chromaprint+AcoustID and AudD.
- Bridge command and feature `music`, checked by `MusicRules` (allowlist; streams only from jamendo.com).
### Config
- `JAMENDO_CLIENT_ID` (optional; empty skips Jamendo).

## [0.18.2] — 2026-11-20 · Talk to Colon shortcuts
### Added
- **Talk to Colon** entry points (colonai flavor, `AssistTile.kt`) for phones whose assistant gestures stay with
  another app (Infinix XOS keeps the power key for Folax, and gesture navigation has no Home button): a Quick
  Settings tile (`AssistTileService`) and a launcher shortcut on the Colon AI icon (`AssistShortcut`, dynamic, so
  it can be dragged to the home screen). Both open the chat hands-free via `MainActivity.EXTRA_ASSIST`.

## [0.18.1] — 2026-11-20 · Voice mode button
### Changed
- Chat composer: with nothing typed or attached, the send button turns into a **voice mode** button (sound-wave
  icon) that starts hands-free conversation; tap it again (navy while on) or End on the pill to stop. The mic button
  and its language menu are unchanged. Web change; the 0.18.1 APK only carries the new version number.

## [0.18.0] — 2026-11-20 · Colon OS Assistant (steps 1 and 2)
Colon AI on Android can now be the phone's **assistant** and **control the phone** by voice or text. Free, on-device
Android APIs only; no new library, permission prompt or server change. Plan: `docs/os-assistant/plan.md`.
### Added
- **Default assistant** (`AssistActivity`, colonai flavor): answers `ASSIST` and `VOICE_COMMAND`, so Colon can be
  picked under Default apps › Assist & voice input; long-press Home or the assistant gesture opens the chat
  hands-free. Bridge feature/event `assist`, command `takeAssist`. See `docs/os-assistant/step-1.md`.
- **Phone control**: short commands ("open WhatsApp", "wifi settings", "torch on", "volume to 40%", "next song",
  "call 0803…", "text 0803… saying …", "alarm for 6:30 am", "timer for 5 minutes", "navigate to …", "open the
  camera") run through bridge command `phone`, checked by the native `PhoneRules` allowlist first. Calls and texts
  only open the dialler or Messages; the user taps Call or Send. See `docs/os-assistant/step-2.md`.
### Changed
- Chat sidebar: Saved, History, Settings and Help & Support left the sidebar nav (Settings and Help stay in the
  profile menu).

## [0.17.1] — 2026-11-19 · Image editing in chat
Members can now **change an image** instead of only making new ones: attach a photo and send `/image <what to
change>`, ask in their own words ("make the sky orange") with the image attached or after an image in the chat, or
tap **Edit** on an image Colon made. The source images go to the same `IMAGE_MODEL` as inline image parts before the
instruction. An edit costs exactly what a new image does (one plan image credit plus `BILLING_CREDITS_IMAGE`,
reserved, settled once saved, refunded on any failure). New images now come **free from Cloudflare Workers AI**
(`@cf/black-forest-labs/flux-1-schnell`) when its keys are set, with Gemini (`IMAGE_MODEL`) as the fallback. No
migration; four new optional environment keys.
### Added
- **`POST /conversations/:id/images`** takes **`attachment_ids`** (optional, up to 3): the user's own images in that
  conversation (an upload or an image Colon made there), or a fresh upload not yet sent in any chat (it then joins
  this chat and the new user message). PNG, JPEG or WebP only, at most 7 MB each, and the file must still be on disk.
  Checked before anything is written or reserved: another user's or another chat's image, a missing id, a PDF or GIF,
  a file that is too large or more than 3 ids answer **422 `invalid`** (field `attachment_ids`) with a plain message.
  Without `message_id` the new user message carries the images being edited. Edited files are named `edited-…` and
  record `edited_from` in their metadata.
- **Image adapter** (`modules/media/image.js`): `generate({ images })` sends them as `inlineData` parts before the
  text part; refuses more than 3, or a wrong type or size, without calling Google.
- **Chat model**: `generate_image` gains an optional `edit` (boolean). The stream's `image` event carries
  `attachment_ids`: the editable images on the user's latest message always go along (an edit, or a reference),
  and with `edit: true` and none there, the most recent image earlier in the chat. A generated image with no text
  now stays in the model's history ("(Here is the image.)" plus its attachment line), so "make it brighter" after an
  image works.
- **Chat app**: `/image <prompt>` sent with images attached is an edit of them (other file types: a toast, nothing
  sent); **Edit** on an image reply pre-fills `/image ` with that image as the source (a small "Editing …" strip above
  the composer, with Cancel; it is dropped when you switch chats); the pending reply says **"Editing your image…"**.
- **Cloudflare Workers AI image provider** (`modules/media/cloudflare.js`): `POST
  https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_IMAGE_MODEL}` with `{ prompt, steps }`
  (4 steps, at most 8), Bearer `CF_AI_TOKEN`; reads the base64 `result.image` (or raw `image/png` / `image/jpeg`
  bytes) and checks the bytes really are an image. HTTP 429 or error 3036 (the daily free 10,000-neuron allocation
  is used up) is `image_daily_limit`.
- **Provider routing** (`modules/media/route.js`): new images go to the first provider (`IMAGE_PROVIDER`; empty =
  Cloudflare when `CF_ACCOUNT_ID` and `CF_AI_TOKEN` are set, else Gemini) and fall back to the other on any error
  except a refused prompt; one credit either way. Edits always use Gemini (flux-1-schnell is text-to-image only);
  without `IMAGE_MODEL` an edit fails with `image_edit_unavailable` ("Editing images needs a paid image model…") and
  is refunded. When the daily limit is hit and Gemini cannot make it either, the member sees "Today’s free image
  limit is reached. It resets at 00:00 UTC. Your image credit was given back." Generated images record their
  `provider` in the attachment metadata. `generate_image` is on with either provider.
- **Admin › Tools** / `GET /admin/tools`: new `image { provider, fallback, edits, cloudflare_model, gemini_model }`,
  shown in the page banner ("Image provider: Cloudflare Workers AI, falling back to Gemini. Edits: Gemini.").
- Tests: `tests/unit/media-cloudflare.test.js` (8: adapter request and decoding, binary answers, 429 and 3036,
  refusals, provider order, Cloudflare first, 429 fallback to Gemini, refund with the reset message, edits Gemini
  only and refunded without it), `packages/ui/test/admin-tools.test.js` (+1),
  `tests/unit/media-image-edit.test.js` (8: inlineData parts, adapter refusals, sources accepted and refused,
  metering and refunds, the model's edit sources and `image` event), `tests/security/image-edit.test.js` (2: foreign,
  missing and non-image ids refused before any write; another user's chat 404), `packages/ui/test/chat-tools.test.js`
  (+2: the `/image` edit plan and editable-image helpers).
### Config
- `IMAGE_PROVIDER` (`cloudflare` | `gemini`, empty = auto), `CF_ACCOUNT_ID`, `CF_AI_TOKEN` (secret), `CF_IMAGE_MODEL`
  (`@cf/black-forest-labs/flux-1-schnell`). API only; the cron env file does not need them.
### Deploy
- No migration: set the Cloudflare keys in Setup Node.js App, deploy and restart the API (image editing is on
  wherever `IMAGE_MODEL` is set). `version.json` moves to 0.17.1 (versionCode 1701, both APKs), so publish the v0.17.1 release with this deploy
  (`docs/runbooks/deploy.md`, Release notes: 0.17.1).

## [0.17.0] — 2026-11-19 · Tools and media (Blueprint step D, items 14–17)
Every server-side tool now goes through one **tool registry** (schema, risk, plan access, credits, timeout, consent),
and three member-facing tools arrive on top of it: **image generation** in chat (`/image …`, or the chat model's
`generate_image` tool), metered with the plan's image credits; **deep research**, a resumable background job on the
0.16.0 cron that searches, reads and posts a cited report to the chat (asks first, credits reserved at start and
refunded on failure or cancel); and a **Monaco code editor** for code blocks in Developer mode (editing only, no code
execution). Staff get **Admin › Tools** (read-only). Image generation is **off until `IMAGE_MODEL` is set**. Deep
research runs on the cron, so the cron env file now needs the AI and search keys too (`docs/runbooks/deploy.md`,
Release notes: 0.17.0).
### Added
- **Migration `0017_tools_research.sql`**: `colon_research_runs` (one row per deep research task: user, chat,
  progress message, question, language, status `queued` | `running` | `done` | `failed` | `cancelled`, stage `plan` |
  `search` | `read` | `write`, steps, hop, JSON state, the credit reservation's `request_id`, error, timestamps;
  `ON DELETE CASCADE` with the user). The registry and image generation need no tables (images are
  `chat_attachments`, image credits are `usage_events` under `image_credits`).
- **`modules/tools`** (D14): `registry.js` (one entry per tool: JSON-schema subset for arguments, risk `low` |
  `medium` | `high`, plans, plan entitlement, credits, timeout, consent, guests, model-callable, deferred, live
  on/off), `invoke.js` (the router: known and on → arguments → guests → plan → monthly count → consent → credits
  reserved → run with a timeout → settled, or refunded in full on any failure; follows `BILLING_MODE`; staff never
  gated or charged), `catalogue.js` (`web_search`, `web_research`, `read_url`, `extract_file`, `browse`, `read_page`,
  `stop_browsing`, `generate_image`, `deep_research`). Gemini function declarations for the chat model now come from
  the registry.
- **`modules/media`** (D15): image generation through Google AI Studio (`generateContent` with image output, the same
  key and base URL as the other Gemini calls, or the key saved in Admin › Models), model `IMAGE_MODEL` (no built-in
  id). One plan image credit plus `BILLING_CREDITS_IMAGE` Colon credits per image, refunded when no image comes back
  (provider down, unknown model, refused prompt, timeout, save failure). Images are stored like uploads and attached
  to an assistant message. **`POST /conversations/:id/images { prompt, message_id? }`** → 201 `{ user_message,
  message, conversation }` (a failed image is an assistant message with an error card; input goes through the safety
  check first). Rate limit 10 per 10 minutes per user.
- **`modules/research`** (D16): deep research as `research.step` jobs, one bounded step per job (plan the searches,
  one search per step, up to 3 pages read per step, write the report), the row saved after each step and the next
  step queued; a step that does not fit in what is left of the cron run's time limit is handed to the next run; a
  failing step is retried with backoff, then the run fails and is refunded; `research.sweep` (every cron interval)
  resumes or ends and refunds a live run whose job is gone. Needs consent (409 `consent_required` with the credit
  cost until the app sends `confirm: true`), the plan's `research_tasks` allowance and `BILLING_CREDITS_DEEP_RESEARCH`
  credits (reserved at start, settled when the report is posted). Endpoints: **`POST /conversations/:id/research
  { question, confirm }`** (6 per hour per user), **`GET /conversations/:id/research`**, **`GET /research/:id`**,
  **`POST /research/:id/cancel`** (owner only; another user's id is a 404).
- **Admin › Tools** (admin and Super Admin, 2FA; `GET /admin/tools`): each tool's risk, plans, entitlement, credits,
  timeout, consent and on/off (image generation shows off while `IMAGE_MODEL` is empty), with this worker's call
  counts. Read-only: the policy lives in `catalogue.js`, allowances in Admin › Plans.
- **Chat app**: `/image <prompt>` in the composer and the model's `generate_image` (stream event `image { prompt,
  message_id }`), image replies; a **Deep research** chip in Research mode (asks with the credit cost, shows progress
  in the thread, Cancel, the report replaces the progress message); in Developer mode an **Edit** button on code
  blocks opens Monaco (`monaco-editor` 0.52.2 from jsDelivr, loaded on first use; a plain textarea when the CDN is
  blocked, fails or is slow). No code runs anywhere (D17's sandboxed execution is later).
- Tests: `tests/unit/tools-registry.test.js` (7), `media-image.test.js` (6), `research-job.test.js` (6: consent,
  step by step to the report, restart and sweep, deferral near the time limit, retry then refund, cancel),
  `chat-tools-registry.test.js` (3), `tests/security/tools-media-research.test.js` (3: Admin › Tools access, signed-in
  only, cross-user 404), `packages/ui/test/chat-tools.test.js` (7), `admin-tools.test.js` (7).
### Changed
- The chat's browser tools (`browse`, `read_page`, `stop_browsing`), the page reader (`GET /browser/fetch`, now
  `read_url`) and file extraction (`extract_file`) run through `tools.invoke()`; behaviour for members is unchanged.
- **Android apps** (both): a launch splash with a "from Nifelux" footer (`SplashOverlay.kt`, `view_splash.xml`)
  instead of the load bar; Colon Browser's local home page no longer shows the page loading line, and the web boot
  screen (`packages/ui/js/colon/router.js`) shows the logo only, without the loading bar under it.
- **Cron dispatcher**: a run keeps claiming while jobs were due (a step-wise job queues its next step for now) until
  the queue is empty or the time limit is near; a handler gets the batch's `deadline`, and a job type's timeout may
  be a function (`research.step`: `RESEARCH_STEP_MS` + 10 s).
### Config
- `IMAGE_MODEL` (empty = image generation off), `IMAGE_TIMEOUT_MS` (90000), `BILLING_CREDITS_IMAGE` (0),
  `BILLING_CREDITS_DEEP_RESEARCH` (10), `RESEARCH_MAX_QUERIES` (4, at most 8), `RESEARCH_MAX_PAGES` (8, at most 20),
  `RESEARCH_STEP_MS` (35000; keep it under `JOBS_TIME_LIMIT_MS`).
### Deploy
- Take a database dump, deploy, then restart the API; `/health` → `database.migrations` should end with
  `0017_tools_research`. Add the AI, search and research keys to `/home/apparatu/.colon-cron.env` (deep research runs
  on the cron), set `IMAGE_MODEL` to turn images on, then check Admin › Tools, `/image` and one deep research run
  (`docs/runbooks/deploy.md`, Release notes: 0.17.0). `version.json` moves to 0.17.0 (versionCode 1700, both APKs,
  which carry the new splash), so publish the v0.17.0 release with this deploy.

## [0.16.0] — 2026-11-19 · Jobs and cron (Blueprint step C, items 11–13)
Background work now lives in a MySQL job table instead of in-process timers, so it survives Passenger idling or
recycling the API. A **cPanel cron job** runs `services/api/scripts/cron.js` every 5 minutes (configurable): it talks
to the database directly (no HTTP, so AfeesHost's ALTCHA cannot block it), claims a small batch of due jobs with a
lease, runs them, records the run and exits within a time limit. Failed jobs are retried with exponential backoff
and dead-lettered after a few tries. Saga's scheduled checks are jobs now; nothing changes for members (same times,
same "ran late" note, still run on the member's phone). Staff get **Admin › Jobs**. The cron command to add is in
`docs/runbooks/deploy.md` (Release notes: 0.16.0).
### Added
- **Migration `0016_jobs_cron.sql`**: `colon_jobs` (type, nullable user, JSON payload, status `queued` | `running` |
  `done` | `failed` | `dead` | `cancelled`, `run_at`, attempts / max attempts, `lease_token` / `lease_until`,
  `last_error`, nullable UNIQUE `idempotency_key`, `ref`, timestamps) and `colon_cron_runs` (runner, start,
  duration, claimed / done / failed / dead, error). Active Saga schedules get their next due time queued as a job.
- **`modules/jobs`**: `enqueue` (idempotent on its key; a cancelled job can be revived), `claim` (one guarded
  `UPDATE … SET lease_token` over due rows or rows whose lease expired, then a read-back by that token: two runners
  never get the same job), `complete` / `fail` (only with the runner's own token, so a runner whose lease ran out
  cannot overwrite the job), backoff `JOBS_BACKOFF_MS × 2^(n−1)` capped at 6 hours, dead-letter after
  `max_attempts`, `cancel`, `retry`, `runBatch` (handler timeout inside the run budget; jobs it cannot start in
  time are handed back untouched), a handler registry (`where: 'cron'` or `'phone'`, `every` for recurring system
  jobs, enqueued once per period), the dispatcher tick and the "cron last ran" status (warning after 3 × the
  interval). `memory-store.js` is the same store in memory for tests.
- **`services/api/scripts/cron.js`**: the CLI dispatcher (`--env <file>` or node's `--env-file`, `--quiet`; exit 0
  ok, 1 error, 2 hard time limit).
- **`POST /internal/cron/run`** (secondary): header `X-Cron-Secret` must match `CRON_SECRET` (constant-time); 404
  while `CRON_SECRET` is empty, 403 on a wrong secret, rate-limited, no session or CSRF header.
- **Job types**: `saga.schedule` (one due time of a scheduled check; runs only on the API worker that holds the
  member's phone and queues the next due time itself), `saga.schedules_ensure` (every active schedule has a waiting
  job), `chat.reconcile` (a chat or Research reply cut off by a restart: the message is marked interrupted and its
  reserved credits are refunded, or settled when text was saved; follows `BILLING_MODE`), `jobs.prune` (daily).
- **Admin › Jobs** (admin and Super Admin, 2FA): counts by status and type, stale leases, dead letters, recent jobs
  filtered by status and type, recent cron runs, a banner when the cron never ran or its last run is older than
  3 × `JOBS_CRON_INTERVAL_MIN`, and Retry / Cancel with a reason. API: `GET /admin/jobs?status=&type=&limit=`,
  `POST /admin/jobs/:id/retry {reason}`, `POST /admin/jobs/:id/cancel {reason}`, audited as `admin.job_retried` /
  `admin.job_cancelled` with the acting admin and the reason.
- Tests: `tests/unit/jobs.test.js` (8: idempotent enqueue, lease overlap, the SQL claim, backoff and dead-letter,
  timeouts, restart survival, cron tick and last-run warning, admin view), `tests/unit/jobs-reconcile.test.js` (1),
  `tests/security/jobs-admin.test.js` (3: permissions, audit with reason, trigger secret); `saga-plans.test.js` now
  covers the schedule jobs (re-enqueue, pause / resume / delete, no double run, ensure).
### Changed
- **Saga schedules** (`saga/schedule-jobs.js`, `schedules.js`, `runner-extra.js`): create, pause / resume, run now
  and delete keep the schedule's one waiting job in step; the runner's light tick (only while a phone is connected
  to that worker) runs that phone's due `saga.schedule` jobs instead of scanning `saga_schedules`, and every ~5
  minutes makes sure each of its schedules has a job. A due time is still claimed atomically on `next_run_at`, so
  it runs once even across an old and a new release. `schedules.tick` is replaced by `claimDue` and `active`.
  Routines are unchanged (they run on demand, never on a timer).
- **Billing**: `staleReservations` (store and engine) for `chat.reconcile`.
### Config
- `JOBS_CRON_INTERVAL_MIN` (5), `JOBS_BATCH_SIZE` (10), `JOBS_TIME_LIMIT_MS` (50000), `JOBS_LEASE_MS` (300000),
  `JOBS_MAX_ATTEMPTS` (5), `JOBS_BACKOFF_MS` (60000), `JOBS_KEEP_DAYS` (14), `JOBS_INPROCESS` (`off` | `on`, default
  `off`), `CRON_SECRET` (secret, empty = trigger off).
### Deploy
- Take a database dump, deploy, then restart the API; `/health` → `database.migrations` should end with
  `0016_jobs_cron`. Create the cron env file and add the cron job (exact command in `docs/runbooks/deploy.md`,
  Release notes: 0.16.0), run it once by hand, then check Admin › Jobs. `version.json` moves to 0.16.0
  (versionCode 1600, both APKs; the apps are unchanged), so publish the v0.16.0 release with this deploy.

## [0.15.0] — 2026-11-18 · Memory and projects (Blueprint step B, items 9 and 10)
Signed-in members can now let Colon remember things and group their work into projects. **Memory is off until each
member turns it on** (Settings › Memory, with a plain notice of what it does): the blueprint does not ask for it on
by default, so it is opt-in. Colon only keeps what the member writes there or asks for in a chat ("remember that
…"); it never saves anything on its own. Relevant memories are added to replies by keyword overlap and recency
within a token budget (no vector database). A **project** has a name and instructions, and holds chats, files and
memories; its instructions, file text and memories go into every reply in it. How many projects a member may have
comes from their plan (`projects` entitlement: Free 2, Startup 5, Pro 15, Pro Plus 30, Max 100), enforced only when
`BILLING_MODE=enforce` (shadow, today, allows and logs). Guests and temporary chats are unchanged.
### Added
- **Migration `0015_memory_projects.sql`**: `colon_projects` (id, user, name, instructions), `colon_memories`
  (user, nullable project and chat, scope `user` | `project` | `task`, content ≤ 1,000 characters, source
  `settings` | `chat`; deleting is a hard `DELETE`, and a user, project or chat takes its memories with it),
  `colon_memory_consent` (no row = off), and `project_id` on `chat_conversations` and `chat_attachments`
  (`ON DELETE SET NULL`: deleting a project keeps its chats and files).
- **`modules/memory`**: consent, list / add / edit / delete / delete all, scopes checked against the member's own
  project or chat, a per-member cap (`MEMORY_MAX_ITEMS`), `retrieve.js` (keywords in any script, stop words, scope
  and recency boost, greedy fill within `MEMORY_TOKEN_BUDGET`; a memory that does not fit is skipped, never cut),
  and `fromChat` for "remember that …" / "remember: …" (questions and "remember when" are ignored).
- **`modules/projects`**: CRUD, plan limit from `billing.planFor` (enforce: 402 `quota`, reason `projects`;
  shadow: allowed, `over_limit: true`, logged `projects_over_limit`; off and staff: no limit), project chats and
  files, and the context for replies.
- **Chat**: `chat/extra-context.js` adds the project's instructions, its file text (fenced as untrusted, 8,000
  characters in all) and the member's memories (only with consent) to the system context of every signed-in reply.
  `POST /conversations` and `PATCH /conversations/:id` take `project_id` (the member's own project, or `null` to move
  a chat out); `GET /conversations?project_id=` filters; `POST /uploads` takes a `project_id` field. A message that
  saves a memory adds a `memory` event to the stream.
- **Routes** (signed in, every statement scoped to the member; another member's id answers 404): `GET /memory`,
  `PUT /memory/consent`, `POST /memories`, `PATCH /memories/:id`, `DELETE /memories/:id`, `DELETE /memories`,
  `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`, `DELETE /projects/:id`. Consent
  changes, clearing memory and project create / delete are audited.
- **Chat app**: Memory screen (`#/memory`: on/off with the notice, add, edit, delete, delete all), Projects
  (`#/projects`: list with the plan's limit, create, rename, delete) and a project page (`#/p/:id`: instructions,
  chats, New chat, files, project memories), a Projects link in the sidebar, "Move to project" in a chat's menu, a
  Memory and projects section in Settings, and a "Saved to memory" toast. The welcome banners moved to
  `components/notice.js` (no change).
- **Admin › Users**: a member's page shows their project and memory counts (never a memory's text).
- Tests: `tests/unit/memory.test.js` (9), `tests/unit/projects.test.js` (5),
  `tests/security/memory-projects-ownership.test.js` (6).
### Config
- `MEMORY_TOKEN_BUDGET` (500 tokens of memories per reply, ≈ 4 characters a token; 0 = none), `MEMORY_MAX_ITEMS`
  (200 per member).
### Deploy
- Take a database dump, deploy, then restart the API; `/health` → `database.migrations` should end with
  `0015_memory_projects`. Nothing to set (the defaults are fine). `version.json` moves to 0.15.0 (versionCode 1500,
  both APKs; the apps themselves are unchanged), so publish the v0.15.0 release with this deploy. Check steps:
  `docs/runbooks/deploy.md` (Release notes: 0.15.0).

## [0.14.0] — 2026-11-17 · Admin plans, credits and costs (Blueprint steps A6 and A7)
Staff can now run the business side from the Admin Dashboard: edit plan prices and monthly allowances, look up any
member's plan, balance and ledger, grant or revoke credits, set or comp a plan, list payments, and see what the AI
costs per day, model, plan and member. Every change is admin / Super Admin only, needs a reason, and is written to
the audit log with the acting admin. Each provider call now records who asked, their plan, the tokens the provider
reported and its cost in kobo. Prices default to 0 (the free tiers in use today), so spend reads ₦0 until
`AI_MODEL_COSTS` is set; tokens are counted either way. A daily spend alert can be switched on; it only warns and
never blocks a reply. Nothing changes for members.
### Added
- **Migration `0014_admin_billing.sql`**: `ai_calls` gains `user_id`, `plan_code`, `input_tokens`, `output_tokens`
  and `cost_minor` (kobo, `DECIMAL(14,4)`: one call is usually a fraction of a kobo), plus an index on
  `(user_id, created_at)`. Older rows keep the defaults.
- **Cost logging** (`modules/ai/costs.js`, `calls.js`, `hedge.js`): the winning attempt keeps the provider's token
  counts (`usage`), which now also reach `billing.settle`; every `ai_calls` row is priced from `AI_MODEL_COSTS`
  (`"provider:model"`, then `"model"`, then `"provider:*"`). Chat and the Study CBT log the signed-in user.
- **`modules/billing/admin.js`** (+ `admin-store.js`): plan edits (Free stays ₦0 and on; the plan cache is cleared
  at once), manual credits as one ledger entry of kind `grant` or `revoke` in a locked transaction, idempotent on the
  admin's key and never below 0, set / comp a plan for N days (subscription provider `admin`, credits topped up like
  an upgrade; Free cancels), payments by status, and costs per UTC day, model, plan and top members with today's
  spend against the cap (warn at 80 %, over at 100 %).
- **Admin API** (admin and Super Admin, 2FA, audited with the reason): `GET /admin/billing/plans`,
  `PATCH /admin/billing/plans/:code`, `GET /admin/billing/users/:id` (id or email),
  `POST /admin/billing/users/:id/credits {amount, reason, key}`, `POST /admin/billing/users/:id/plan
  {plan, days, reason, key}`, `GET /admin/billing/payments?status=`, `GET /admin/billing/costs?days=N` (1–30). Nobody
  changes their own credits or plan.
- **Admin pages**: Plans (prices typed in naira, stored in kobo; allowances), Credits (find a member, balance,
  ledger, grant / revoke / set plan with a reason and a confirmation; Payments tab), Costs (spend or tokens per day,
  per model, per plan, top members, the daily alert). The Overview shows a banner when today's spend passes 80 %.
- Tests: `tests/unit/billing-admin.test.js` (12).
### Config
- `AI_MODEL_COSTS` (JSON, kobo per 1M tokens, `{"model": [input, output]}`; empty = every model costs 0),
  `BILLING_DAILY_SPEND_CAP_MINOR` (kobo, 0 = no alert; display only).
### Deploy
- Take a database dump, deploy, then restart the API; `/health` → `database.migrations` should end with
  `0014_admin_billing`. Optional: set `AI_MODEL_COSTS` for any paid model and `BILLING_DAILY_SPEND_CAP_MINOR` in
  cPanel → Setup Node.js App → environment variables, then restart. Staff need 2FA to open the new pages.

## [0.13.0] — 2026-11-17 · Korapay payments and the plan page (Blueprint steps A5 and A8)
Signed-in users can now see their plan and this month's credits, and buy a paid plan with **Korapay** (card or bank
transfer). A plan is only granted after the server has asked Korapay for the charge and checked the exact amount and
currency; the browser's word and the webhook's body are never trusted on their own. Plans are bought one period at a
time (30 days, no automatic renewal); paying again for the same plan adds another period. Upgrading tops up this
month's credits by the difference between the two plans. Payments stay **off** until `KORAPAY_SECRET_KEY` is set.
### Added
- **Migration `0013_payments.sql`**: `payments` (our own unique reference, pending → success | failed | abandoned,
  amount in kobo, checkout URL, fee, failure reason) and `payment_events` (webhook audit, signature result). Sets the
  monthly prices: Startup ₦7,000, Pro ₦21,000, Pro Plus ₦53,000, Max ₦125,000 (only where the price is still 0, so
  later admin edits are kept).
- **`modules/payments`**: Korapay client (`POST /charges/initialize`, `GET /charges/:reference`), HMAC-SHA256
  webhook signature check (`x-korapay-signature`, constant-time), checkout / confirm / webhook / status / history.
  Confirm runs once per reference inside a transaction.
- **Routes**: `POST /account/billing/checkout {plan}` (10 an hour per user), `GET /account/billing/payments/:reference`,
  `POST /payments/korapay/webhook` (no session, no CSRF header, signature required). Route option `csrf: false`.
- **`GET /account/billing`** now also returns `payments` (on/off), `subscription.period_end` and the last 5 payments.
- **Plan & credits page** (`#/account/plan`, linked from Profile): current plan, credits left this month with a
  meter, the plans with their prices and allowances, Korapay checkout, return handling (`?payment=korapay`), a
  "Check again" state for slow bank transfers, and recent payments.
- Tests: `tests/unit/payments.test.js` (10).
### Config
- `KORAPAY_SECRET_KEY` (secret, empty = payments off), `KORAPAY_API_URL`
  (default `https://api.korapay.com/merchant/api/v1`), `APP_URL_API` (default `https://api.apparatus.name.ng`),
  `PAYMENT_PERIOD_DAYS` (30).
### Deploy
- Take a database dump, deploy, then restart the API; `/health` → `database.migrations` should end with
  `0013_payments`. In the Korapay dashboard (Settings → API Configuration) set the webhook URL to
  `https://api.apparatus.name.ng/payments/korapay/webhook`, then add `KORAPAY_SECRET_KEY` in cPanel → Setup Node.js
  App → environment variables and restart.

## [0.12.0] — 2026-11-17 · Plans and credits (Blueprint steps A1–A3)
First slice of the Production Blueprint's business engine (`docs/blueprint-roadmap.md`, step A). Plans,
entitlements, subscriptions, a monthly credit wallet, an insert-only credit ledger and usage events, with credits
reserved before every signed-in chat reply and settled or refunded after it. Ships in **shadow** mode: credit use is
recorded but nobody is blocked, so real usage can be measured before quotas are switched on
(`BILLING_MODE=enforce`). Payments come later through **Korapay** (step A5; Paystack dropped). Guests keep the daily
limits; staff are never charged. The daily reply limits stay as an abuse guard.
### Added
- **Migration `0012_plans_credits.sql`**: `plans`, `plan_entitlements`, `subscriptions`, `credit_wallets`,
  `credit_ledger` (unique `ref`, `balance_after`), `usage_events` (unique `request_id`). Seeds Free, Startup, Pro,
  Pro Plus and Max with the blueprint's draft monthly quotas (AI credits 100 / 600 / 2,000 / 5,000 / 12,000; image
  credits, research tasks, background jobs, projects, memory tier). Prices stay 0 until Korapay is wired.
- **`modules/billing`**: `reserve` → `settle` | `refund`, idempotent on the request id (a retry is never charged
  twice), every change in one InnoDB transaction with the wallet row locked (`db.transaction`, new). A new UTC month
  expires what is left and grants the plan's credits again (no rollover). `checkQuota(user, feature)` for monthly
  counted features (used by later steps). `store.js` holds every billing SQL statement; `memoryStore()` for tests.
- **Chat** (`chat/reply.js`): after the daily limit, a signed-in reply reserves 1 credit (Research mode 3); settled
  when an answer reached the user, refunded when nothing did. In enforce mode an empty wallet ends the reply with
  the `quota` error ("You’ve used this month’s 100 Colon credits on the Free plan. They renew on 1 December.") before
  any provider call, and the daily counter is given back.
- **`GET /account/billing`**: plan, entitlements, this month's balance, renewal date, last 20 ledger entries and
  the plan list (for the plan page in step A8).
- Tests: `tests/unit/billing.test.js` (14), `tests/integration/billing-flow.test.js` (4).
### Config
- `BILLING_MODE` (`off` | `shadow` | `enforce`, default `shadow`), `BILLING_CREDITS_CHAT` (1),
  `BILLING_CREDITS_RESEARCH` (3), `BILLING_CREDITS_SAGA` (2, not charged yet).
### Deploy
- Take a database dump, then pull and restart the API server; `/health` → `database.migrations` should end with
  `0012_plans_credits`. Nothing else to set. `version.json` moves to 0.12.0 (versionCode 1200); the app itself is
  unchanged.

## [0.11.8] — 2026-11-17 · Gemini 4 Hydrogen joins the support models
Google put **`gemini-4-hydrogen`** on the Gemini API free tier on 12 Nov 2026 (checked on Google's pricing page on
2026-11-17), so it is now the fourth Google AI Studio support model after Gemma 4. Gemini 4 Argon and Gemini 4 Carbon
are paid-only ("not available on the Free tier"), so they are not added. API-only change: every version number moves
to 0.11.8 (`Colon.version`, `?v=` cache-busting, package.json files and the API's package-lock, which was still on
0.11.0) and `version.json` moves to 0.11.8 (versionCode 1108, both APKs) so `android-version.test.js` passes again
(0.11.7 had left it on 0.11.6). No migration.
### Changed
- **Support order** (`support.js`, `config/defaults.js`, `config/api.env.example`): `gemini-flash-lite-latest` →
  `gemini-3.5-flash-lite` → `gemini-3.8-flash` → `gemini-4-hydrogen` → Groq `openai/gpt-oss-120b` → OpenRouter free
  Gemma. Same `GEMINI_API_KEY`, nothing new to set.
- **Thinking level**: Hydrogen defaults to `"high"` and has no `"minimal"`, so it is sent `"low"` (already covered by
  `geminiBody`'s Gemini 4 rule).
### Deploy
- Pull and restart the API server. If its env sets `GEMINI_SUPPORT_MODELS` explicitly, append `,gemini-4-hydrogen`
  (or delete the line to use the default).

## [0.11.7] — 2026-11-16 · Gemini 3.8 Flash replaces Gemini 2.5 Flash
Google retires `gemini-2.5-flash` on 1 Dec 2026 (from then its requests are routed to `gemini-3.5-flash-lite`), so the
third Google AI Studio support model after Gemma 4 is now **`gemini-3.8-flash`** (stable, no shutdown date announced;
model id checked on Google's Gemini API models page on 2026-11-16). API-only change: every version number moves to
0.11.7 (`Colon.version`, `?v=` cache-busting, package.json files); `version.json` stays on 0.11.6, so phones are not
offered an app update. No migration.
### Changed
- **Support order** (`support.js`, `config/defaults.js`, `config/api.env.example`): `gemini-flash-lite-latest` →
  `gemini-3.5-flash-lite` → `gemini-3.8-flash` → Groq `openai/gpt-oss-120b` → OpenRouter free Gemma. Same
  `GEMINI_API_KEY`, nothing new to set.
- **Thinking level**: Gemini 3.8 Flash rejects `thinkingLevel: "minimal"` (Gemma's default here) with an error, so it
  is sent `"low"`, its fastest level (`support.js` `geminiBody`; Gemini 4 and 3.1 Pro would get the same). A
  `GEMINI_SUPPORT_MODELS` that still names `gemini-2.5-flash` keeps `thinkingBudget: 0`.
### Deploy
- Pull and restart the API server. If its env sets `GEMINI_SUPPORT_MODELS` explicitly with `gemini-2.5-flash`, change
  it to `gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.8-flash` (or delete the line to use the default).

## [0.11.6] — 2026-11-15 · Saga login wait never sticks
Owner's report on 0.11.5 (Android): Saga was asked to log in to yolotask (the reviewer sign-in page). signIn answered
`no_login`, Saga showed the Colon Secured Login form and waited for Give back; the user filled it and SAVED it, and
Saga stayed stuck, and the next chat messages ("Login n", "Hi") got no reply at all. Three causes: the phone sent
Give back (`return_to_ai`) only when its card was already in `needs_user`, a state that arrives asynchronously from
the control state (or never, when it was lost), so the server waited the whole `SAGA_HANDOFF_TIMEOUT_MS`; every
message typed while a task was live was only queued for "Saga's next step", which never came while it waited; and a
saved login matched its exact host only. Every version number moves to 0.11.6 (apps, `Colon.version`, `?v=`
cache-busting, `version.json` versionCode 1106 for both APKs, the API's package.json and package-lock). No migration,
no new config key.
### Fixed
- **Saving the login form always resumes Saga** (Android `LoginWait`, `ChatBrowserPanel`, `MainActivity`). After the
  form of a login hand-over, Give back goes to the server whatever the card shows, with "Login saved for <site> in
  Colon Secured Login" (or "I didn't save a login."); a lost control state is put back first (0.10.4's
  `restoreWaiting`). A form whose callback was lost (the screen was rebuilt while it was open), a login saved from
  another form (the chat's card), and the app coming back with the login now in the vault resume it too.
- **Saga signs in at once** (`saga/saved-login.js` `forLoop().form`, `loop.js`): when Saga's own signIn answered
  `no_login`, the form's "Login saved" note (or a bare Give back) sends `sign_in` again straight away, with no model
  step in between; a closed form hands the sign-in to the user ("Sign in to <site> yourself…, then give it back").
  Only "I didn't save a login." skips the retry.
- **Server safety net** (`saga/login-wait.js`, `browser/bridge.js`, `control.js`, `frames.js`, `runner.js`): while
  the loop waits on the login form (hand-over kind `login`), a login saved on the phone through any path the bridge
  sees ends the wait: control `login_saved {site}` (a Give back with the saved note), or a "Login saved for …" note
  on any control frame, also one up to a minute before the wait began. When Saga lost control meanwhile it asks for
  it again the usual way.
- **Messages while Saga waits get a reply** (`apps/chat/src/lib/saga-route.js`, `actions/saga-wait.js`,
  `send-message.js`, `browser-chat.js`). While Saga waits for the user (the login form, a hand-over, Take control, a
  pause; from the card's state or the server's task status, whichever knows first) a message is a normal chat turn.
  "continue", "login", "try again", "I've saved it", "done"… carry Saga on (`return_to_ai` with the user's words; the
  phone turns them into "Login saved for <site>" when its vault has the login, so Saga signs in at once; `resume`
  after a pause) and "stop" / "cancel" stop it. The browse tool called meanwhile carries Saga on with its task as the
  user's words. While Saga works, messages still steer its next step (`guide`), now kept in the thread with a visible
  line instead of a toast only; `POST /browser/agent/:id/guide` answers 409 `waiting` while the task waits, and the
  app sends the message to the chat model instead. The chat model's browser state says "Saga is WAITING for a login
  on <site>" (or for the user, or paused) with what the user can say (`chat/browser-state.js` `task.waiting`).
- **A saved login matches its domain family** (Android `VaultRules.match`, `registrable`, `sameFamily`;
  `LoginVault.find`): the site's own entry, else the closest parent domain's (longest wins: a login for
  yolotask.com.ng signs in on reviewer.yolotask.com.ng), else a subdomain's when the parent is asked for (shortest,
  then newest); never a sibling, never across registrable domains (com.ng, co.uk… are suffixes). `pageMatches` stays
  https-only and on the same registrable domain (and no longer accepts a bare suffix as a site). The form edits the
  exact entry (`LoginVault.exact`); the one-time approval is stored on the entry's own site. No site-specific rules.
- **The waiting card and note show what to do**: the card's pill (and the chat's card header, control `login`) offers
  **Save login** (reopens the form: `browser('control', {op: 'login_form'})`, app feature `loginWait`) and Stop; the
  thread note "Saga is waiting for a login" has [Open the login form] · [Stop Saga] links (`#colon-login`,
  `#colon-stop`), and a hand-over note has Stop.
- Tests: `saga-login-wait.test.js` (end to end on the bridge: `login_saved` ends the wait and Saga signs in at once,
  the safety net on another control frame, a closed form hands the sign-in over, a bare Give back, guide 409 while
  waiting, the browser state), `saga-0110.test.js` (signed in at once after the form), `saga-route.test.js` (routing
  while waiting vs working), `card-chrome.test.js` (the login control); Android `VaultRulesTest` (domain matching),
  `LoginWaitTest` (Give back whatever the card shows, notes, the login pill).

## [0.11.5] — 2026-11-15 · Browser follow-ups via tool routing: the chat model decides when to browse
Owner's spec: after a browser task, follow-ups like "go to Colon repo", "open it", "click the second one" or "check my
orders" often went to plain chat instead of Saga, or Saga handed the step back to the user, because routing was guessed
from keywords (`apps/chat/src/lib/browser-intent.js`, `services/api/src/modules/chat/browse-follow.js`). Now: one
model, with the browser as a tool. Every version number moves to 0.11.5 (apps, `Colon.version`, `?v=` cache-busting,
`version.json` versionCode 1105 for both APKs, the API's package.json and package-lock). No migration. New config keys
(all optional): `CHAT_BROWSER_TOOLS`, `CHAT_TOOL_MODEL`, `CHAT_TOOL_FALLBACK_MODEL`, `CHAT_TOOL_TIMEOUT_MS`.
### Changed
- **The chat model has browser tools** (`modules/chat/browser-tools.js`, `modules/ai/tool-call.js`). Gemini function
  declarations on every turn, in every specialist mode (the mode and its instructions never change):
  `browse(task, item?, url?)` starts or continues Saga in this chat's browser session (SSE `browse`, the app's live
  card opens under the user's message every time), `read_page()` answers from a short summary of the current page,
  `stop_browsing()` closes the browser (SSE `browser {op: 'close'}`). Google AI Studio's native
  `streamGenerateContent` with tools: `CHAT_TOOL_MODEL` (default gemini-3.5-flash-lite), then
  `CHAT_TOOL_FALLBACK_MODEL` (default gemma-4-26b-a4b-it: Gemma 4 supports native function calling on the Gemini API,
  ai.google.dev/gemma/docs/core/gemma_on_gemini_api). Text streams as the reply; function calls keep their Gemini 3
  `thoughtSignature` for the next round. A turn that only browses keeps no assistant message (`done {dropped}`).
- **Browser state in context** (`modules/chat/browser-state.js`). When the chat has a browser session (the page the
  app sent, or a Saga task in this chat within 6 hours), the system prompt holds, fenced as untrusted: the URL and
  title, signed-in status (0.11.4's `signed-in.js` check on the page read), the last task and its last 5 steps (one
  line each; Saga's step lists are still never fed back as text), a page summary (≤ 1,500 characters) and the visible
  clickable items, numbered. `browse` with `item: n` gives Saga that item's text and address.
- **Keyword routing is only the fallback.** The app reads only the browser's own controls when signed in (open / close
  the browser, stop, take control, done, continue: `ctx.tools`); everything else goes to the chat model. The server's
  `browse-follow.js` (now also with 0.11.2's `needsBrowser` as `starts`) decides only when both tool models fail (no
  key, quota, errors before any text); the reply then comes from the usual `AI_MODEL_SET` chain, so nothing is worse
  than 0.11.4. `CHAT_BROWSER_TOOLS=off` restores the 0.11.4 routing.
- **Better page reading** (Android, `assets/saga/summary.js`, feature `pageSummary`, bridge action `page`): Mozilla
  Readability 0.6.0 (Apache-2.0) picks the main content and Turndown 7.2.5 (MIT) turns it into Markdown, both injected
  into the WebView in one function scope; pages that are not articles use the visible text of `<main>`. Each message
  carries it (`POST …/messages` `browser`), within 1.5 s.
- **Cookie banners clear with no model call** (Android, `assets/saga/consent.js`): Consent-O-Matic's rules (MIT, a
  curated 51 of ~200: the common consent platforms and big sites; detectors and reject methods only, built by
  `scripts/vendor-consent-rules.js`) run before Saga reads a page, rejecting every category and saving; Saga is told
  ("Colon closed a cookie banner"). The 0.11.2 pop-up handling ("Reject all" by Saga) stays the fallback.
- **Saga acts.** A finish that tells the user to tap, click or open something ("tap it yourself", "you'll need to
  click…", "Tap the repo to open it") is refused and sent back as an observation every time, also after the 3 usual
  refusals (the step limit still applies). `requestUserControl` is only for a password, code, card or PIN field, a
  captcha, a payment or a consent frame Colon can't read; "other" on a page without a secret field is refused. The
  prompt says so.
- **Vendored code** lives in `apps/android/app/src/main/assets/saga/vendor/<name>/` with its LICENSE file.
  `scripts/check.js` exempts `vendor/<name>/` from the size rules only (still syntax-checked) and fails when a vendor
  directory has no LICENSE (new rule 6).
- Tests: `chat-browser-tools.test.js` (GitHub → "go to Colon repo", Jumia → "open the second one", yolotask →
  "check my tasks", Developer mode chat vs browse, "in the logged in account", read_page / stop_browsing, the keyword
  fallback), `chat-tool-call.test.js` (native function calling, fallback model, a whole browse reply),
  `saga-acts.test.js` ("tap it yourself", hand-overs), `saga-phone-consent.test.js` (consent.js, summary.js, the
  vendored files), `browser-intent.test.js` (`ctx.tools`).

## [0.11.4] — 2026-11-15 · Saga no longer asks you to sign in when you already are
Owner's report on 0.11.3 (phone screenshot): "Login to GitHub" with github.com already signed in (the dashboard,
"Good evening, Nifeluxtech!", the repositories listed, no login form) ended with "Saga needs you: Your saved login
didn't get you in here. Sign in yourself (or enter the code), then tap Return to AI." Every version number moves to
0.11.4 (apps, `Colon.version`, `?v=` cache-busting, `version.json` versionCode 1104 for both APKs, the API's
package-lock). No migration, no API change, no new config key.
### Fixed
- **A sign-in was handed to the user on a signed-in page.** Saga called signIn on the dashboard; the phone's fill
  script found no login form there and answered `no_form`. The loop had already marked the site as "saved login
  tried", the answer reached Saga as a plain failure, and Saga's next sign-in request (requestUserControl) went
  straight to the hand-over with "your saved login didn't get you in" (`saved-login.js` `handoffMessage` only looked
  at the tried set, never at the page). Now (any site, `modules/saga/signed-in.js`):
  - the page is read before a sign-in hand-over and checked for a signed-in account: no password / code / card / PIN
    field, not a /login page, and an account or avatar menu, Sign out / Log out, "Signed in as …" or a greeting with a
    name (a greeting or account menu counts only when no Sign in / Log in button is shown);
  - already signed in: no saved login and no hand-over; a goal that is only "log in to <site>" ends as done with
    "You're already signed in to github.com as Nifeluxtech.", any other goal carries on (Saga is told);
  - `no_form` is not a failed login: the site is not counted as tried, and Saga is told to open the sign-in page;
  - a sign-in is handed over only when the page holds a secret field or is a sign-in page (after 2 refusals Saga may
    still hand over, with the plain message); "your saved login didn't get you in" only with a secret field there;
  - the finish check accepts a sign-in goal on a signed-in page ("go to GitHub and log in" on the dashboard).
- Tests: `saga-already-signed-in.test.js` (GitHub dashboard, Jumia account page, yolotask.com.ng dashboard, Google
  Account page; a real login form with the saved login, and the hand-over only when it fails).

## [0.11.3] — 2026-11-15 · Follow-ups keep Saga working in the same browser
Owner's report on 0.11.2 (Infinix SMART 20, Developer mode): "Login to GitHub" worked, then "Go to Colon repo",
"In the logged in GitHub account", "Open the browser and check", "Go to the repository named colon ai" were answered
by the chat model ("provide the full URL"), with no browser and no card, and "Open the colon ai repository" ended
with "if you can see it, tap on it". Every version number moves to 0.11.3 (apps, `Colon.version`, `?v=`
cache-busting, `version.json` versionCode 1103 for both APKs). No migration, no new config key; one new SSE event.
### Fixed
- **Follow-ups went to the chat model.** The chat only sent narrow commands to Saga ("go to <domain>", "search
  for…"); "go to Colon repo" named no domain or "site" word, so it fell through to Developer mode's model, which
  then imitated Saga's step lists from the history. Now, after a browser task in a chat (any site), a message that
  plausibly continues it is a Saga task in the same browser session (`browser-intent.js` `followUp`): open / go to /
  click / select / scroll / next / more, check / find / look for / read, "that one", "the second result",
  "continue", "open the browser and check…", and a fragment like "in the logged in account" (read with the
  previous message). Code and explain requests stay chat. The chat's specialist is kept: a browsing follow-up in
  Developer mode is Developer + AI Browse. The follow-up continues the last task (`continue_of`), so Saga starts from
  what it already did, on the page it left.
- **Server-side guard.** `POST /conversations/:id/messages` sends the same follow-ups (a browser turn among the last
  6 messages) back to the app as SSE `browse {goal, message_id}` instead of calling the model
  (`modules/chat/browse-follow.js`), so routing no longer depends on the page alone. Saga's step lists are left out
  of the chat model's history.
- **No live card on follow-ups.** They never reached Saga; every follow-up now runs through the 0.11.2
  ensureChat / open path and shows the live card under the user's message (also for the server's `browse`).
- **Saga talked instead of acting.** A finish that asks the user to tap or click something Saga could do, or that
  only narrates ("I am attempting…"), is refused; a "go to / open <name>" goal needs that name in the page's address
  or title, matched loosely on any site ("colon ai" = colon-ai = colon_ai = ColonAI; a search results page doesn't
  count). Refusals before a finish is accepted: 3 (was 2). The rules, written out for Gemini 3.5 Flash-Lite: do the
  clicking, find loosely named things in elements → getLinks → scroll → site search → a guessed address, state the
  outcome in the past tense, and try at least 3 ways before giving up.

## [0.11.2] — 2026-11-14 · Saga clears pop-ups first, works faster, and Minimise really minimises
Owner's report on 0.11.1 (Infinix SMART 20, Colon AI app). Every version number moves to 0.11.2 (apps,
`Colon.version`, `?v=` cache-busting, `version.json` versionCode 1102 for both APKs). No migration, no API change,
no new config key.
### Fixed
- **Saga couldn't get past pop-ups** (Google's "Before you continue to Google" cookie dialog: Saga kept pointing at
  a result behind it, "I'm checking the current search results…", and got nowhere). The page snapshot listed
  elements in document order and stopped at 60, so the dialog's buttons (at the end of the page) were never seen,
  nothing said the results were covered, and the prompt told Saga that a cookie choice was the user's to make. Now
  the phone finds the topmost pop-up (new `assets/saga/overlay.js`: open `<dialog>`, role dialog / alertdialog,
  aria-modal, consent iframes such as consent.google.com, and fixed boxes on top at a few points of the screen,
  checked with `elementFromPoint`; a full-screen app shell is not one). `content` lists the pop-up's elements first
  (`in_popup`), marks what it covers (`blocked`, at most 15 of them) and says `overlay {label, kind, frame}`; `point`
  / `click` refuse an element behind it (`error covered`) before the pointer moves or anything is tapped. The server
  shows the pop-up to the model, refuses a click or fill on a blocked element without a round trip, explains a
  refused tap, and the rules say: pop-ups first; for cookie or consent banners "Reject all" / "Only necessary" /
  close unless the user asked to accept; a consent frame Saga can't read goes to the user (requestUserControl).
  A pop-up's decline or close button needs no approval (same list in `overlay.js` and `policy.js`, only inside a
  pop-up); "Accept all" in a form still asks. Secret-field refusals are unchanged and checked first.
- **Saga was slow.** Per step it waited for a model call that only said "getPageContent" after every page change,
  then a fixed 0.7 s after each tap (1.9 s when the page answered late), and load polls of 0.75 s. Now: the server
  reads the page for Saga after any step that opens, changes or scrolls it, or submits a fill, in every mode
  (`autoRead`, was speed mode only): one model call fewer per page change, typically 2–6 s each on Gemma's free
  tier; the tap's outcome is read at 150 / 350 / 700 ms and the wait ends at the first change (`SagaTap.QUICK_LOOKS_MS`:
  most taps save ~0.4–0.5 s); load polls every 350 ms (up to ~2.8 s); the screenshot tool is no longer offered (its
  picture never reached the model, so each one was a wasted step); page text from the phone is capped at 8,000
  characters (the server uses 6,000) and a pop-up's page behind it at 15 elements. Thinking stays `minimal`.
- **Minimise in full screen did nothing.** The full-screen view is placed exactly, outside `InlineSteady`, which
  still remembered the card's box as applied; on Minimise the card's box was "no move" (same as before), so the
  panel stayed full size with the card's "expand" button and no top bar (the owner's screenshot). Full-screen
  placements are now recorded (`InlineSteady.placedElsewhere`), so the card's box is applied again at once; a chat
  switch out of full screen re-places the panel too.
### Added (owner's later requests on 0.11.2)
- **Saved login first.** Before Saga hands a password field or sign-in page to the user, the server sends
  `sign_in {site}`: the phone fills the login saved for that site (Colon Secured Login, `LoginVault`) on a trusted
  https page after the user's one-time approval; with no login saved, the chat's Colon Secured Login form card is
  offered first and Saga signs in as soon as one is saved. "Take control" runs only when that doesn't get Saga in
  (form closed, untrusted or wrong site, fill failed, no `sign_in` capability, or a login already tried on this site
  in this task, such as a wrong password or a one-time code). Codes, cards and PINs are never tried
  (`modules/saga/saved-login.js`; the phone defers its own hand-over with `saved_login`).
- **Saga's pointer stays on while it works**, not only at a tap: shown on every command while Saga has the page,
  gliding between targets (longer trips take longer) and floating gently near the last one while Saga thinks or a
  page loads; still hidden on a secret field, Take control, Pause, Stop and when the task ends (`SagaPointer`).
- **Messages that need the browser open it by themselves** (`browser-intent.js` `needsBrowser`): a live web search
  ("search for…", "google…"), checking or visiting a named site or domain ("check yolotask"), signing in, filling a
  form, comparing prices, buying / booking / finding on a named site, and a question about a named site's live data
  ("how much is rice on jumia?"). Ordinary questions stay chat.
- **Past browser runs keep their cards for good, and the card is redesigned.** Every finished run stays under its
  message with its last picture and a summary row (site icon, domain, "Done · 5 steps" / "Stopped" / "Couldn't
  finish"); tapping it opens that run's steps (the app's timeline for the run it still holds, else the server's step
  list in a sheet). A chat keeps up to 200 cards and 60 pictures (was 20 / 6); a card past the picture caps keeps its
  summary row. Only the newest run's picture gives way to the live browser under the same message; an older run's
  card is never removed. The newest 8 pictures come with the card list, older ones one at a time
  (`browser('cardShot')`). The live card now has a slim header (site icon and domain, a status dot or spinner, a
  short task title, small icon buttons: Full screen / Minimise, Take control / Give back, Pause / Resume, Stop) and
  one status line under the page that crossfades between Saga's steps, light and dark from the Colon tokens
  (`lib/card-chrome.js`, `components/browser-chrome.js`, `chat-saga-card.css`). The page tells the app
  (`browser('chrome')`, feature `browserChrome`) so the big dark pill and corner button no longer float over the
  page in the thread; full screen keeps its top bar, pill and Minimise (`ChatCardRules.floating`). New bridge actions:
  `chrome`, `timeline`, `cardShot`.
### Tests
- `services/api/tests/security/saga-phone-overlay.test.js` (new fake DOM with stacking, `tests/helpers/fake-dom.js`),
  `tests/unit/saga-popups.test.js`, `saga-runner.test.js` (autoRead), `saga-saved-login.test.js`;
  `packages/ui/test/card-chrome.test.js` (new: header, buttons, status line, summary row, steps, 200 past cards kept),
  `browser-intent.test.js` (needsBrowser), `browser-opener.test.js` (an older run's card is never erased); Android
  `InlineSteadyTest`, `FocusRulesTest` (minimise round trip, a clear page under the chat's chrome), `SagaTapTest`
  (quick looks, pointer glide), `ChatRunTest` (card caps, steps and site round trip).

## [0.11.1] — 2026-11-14 · The browser card appears where you opened it, and full screen has a way back
Owner's report on 0.11.0 (Infinix SMART 20, Colon AI app). Every version number moves to 0.11.1 (apps,
`Colon.version`, `?v=` cache-busting, `version.json` versionCode 1101 for both APKs). No migration, no API change.
### Fixed
- **"Open browser" showed no card until you left the chat and came back.** The page told the app which chat is on
  screen (`browser('chat')`) once per chat and never again, so when that call was lost or the app switched chats by
  itself, every state named another chat and `liveHere` hid the card. The page now checks each state against the
  chat on screen and tells the app again (at most twice per chat, one call at a time: `needsChatResync` in
  `lib/native-panel.js`, `healChat` / `ensureChat` in the new `components/browser-chats.js`), and every open from
  the chat (the instruction, the Browser button, `openBrowser`) makes sure the app shows this chat's browser first.
  The card shows at once under the instruction, moves under the reply when it lands, and the anchor reports again
  (`createAnchor().force()`).
- **The card came back at the bottom of the thread, next to an old task's picture (a duplicate).** The reply that
  opened the browser was kept in memory only and dropped whenever the chat changed, so after coming back the live
  card fell back to the last task's message (beside that task's "Done" picture, whose id didn't always match the
  task) or to "now", which followed every new message to the bottom. It is kept per chat in the page's storage now
  (`lib/browser-opener.js`), and `liveSpot` (`lib/saga-card.js`) places the card: a running task keeps its message;
  an idle browser goes under the reply that opened it; after a task ended it takes that task's place and replaces
  its picture (`layout(…{ replaces })`), so there is one browser card per chat; never "now".
- **Full screen had no way back to the card.** The corner button stays in full screen as **Minimise** (where the
  finger already is), beside the top bar's "back to the chat"; the phone's **Back** collapses full screen first,
  also in the stacked FULL layout, where 0.11.0 walked the page's history first and the card's collapse did nothing
  because it only checked the inline view (`FocusRules`, `ChatBrowserPanel.setFocus` / `handleBack`). The app's
  `focus` state covers both layouts, and the page re-reports the card's box when full screen ends, so the card is
  re-attached in place; the overlay watch and steady scrolling work as before.
### Tests
- `packages/ui/test/browser-opener.test.js` (opener store, `liveSpot`, `layout` replaces, `needsChatResync`),
  `native-anchor.test.js` (`force()`), Android `FocusRulesTest`.

## [0.11.0] — 2026-11-14 · Saga grows up: timeline, Colon Secured Login, approvals, background, schedules
Every version number moves to 0.11.0 (apps, `Colon.version`, `?v=` cache-busting, `version.json` versionCode 1100
for both APKs). **Migration `0011_saga_schedules_routines.sql`** (scheduled checks and routines). Design and limits:
[ADR 0007](docs/decisions/0007-phone-vault-and-scheduling.md).
### Added
- **Step timeline**: tap the browser card (or ⋮ › Steps) for every step Saga took, with a small picture of the page
  after it. Typed values that look secret (password fields, password-like strings, card numbers) show as
  `•••• (n characters)`; pictures stay on the phone (`StepLog`, `TimelineSheet`).
- **Colon Secured Login**: saved site logins live only in the phone's vault (Android Keystore AES-GCM,
  `LoginVault`), entered in a native secure form (`LoginFormActivity`, `FLAG_SECURE`, no autofill to the page).
  Saga's `signIn {site}` makes the phone fill the page itself (`assets/saga/login.js`) on a trusted **https** page of
  that site after the user's one-time approval; the server and the model see only `{site, login_saved}` and
  ok / `no_login` / `not_trusted` / `wrong_site`. Settings › Saga › Saved logins (`VaultActivity`) lists and deletes
  them. In the chat, "save my github login" opens the card; a message that looks like a password is held back with
  a warning and the secure card instead (`lib/secret-text.js`). On the plain web the card explains logins are saved
  only in the Android app, with the download link.
- **Approval before submit, pay, delete or send**: risky steps wait for the user's yes on the phone (a notification
  when the app is in the background).
- **Background runs**: a running task keeps going while Colon AI is in the background (`SagaService`, an ongoing
  notification), with a notification when it is done or needs you.
- **Scheduled browsing** ("check yolotask every morning and tell me what's new"): the server keeps the schedule and
  asks the phone to run it in that chat's browser; results come back to the chat with what changed. **Routines**:
  "save this as a routine called daily update", then "daily update" replays it. Settings › Saga lists, pauses,
  runs and deletes them.
- **Mid-task steering**: a message sent while Saga works goes to the running task (`/browser/agent/:id/guide`) and
  is taken into account at its next step.
- **Multiple tabs** (at most 6), **extract to a table** in the chat with a **CSV download** (`lib/table-csv.js`,
  spreadsheet-formula injection guarded), **speed mode** (fewer model calls for slow networks; Settings › Saga).
- **Support models after Gemma 4**, for chat replies and Saga's browser decisions: first three Google AI Studio models
  on the same `GEMINI_API_KEY` (`gemini-flash-lite-latest`, Google's alias for the newest Flash-Lite;
  `gemini-3.5-flash-lite`; `gemini-2.5-flash`), then Groq `openai/gpt-oss-120b`, then OpenRouter's free Gemma. Each
  Google model has its own free quota and rests on its own, so a 429 on Gemma does not skip them; they read images.
  **`gemini-2.5-flash` is deprecated** (Google: API access for existing users only; from 1 Dec 2026 its requests are
  routed to `gemini-3.5-flash-lite`): a "not found" / "not available" answer skips it for 24 hours without failing
  the reply. A short `Retry-After` is waited out once; prompts are trimmed to each provider's limits; Admin › Routing
  shows them.
- Server hints for `signIn` answers `not_trusted` (don't retry; let the user sign in) and `wrong_site` (open the
  site's own sign-in page first).
### Fixed
- **The browser card drew over the sidebar drawer, menus and sheets**: the chat now watches every overlay (drawer,
  menus, sheets, dialogs, pickers, scrims; `lib/overlay-watch.js`) and tells the app `browser('suspend', {on})`; the
  card hides until the last overlay closes.
- **The card shook while scrolling or touching**: anchor reports are coalesced to one per frame and snapped to
  whole device pixels (`lib/native-anchor.js`); the app places the card once per vsync with a dead band and a
  settle pass (`InlineSteady`), and a gesture that starts on the page no longer fights the thread's scrolling.
### Config (cPanel › Node.js app › Environment variables)
New, all optional with working defaults: `AI_SUPPORT_MODELS`, `GEMINI_SUPPORT_MODELS`, `GEMINI_SUPPORT_VISION`,
`GEMINI_SUPPORT_UNAVAILABLE_REST_HOURS`, `GROQ_SUPPORT_MODEL`, `OPENROUTER_SUPPORT_MODEL`,
`GROQ_SUPPORT_MAX_INPUT_TOKENS`, `OPENROUTER_SUPPORT_MAX_INPUT_TOKENS`, `GROQ_SUPPORT_REASONING`,
`AI_RETRY_WAIT_MS`, `SAGA_SCHEDULES_MAX`. Set **`GROQ_API_KEY`** and **`OPENROUTER_API_KEY`** for the support models
(without them only Gemma 4 answers). Run migration 0011 (deploy runs pending migrations; check `/health`).

## [0.10.6] — 2026-11-14 · Clean new chats, honest "done", Gemma 4 only, the assistant is Colon
Owner's report on 0.10.5 (Infinix SMART 20, Colon AI app). Every version number moves to 0.10.6 (apps,
`Colon.version`, `version.json` versionCode 1006 for both APKs). No migration. New config key `AI_MODEL_SET`
(default `gemma`: nothing to set on the server for the new behaviour).
### Root causes
- **Old browser card on a new chat**: on a chat switch the page asked the app for the chat's finished cards
  *before* telling it about the switch, so the app answered with the previous chat's cards (the yolotask picture,
  "Done", expand); and the live card was shown whenever the app's panel was open, whichever chat it belonged to.
- **False "I have reached the GitHub login page"**: Saga's `finish` was taken on its word. Its first decision was a
  finish (no navigation); the browser still showed yolotask, the card kept that page's picture, and with no written
  answer the reply was "I finished browsing but have nothing to report".
- **Stuck "Reconnecting to Saga…"**: the pill showed whenever the phone's link was not `BRIDGE_READY`. A socket that
  came back but whose bridge greeting was lost stayed `CONNECTED` while Saga's commands kept arriving, so the pill
  never cleared (the task itself carried on: the card showed GitHub's sign-in page).
- **"Always catching up"**: every reply raced two models at once (`AI_HEDGE=2`: Gemma 4 26B against MiniMax or
  another host) and specialist routing could put another model first; the browser agent's decisions went through
  the same chain. No judge/verifier model runs per reply; Research mode's optional query rewrite (one short call,
  4 s budget) goes through the same chain, so it is Gemma 4 too.
### Fixed / changed
- **A new or empty chat shows no browser card** (`lib/native-panel.js` `liveHere`, `browser-panel.js`,
  `browser-card.js`): the live card shows only when the app's state names this chat, and on an empty chat only
  while a task of its own runs or the user opened its browser with the Browser button. Cards are asked for after
  the app has switched (none for a new chat), a chat with no messages draws none, and `liveAnchor` is cleared when
  the chat changes.
- **Saga's finish is checked against the page** (`modules/saga/goal.js`, `loop.js`): a goal that names a site
  ("go to the GitHub login page") needs the current URL's host to match; a sign-in page goal needs a sign-in URL or
  title; a finish before any action, with no page to confirm it, is refused. A refusal goes back to Saga as an
  observation (logged as `goal_not_met`); after 2 refusals the finish stands, so no task is trapped. Saga's prompt
  says so.
- **The reply says what Saga did**: with no written answer it uses the result line, else Saga's words, else its
  last step ("Opened GitHub's sign-in page."), never "nothing to report".
- **A new task never shows the previous task's picture as its own** (Android `ChatRunKeeper.clearLive` /
  `livePicture`): the step picture is dropped when a task starts; a reloading page shows only this task's picture,
  and an ended card falls back only to it (blank rather than an older page).
- **The "Reconnecting to Saga…" pill clears** (Android): an open socket counts as linked (`ChatRun.linkUp`); any
  command, control request, hand-off or notice from the server marks the bridge ready; a finished step clears it;
  and it never stays longer than 90 s (the server's reconnect grace). It only ever shows on a running task, so a
  task end clears it too. "Retry" after an ended task is a continuation (unchanged) and now ends with a real reply.
- **Gemma 4 only** (`modules/ai/model-set.js`, `generate.js`; `AI_MODEL_SET=gemma|all`, default `gemma`): chat
  replies, CBT, Research's query rewrite and Saga's browser decisions use Gemma 4 26B on Google AI Studio, with Gemma
  4 31B only when 26B fails or times out, one model at a time (no hedging, no specialist reordering, no MiniMax,
  Qwen, DeepSeek, GLM or NVIDIA). Without a Google key, a non-NVIDIA Gemma 4 host is used; a config with no Gemma 4
  model at all keeps its own chain. `AI_MODEL_SET=all` restores the full table, hedging and specialists. Admin ›
  Routing shows the Gemma chain in force (`model_set`, `gemma_chain`).
- **The assistant is Colon; Saga is the model**: replies are signed "Colon" ("Colon is thinking…"), the model
  selector shows "Saga", the disclaimer reads "Colon can make mistakes…", errors and help say Colon, and the system
  prompt introduces Colon (asked about its model, it says Saga). Browse wording that is the model acting ("How Saga
  browsed", "Saga took too long to decide") stays. Model id `colon-saga` and stored keys are unchanged.
### Tests
- `model-set.test.js` (5), `saga-goal.test.js` (5), specialist-routing (Gemma-only case; the existing cases run with
  `AI_MODEL_SET=all`, as do the router, hedge, specialists, stream and admin-config suites), `native-panel.test.js`
  (`liveHere`), `ChatRunTest.kt` (`linkUp`); wording updates in chat, safety-guards and safety-flow tests.

## [0.10.5] — 2026-11-14 · "Show the browser" brings the live card to you
Chat page fix; the APK is rebuilt only to keep versions in step (`version.json` versionCode 1005).
### Fixed
- **"Reshow / open the browser" showed nothing.** The chat replied "Here's this chat's browser…" but the live card
  stayed under the old task's message far up the thread (and, with the panel already open, never scrolled into
  view). After a task ended, reopening now places the live card under that reply and scrolls it into view
  (`S.browser.liveAnchor`, `revealNext`); a running task keeps its own message. The old task keeps its picture card.

## [0.10.4] — 2026-11-14 · Saga's in-chat browser is robust and watchable
Owner's report on 0.10.3 (Android, Developer chat): after "Login" Saga asked them to sign in, but the card was blank
with "Saga stopped" and Retry; after logging in Saga "was unable to catch up"; "Reshow the browser" went to the
model, which said it couldn't; and Saga's pointer and taps could not be seen. ADR 0006 addendum. Every version
number moves to 0.10.4 (apps, `Colon.version`, `version.json` versionCode 1004 for both APKs). No migration.
### Root causes
- The server's waiting task was left in `handoff` with no end (admin replay: 2 rows, `request_user_control`
  `sign_in`): the worker holding it went away while it waited, and nothing picked it up again.
- A dropped socket ended a waiting task at once (`disconnected`), and a new socket refused the user's Give back
  (`needs_consent`: consent lived only on the old socket).
- An app closed or rebuilt mid-task lost its control state: the card turned into "Saga stopped (when the app
  closed)" and Give back was refused on the phone (ended as stopped); the live page had no picture, so the card
  showed white while it reloaded.
- "Reshow the browser" wasn't a browser intent, and the model's prompt didn't know about the in-chat browser.
- Saga's pointer sat under the card's controls, was small at card scale and faded 1.2 s after every tap.
### Fixed / changed
- **Tasks survive the socket and the worker** (`modules/saga/link.js`, `resume.js`): a dropped socket waits up to
  `SAGA_RECONNECT_GRACE_MS` (new, default 90000) for the same phone; the new socket takes over on this worker, or
  another worker adopts the task; workers stamp their tasks and adopt ones whose worker went quiet. Reads in flight
  are re-sent; actions are reported to Saga as "may or may not have happened". Every end now tells the phone.
- **Give back always works**: hello `resumable` keeps consent on a new socket; the app re-sends its latest control
  report after reconnecting; after the app was closed a known task waits for the user (Give back carries on) and
  the phone puts back a lost control state instead of ending the card as stopped. The chat page follows a live task
  again after a reload.
- **Continue**: an ended card whose page is still there shows Continue (reopens the live browser on its page and
  starts `POST /browser/agent { continue_of }`, which folds the earlier steps into Saga's prompt and stops the
  earlier task if it was still live). In the chat, "reshow / show / reopen / bring back the browser", "where is the
  browser?" open it, and "continue", "carry on", "I've logged in, continue" after a task ended continue it; none of
  these go to the model. The system prompt (all modes) says Saga can open the in-chat browser.
- **Watchable**: the pointer sits above the card's controls, 1.5× with a halo, stays on the page while Saga works,
  outlines the element it clicks or types into, and Saga types text out piece by piece (act.js `type`, then the
  exact fill). The pill says "Reconnecting to Saga…" while the link is down.
- **Never blank**: the card keeps the page's picture after every finished step (`ChatRunKeeper.saveLive`), shows it
  while the page (re)loads, uses it for the finished card when the live capture fails, and never keeps a picture of
  a page that hadn't painted.
- Admin › Browser shows waiting tasks and continuation rows by name.
### Tests
- `saga-reconnect-runner.test.js` (9: wait survives a drop, grace runs out, read re-sent / action not repeated,
  moved, adoption with history, orphans expire, `continue_of`, summary), `saga-phone-act.test.js` (`type`),
  `browser-intent.test.js` (reshow / continue), `ChatRunTest.kt` (restore, Continue, reconnecting, control state
  restore, hello `resumable`, pointer box, typing pieces, blank pictures).

## [0.10.3] — 2026-11-14 · Saga's browser is an AI-only card in the chat, with Take control
The owner's redesign of the in-chat browser (ADR 0006, `docs/decisions/0006-inline-ai-browser.md`): instead of a
second browser squeezed into the chat that the user could also drive, each Saga task is a "Manus-style" card in the
thread, always Saga's, and the user steps in only with Take control. Every version number moves to 0.10.3 (apps,
`Colon.version`, `version.json` versionCode 1003 for both APKs). No migration (the new task statuses fit the
existing `saga_tasks.status` column and the result line is read from the task's `finish` step).
### Changed
- **One card per Saga task, in the thread.** The card sits under the message that started the task and scrolls with
  the thread: a landscape (16:10) live desktop page scaled down, capped to fit above the composer, with a status pill
  (Saga's step with a spinner; "Saga needs you: …" with Take control; a check and the result line; an error with
  Retry; Stop while it runs) and an expand button. Only the newest task holds the live WebView; finished cards keep
  a small picture of the page (at most 6 pictures, 600 KB and 20 cards per chat) and a tap reloads the live page.
  Cards no longer jump: the chat page re-places them only when the cards themselves change, not on every page
  load or step (`components/browser-card.js`).
- **Always the desktop site.** A desktop user agent, wide viewport and a document-start script that keeps the page
  at `width=1280` (`DesktopView`; less on phones narrower than 320 dp).
- **Always AI-only.** The page takes the user's touches, scrolls and keys only after Take control. The "AI only /
  AI + me" choice is gone from Settings and from the browser's status dialog; "let me help" in the chat explains
  Take control instead of switching modes. Colon Browser keeps its own modes.
- **Take control opens full screen over the chat**, the same WebView (no reload) from the top of the screen to the
  top of the composer, which stays pinned and follows the keyboard. A slim bar has back, title and host, reload,
  Give back to Saga and a more menu (Stop, Open in Colon Browser, share, downloads, clear data). Whatever the user
  sends from the composer is their hand-back: it goes to Saga as a note ("I've logged in, continue") with the page's
  host and path and anything secret-looking hidden (`HandoffNote`; the server hides it again).
- **A task started from the chat is the user's consent** for that chat: no "Let Saga browse?" dialog. A task the
  server starts any other way still asks.
- **The server waits instead of ending.** Take control and Pause no longer end a task (`interrupted`): the loop waits
  (task status `user_control` / `paused`) for Give back / Resume and folds the user's note into the next step. Time
  spent waiting for the user doesn't count against `SAGA_TASK_TIMEOUT_MS`. A wait that runs out stops the task
  cleanly (`handoff_timeout` / `user_timeout`; the phone gets `control manual` and a `stopped` notice).
- **The web shows the same card shape** with the task's status or result and "Open in the Colon AI app for the live
  browser" (no snapshot: the server keeps no page pictures). `GET /browser/agent?conversation_id=` lists one chat's
  tasks with `conversation_id` and `result`.
### Added
- **`requestUserControl { reason, instructions }`**, a new Saga tool to hand the browser to the user for a sign-in,
  code, captcha, payment or consent (a `handoff` frame with `timeout_ms`; "Saga needs you" with Take control).
  `finish` takes a short `result` for the status pill. Secret fields still hand over by themselves.
- **`SAGA_USER_CONTROL_TIMEOUT_MS`** (default `900000`, 15 minutes): how long Saga waits for the user to give the
  browser back after Take control or Pause before it stops the task. Saga's own requests keep
  `SAGA_HANDOFF_TIMEOUT_MS` (10 minutes).
- Stop in the card's more menu while Saga runs; a notification (channel `saga`) when Saga needs the user and the app
  is in the background.
- If the app is killed mid-task the card shows "Saga stopped when the app closed" with Retry; a dropped connection
  ends the server's task (`disconnected`) and the card offers Retry, which runs the same goal under the same message.
- Docs: ADR 0006, `docs/android-bridge.md` (`browser('task' | 'cards' | 'control')`, `run` and `focus` in the state,
  `browserRetry`, `note` on `control`, the new `handoff` kinds and `timeout_ms`, `notice` kinds `error` · `stopped`).
- Tests: `services/api/tests/unit/saga-user-control.test.js`, `saga-user-control-runner.test.js`,
  `packages/ui/test/saga-card.test.js`, `ChatRunTest.kt`.

## [0.10.2] — 2026-11-14 · Saga really clicks, types and scrolls; AI only locks the page; AI + me shows Saga's words
The owner's report from the phone (Colon AI, in-chat browser): the browser panel covered the message box while
scrolling, Saga's touch and pointer did not work, "AI only" still let the user's fingers in, and "AI + me" showed
nothing of what Saga was doing or asking. Every version number moves to 0.10.2 (apps, `Colon.version`,
`version.json` versionCode 1002 for both APKs). No migration.
### Fixed
- **The browser never slides over the composer.** Two causes. (1) When the chat shrank (the keyboard opening, the
  composer growing to two lines), the app re-laid its views a frame or more before the chat page reported the new
  composer position, and the clip then ran to the bottom of the shrunken layer, right over the message box
  (`InlineGeometryTest` even described it: "the clip stops at the layer's bottom"). The anchor now carries
  `pageHeight`, and the app keeps the gap the page saw under the band from the WebView's bottom as it is now
  (`InlineGeometry.place(…, shellHeight)`). (2) The anchor's numbers were relative to the layout viewport, not the
  visual viewport the app's WebView shows; with the visual viewport moved (the frame follows it with `--vvt`) the
  panel and its clip landed lower than the composer. Numbers are now measured from the visual viewport's corner,
  with its scale in `dpr` (`lib/native-anchor.js` `screenOf`). The composer is looked up on every measure (a
  re-drawn composer still counts) and its "Latest" button ends the band too.
- **A shorter panel.** The in-thread body box is 50vh (was 60vh, about a sixth shorter), never taller than the space
  between the header and the composer, at least 240 px (was 320 px), so the whole page fits above the message box
  with the keyboard open or not.
- **Saga types for real.** `fill` set the value with the native setter and fired bare `input` / `change` events,
  then answered `ok` without checking; rich editors (`contenteditable`) and sites that listen for `beforeinput` /
  `inputType` ignored it. New `assets/saga/act.js`: focus, select what is there, `execCommand('insertText')` (the
  browser's own editing path), falling back to the native setter plus an `InputEvent`; `<select>` by option text;
  Enter submits the form only when the page did not handle Enter itself. `ack.result.typed` says whether the text
  is really there and the model is told plainly when it is not.
- **Saga scrolls for real.** `scroll` was `window.scrollBy`, which does nothing on the many sites whose page is one
  screen with a scrolling container, and always answered `ok`. Now a real finger swipe with the pointer riding
  along, checked before and after; when nothing moved (or for top / bottom) the scrollable element under the middle
  of the view, or the page, is scrolled by script. `ack.result.moved` tells the model when it is already at the end.
- **A tap that did nothing is tried once more.** When a real tap changes nothing at all, the script click follows
  once (`method: "tap+script"`), never for a step the user had to approve (payments, purchases, messages, forms).
- **Long page reads are no longer lost.** An ack over the server's 64 KB frame limit (long text, many long links)
  was refused by the server and the step timed out, so Saga had no element ids to click; the phone now trims it
  (`BridgeProtocol.fitAck`).
- **"AI only" locks the page.** While Saga has the browser in AI only (paused too), the page ignores the user: the
  shield with Take control covers it and the tab's WebView (`TabWebView`) drops the user's touches, wheel and keys
  and gives the keyboard nothing to type into, so a field Saga tapped can't be typed in by the user either. Saga's
  own taps and swipes go through. "AI + me" is unchanged: the user interacts normally.
### Added
- **Saga's words on the page in "AI + me".** Each command carries Saga's one-line `say` ("Clicking Sign in"); the
  phone shows it, its requests to the user ("Your turn: enter the code…") and the server's new `notice` frame
  ("Done. Saga's answer is in the chat.") as a pill at the top of the browser that fades by itself and never takes
  a touch (`SagaNotice`, `modules/browser/frames.js`). The chat brings the browser card into view when Saga takes
  the browser, so its pointer can be seen.
- Docs: `docs/android-bridge.md` (anchor `pageHeight` and visual viewport, `say`, `notice`, fill / scroll results,
  the AI only lock).
- Tests: `tests/unit/saga-phone-act.test.js`, `tests/unit/saga-notice.test.js`, the visual viewport and composer
  cases in `packages/ui/test/native-anchor.test.js`, `SagaTouchTest.kt`, the stale-report case in
  `InlineGeometryTest.kt`.

## [0.10.1] — 2026-11-13 · Composer pinned with the in-chat browser open; Saga clicks for real
A fix from the owner's phone (Infinix SMART 20, app 0.10.0, inline browser card open): the message box ("Ask Colon
anything…") and its "Synced" line seemed to scroll away with the thread instead of staying at the bottom of the
screen. Every version number moves to 0.10.1 (apps, `Colon.version`, `version.json` versionCode 1001 for both APKs).
### Fixed
- **The app's browser WebView no longer covers the composer.** The thread (`.cw-scroll`) runs under the floating
  composer (padded by `--composer-h`), but `lib/native-anchor.js` reported the scroller's bottom as
  `viewportBottom`, so the app clipped its WebView only at the screen's edge and it slid over the message box and the
  "Synced" line as the card moved through the bottom of the thread. The band now ends at the composer's top
  (`viewOf(scroller, win, cover)`, `createAnchor({ cover })`, the composer is also watched for size changes), as
  `docs/android-bridge.md` always promised: the panel stays between the header and the composer.
- **Only the thread scrolls.** The card was brought into view with `scrollIntoView()`, which also scrolls the fixed
  frame (`.cw`, overflow hidden but scrollable by script), the page and the phone's visual viewport. New
  `lib/thread-scroll.js`: `reveal()` scrolls `#cw-scroll` alone into the band between the header and the composer
  (opening the card, the web's embedded card, and the keyboard opening for the panel's page); `pinFrame()` puts the
  frame and the window back at 0 if anything else moves them. Older WebViews without `dvh` keep a full-height frame.
- Tests: `packages/ui/test/thread-scroll.test.js` and the composer band in `native-anchor.test.js`.
- **Saga's clicks are real taps, and you can see them** (owner's report: no pointer in the in-chat browser, and Saga
  didn't seem able to click). Clicks did run, but as `el.click()`: an untrusted synthetic click that sites listening
  for pointer, mouse or touch events (or checking `isTrusted`) ignore, with nothing on screen, answered `ok` with
  the URL from before the click, so Saga was told "done" even when nothing happened. Now the phone taps the element's
  centre with real `MotionEvent`s (`SagaClicks.kt`, `SagaTap.kt`; tools.js `point` gives the spot as fractions of
  the visible viewport), falling back to a pointer / mouse / focus / click sequence when the element is off screen
  or covered. The secret-field refusal runs right before every tap path, including a secret field laid over the
  element.
- **Saga's pointer.** A Colon-blue arrow with the brand's two dots glides to the element before each click, fill and
  scroll, ripples where it taps, then fades (`SagaPointer.kt`). It never takes a touch, so "AI + me" works as before,
  and it hides when Saga loses control or hands a secret field to you.
- **Saga hears what a click did.** `ack.result.changed` (`navigated`, `url_changed`, `page_changed`,
  `element_changed`, `focused`, `none`, `unknown`) from tools.js `outcome`; the model is told plainly when nothing
  changed so it retries another element instead of assuming success, and keeps its element ids when the page did not
  change (`modules/saga/prompt.js`, `loop.js`). `docs/android-bridge.md`, "Real clicks and Saga's pointer".
- Tests: `tests/security/saga-phone-click.test.js`, `tests/unit/saga-click.test.js`, `SagaTapTest.kt`.

## [0.10.0] — 2026-11-13 · One browser per chat
Phase 10, the owner's design: every conversation has its own in-chat browser, driven from the chat, instead of the
chat sharing Colon Browser's tabs. Every version number moves to 0.10.0 (apps, `Colon.version`, `version.json` for
both APKs, versionCode 1000). Migration `0010_chat_browser_sessions.sql` runs on API start.
### Added
- **One browser per chat (API, migration 0010).** Browser sessions are kept per device **and** conversation
  (`browser_sessions.conversation_id`; `''` stays the device-wide session of Colon Browser and older apps).
  `GET/PUT/DELETE /browser/session` take `conversation_id`; `GET /browser/sessions` lists it. Deleting a chat (or
  all chats) deletes its browser sessions and Saga tasks.
- **Modes per chat: AI only and AI + me.** "AI only" (`ai`): Saga drives, you watch. "AI + me" (`shared`): you both
  act and Saga sees what you changed (the latest `page_state`, memory only). Default in Settings (`browserMode`),
  per chat with `PATCH /conversations/:id { browser_mode }` (`chat_conversations.browser_mode`) and the mode chip on
  the card; `POST /browser/agent` takes `mode` (`saga_tasks.mode`). Control rules in `modules/browser/control.js`.
- **Saga never fills secret forms.** Passwords, one-time codes, card numbers, PINs, and sign-in and payment pages go
  to the user: the server (`modules/saga/secrets.js`) and the phone (`SecretFields.kt`, `tools.js`) both check, the
  page is handed over ("Your turn" on the card) and Saga waits up to `SAGA_HANDOFF_TIMEOUT_MS` (default 600000) for
  Return to AI. Snapshots sent to the model and the logs are redacted.
- **Chat-driven browsing.** Tell Saga in the chat to open the browser and what to do: "open the browser", "open
  google.com", "scroll down" run on this chat's own browser (`lib/browser-intent.js`); anything else becomes a Saga
  task in this chat. On the web the chat's reader session is per chat too.
- **Android: one in-chat browser per conversation** (WebView profiles: own cookies, storage, tabs and history; the
  least recently used beyond `-Pcolon.chatProfiles`, default 20, are deleted; one shared profile, cleared on chat
  change, on WebViews without profiles). Consent lasts 10 minutes for the same chat's next instructions; Stop,
  declining or another chat ends it. Deleting a chat forgets its browser.
- **Bridge:** `browser` actions `chat`, `forget`, `mode`, `control` (feature `browserChats`); WebSocket frames
  `chat` (app → server) and `handoff` (server → app); `conversation_id` on `hello`, `session_sync`, `page_state`,
  `control` and `command`; control reasons `handoff` and `mode`; ack error `secret_field`; server error `other_chat`
  (a command for a chat the panel isn't showing). See `docs/android-bridge.md`.
### Fixed
- **Handoff ordering.** The phone sends the `secret_field` ack before its `handoff` control report, and a handoff
  report no longer cancels pending commands, so the server waits for the user instead of reading a takeover.
- **Handoff wait re-arm.** Saga re-arms its wait for the phone before checking for Stop, so a Return to AI tapped in
  between is never missed.
### Tests
- `services/api/tests/unit/browser-chat-sessions.test.js`, `saga-handoff.test.js`,
  `tests/security/saga-secrets.test.js`, `packages/ui/test/browser-intent.test.js`, `browser-modes.test.js`,
  `scripts/deploy/android-version.test.js` (two-digit minor); Kotlin `ChatSessionsTest`.

## [0.9.2] — 2026-11-13 · The browser panel stays inside the conversation
Fix for 0.9.1 on real phones: the in-chat browser panel could still open pinned above the chat (embedded, with its
own header) instead of inside the thread. Every version number moves to 0.9.2 (apps, `Colon.version`,
`version.json` for both APKs, versionCode 902).
### Fixed
- **Android: "can the page draw the card?" no longer starts as "no".** 0.9.1 started it false and only flipped it
  when the chat page made a `browser(...)` call with `inline: true`, so a panel the app opened by itself first
  (Saga's auto-open when it asks to browse, a link the shell routed, `openTab`) showed embedded; the 4 s grace
  after a page load could also run out on a slow phone and leave it embedded. It now starts unknown (inline,
  hidden until the card reports), the grace (6 s) is armed on every open and every chat page load, and an
  `anchor` report counts as the page saying it draws the card.
- **Android: phones open every panel in the conversation** (Browser button, AI Browse, Saga, links, reopen after
  collapse or full screen) — `PanelLayout.openMode`. Collapsing from full screen or split no longer saves the
  embedded fallback as the preferred layout (in 0.9.1 that pinned every later open above the chat). Embedded and
  split from the panel menu still work while the panel is open; wide screens keep their saved layout.
- **Chat:** the panel state now carries `inlineReady`; whenever it is false the page tells the app it draws the
  card (with a 0.9.1 app, once per page when the panel is embedded). The page follows the panel as soon as the
  bridge is ready instead of after settings and models load, re-syncs on resume, sends anchors with
  `inline: true`, and draws the card even without the header Browser button (`lib/native-panel.js`).
### Tests
- `packages/ui/test/native-panel.test.js` (the handshake, including a model of the app: Saga/link opens before the
  page spoke, a slow reload past the grace, reopen after full screen); Kotlin `InlineOpenTest`.

## [0.9.1] — 2026-11-13 · The browser panel inside the conversation
On phones, Colon AI's browser panel now shows inside the chat thread, where the web's "Colon Browser" card sits,
instead of being pinned above the chat header. Every version number moves to 0.9.1 (apps, `Colon.version`,
`version.json` for both APKs, versionCode 901).
### Added
- **Layout `inline`** for the in-chat browser panel (Android, `PanelLayout.Mode.INLINE`), the default on phones
  (wide screens still open split). The chat draws the card (status dot, "Colon Browser", the address, collapse,
  full screen, close) and an empty body box (60vh, at least 320 px); the app lays the panel's WebView over that
  box, clipped to the visible thread so it never covers the chat header or the composer, and hides it when the card
  is scrolled away or collapsed. Scrolling only translates the panel (no relayout); the same WebView is kept when
  switching to embedded, split or full screen and back, so nothing reloads. "In the conversation" in the panel
  menu (full screen) switches back. Saga opening the panel when it asks to browse opens it inline too.
- **Bridge:** `browser('anchor', { visible, x, y, width, height, viewportTop, viewportBottom, dpr })` (the card's
  body box in CSS px; sent on open, scroll, resize and keyboard, at most once a frame and only when it changed),
  `inline: true` on any `browser(...)` call (the page draws the card), `layout: 'inline'` in the panel state and
  the `layout` action, feature `browserInline` (docs/android-bridge.md).
- **Chat:** `lib/native-anchor.js` (measures and reports the box; keeps the card on screen when the keyboard opens
  for the panel's page) and the card in `.cw-native-host`; tests in `packages/ui/test/native-anchor.test.js`.
  Kotlin: `InlineGeometry` (CSS px -> device px and the clip, `InlineGeometryTest`), `InlineLayer`.
### Changed
- The panel's saved layout moved to a new preference key (`layout`), so phones start in the conversation once
  after the update; a layout picked from then on is remembered.
### Compatibility
- An older chat page in the new app never sends `inline: true`, so the panel stays embedded above the chat as in
  0.9.0 (`state.layout` reports what is shown). The new chat page in an older app (no `browserInline`) keeps the
  0.9.0 behaviour. When the chat page reloads, an inline panel waits hidden up to 4 s for the new page.

## [0.9.0] — 2026-11-13 · Phase 9: Saga browser automation
Saga browses for the user on their phone: it drives the Colon AI browser panel (a real WebView with the user's own
cookies) through the WebSocket bridge, explains every step, cites the pages it read, and waits for the user's tap
before anything risky. Every version number moves to 0.9.0 (apps, `Colon.version`, `version.json` for both APKs).
### Added
- **Saga module** (`services/api/src/modules/saga`, ADR 0005): a decision -> action -> observation loop over the
  existing model router (one JSON action per step, the usual model deviations repaired), the controlled tool set
  `openUrl, getPageContent, getLinks, click, fill, scroll, screenshot, back, forward, refresh, tabs, finish` with
  arguments rebuilt from per-tool allow-lists, blocked hosts refused, element ids only from the latest page read.
  Limits: `SAGA_MAX_STEPS`, `SAGA_TASK_TIMEOUT_MS`, `SAGA_MODEL_TIMEOUT_MS`, `SAGA_STEP_TIMEOUT_MS`,
  `SAGA_APPROVAL_TIMEOUT_MS`; Take control, Pause, Stop or a dropped socket end a task at once.
- **Untrusted pages:** page text, titles, element labels, links and tab titles are neutralised by the safety
  layer's injection guard and fenced with random-id markers; flags are recorded as safety events (route `saga`).
- **Approvals tapped on the phone** for payments, purchases, form submissions, sending messages and personal data:
  the server's policy (`policy.js`) and the phone's check of the real element (`assets/saga/tools.js`) both count,
  the stronger wins; the model can't pre-approve; an `ok` answer without the user's approval stops the task
  (`approval_missing`); a decline is respected. Shared mode asks before every changing step.
- **Action log and replay:** migration `0009_saga_tasks.sql` (`saga_tasks`, `saga_actions`; typed personal data
  hidden, page text never stored), audit entries `saga.task_created` / `saga.task_finished` /
  `admin.saga_replay_viewed`. REST: `POST /browser/agent`, `GET /browser/agent`, `GET /browser/agent/:id?after=`,
  `POST /browser/agent/:id/stop`; admin: `GET /admin/saga/tasks`, `GET /admin/saga/tasks/:id`. Admin › Browser
  lists tasks with a step-by-step replay (it was a placeholder).
- **Bridge:** `command(name, args, tab, { timeoutMs })`, `waitControl()`, `hasControl()`, the phone's
  `capabilities` kept from `hello` (`supports()`); tasks are queued in MySQL and claimed by the worker that holds
  the phone's socket (`ws/index.js` starts the sweep); unclaimed tasks fail with `no_phone` after a minute.
- **Android (both apps):** `get_page_content`, `get_links`, `click`, `fill`, `scroll`, `screenshot` (`SagaTools`,
  `BrowserSaga`), advertised in `hello.capabilities`; the "Approve Saga's next step?" dialog; Allow on "Let Saga
  browse?" always answers `consent`. Colon AI opens its browser panel by itself when Saga asks to browse (Phase 10).
- **Chat:** AI Browse in the Android app (`Colon.native.hasPanel()`) runs on the native panel through Saga
  (`apps/chat/src/actions/saga-native.js`): the panel opens at once, each step's explanation is shown, and the
  answer with "How Saga browsed" and its cited pages is added to the chat. The web reader's AI Browse stays for the
  web, guests, older apps and servers without Saga.
- Config: the seven `SAGA_*` keys (`config/api.env.example`, `config/README.md`).
- Tests (30): `tests/unit/saga-loop.test.js`, `tests/unit/saga-runner.test.js`, `tests/security/
  saga-approval.test.js`, `tests/security/saga-injection.test.js`, `tests/security/saga-phone-tools.test.js`;
  Kotlin `SagaPhase9Test.kt` (runs in the Android CI).
### Not yet
- The Phase 9 release standard on real phones (multi-step tasks on real sites, injection pages, approvals); the
  Kotlin changes were written without a local Android build.
- Screenshots are not given to the model; no push to wake a phone whose app is closed; `page_state` not stored.

## [0.8.1] — 2026-11-13 · Phase 8 server pieces: reader and session manager
The two server pieces Phase 8 left open, built to `docs/phase8-backend-contract.md`. API only: the web clients
already call these endpoints, so no client change was needed. (Version numbers in `package.json` and the apps stay
at 0.8.0 until the release is cut.)
### Added
- **Server reader `GET /browser/fetch`** (`services/api/src/modules/browser`): reads one public page on the server
  for web light mode. SSRF guard: http/https on ports 80/443 only, DNS resolved on the server and every address
  checked (private, loopback, link-local, CGNAT, multicast, IPv6 ULA/link-local, cloud metadata), the socket pinned
  to the checked address, every redirect checked again (at most 5). 10 s, 2 MB, HTML and plain text only, no
  cookies or auth headers, `ColonReader/1.0` user agent. Regex sanitiser with the client's tag allow-list
  (scripts, styles, frames, forms, media, nav/aside and every `on*` attribute removed; links and images made
  absolute; small `data:image` only), plus title, byline, lang and text (≤ 200 000 characters). `robots.txt`
  honoured; host block list in the safety layer (`modules/safety/hosts.js`: adult and malware hosts plus
  `BROWSER_READER_BLOCKLIST`). Contract error codes (`bad_url`, `blocked_private`, `too_large`, `not_html`,
  `needs_login`, `rate_limited` with `retry_after`, `upstream_error` with `upstream_status`, `timeout`,
  `not_enabled`). 30 a minute and 500 a day per user, 60 a minute per IP for guests. 10-minute cache, shared
  between users only when the site sent no cookie and allows shared caching. Logs only user id, host, status,
  bytes and time.
- **Browser session manager**: migration `0008_browser_sessions.sql` (`browser_devices`, `browser_sessions`,
  `browser_tabs`, `browser_history`); `GET`/`PUT`/`DELETE /browser/session` per user and device with optimistic
  `version` (`409 conflict` with the current session), `GET /browser/sessions`, and opt-in `/browser/history`.
  Private tabs are never stored, URLs over 2048 characters are dropped, at most 30 tabs, idle sessions deleted
  after 30 days.
- **WebSocket bridge** (`ws/index.js`, `modules/browser/bridge.js`): sockets are tied to the signed-in user (the
  `colon_sid` cookie); `hello` with `app` registers the device and is answered with `bridge: 1, session: 1`;
  `session_sync` (one write per 2 s, latest wins; 64 KB frames; 10 tabs on low-RAM phones) and `session_request`
  (answered by `ack`); control owner rules (AI/Shared only after consent; Take control, Pause, Stop and Declined win
  at once and cancel pending Saga commands with `manual_control`), every change in the audit log.
- Config: `BROWSER_READER`, `BROWSER_READER_GUESTS`, `BROWSER_READER_BLOCKLIST`. The router gains `PUT` (CORS
  allows it). API errors can carry contract fields beside `error` and `message`.
- Tests: `tests/security/browser-reader.test.js`, `tests/unit/browser-html.test.js`,
  `tests/unit/browser-session.test.js`, `tests/unit/browser-bridge.test.js` (29 tests).
### Not yet
- Saga routing on the bridge (choosing a phone, sending commands, per-command rate limits) is Phase 9; the bridge
  already exposes `command`, `askControl` and `requestSession` for it.
- The "Sync my tabs with Colon" setting on the phones; `page_state` is not stored yet.

## [0.8.0] — 2026-11-13 · Colon Browser becomes its own app (Phase 8, client side)
Two Android apps from one project: **Colon AI** (chat, with a real browser panel beside it) and **Colon Browser**
(the full standalone browser). Web light mode gets its "open in the app" prompt and a server-reader adapter. The
server pieces of Phase 8 are not built yet; their contract is `docs/phase8-backend-contract.md`. Decision:
`docs/decisions/0004-two-android-apps.md`.
### Added
- **Two APKs, one Gradle project** (`apps/android`): product flavors `colonai` (`ng.nifelux.colonai`) and
  `colonbrowser` (`ng.nifelux.colonbrowser`), all code shared in `src/main`; per-flavor manifests, name, launcher
  icon (a cyan globe around the flame for Colon Browser), splash and update texts. versionCode 800.
- **Colon AI: in-chat browser panel** (`ChatBrowserPanel`, `PanelLayout`): pages from the chat open in a native
  WebView beside the chat instead of a separate screen. Embedded (collapsible), split (draggable divider; side by
  side on wide landscape screens) and full screen, switched without reloading. Address bar, back, forward,
  reload/stop, tabs (6), desktop site, share, downloads list, clear data, close; **Open in Colon Browser** (or its
  download page when not installed). Saga's AI / Manual / Shared control, consent and shield work in the panel.
  Bridge: `ColonNative.browser(action, …)` and the `browser` event (`docs/android-bridge.md`); the chat's Browser
  button and links drive it (`apps/chat/src/components/browser-panel.js`). On the web the reader panel stays.
- **Colon Browser app** (`BrowserActivity`, `BrowserMenu`): opens straight into the browser; **private tabs**
  (violet bar, no history or cache, never saved or seen by Saga, own cookies and storage in a throwaway WebView
  profile deleted when the last one closes; an honest warning on WebViews without profiles), **tabs and history
  that survive restarts** (`TabSnapshot`, saved as they change), **clear browsing data screen**
  (`ClearDataActivity`: history, cookies, cache, site storage, downloads list; Colon AI sign-in kept), **downloads
  list**, **desktop site** per tab, full-screen video (shared `Fullscreen`), web searches from other apps, "Ask
  Colon AI about this page" and "Open Colon AI" handoffs (`Handoff`).
- **Google and bank sign-in in a Chrome Custom Tab** (`SignInTabs`, `androidx.browser` 1.8.0):
  `accounts.google.com`, `accounts.youtube.com` and the internet-banking hosts of GTBank, Access, Zenith, UBA and
  First Bank (`UrlRules.CUSTOM_TAB_HOSTS`, extendable with `-Pcolon.customTabHosts=`); the tab reloads on return.
- **Per-app updates:** `version.json` gains a `browser` entry; each app reads only its own entry and accepts only
  an APK named for itself (`VersionManifest.forApp`). The top-level fields are unchanged, so v0.7.x keeps updating.
- **CI** (`.github/workflows/android.yml`): tests and lint for both flavors; builds, signs (same key) and
  publishes `colon-ai-<v>.apk`, `colon-ai.apk`, `colon-browser-<v>.apk`, `colon-browser.apk` and a `.sha256` for each.
- **Web light mode** (`packages/ui/js/browser/app-prompt.js`, `reader-proxy.js`): "Light mode … Open in the app for
  full browsing" above reader pages and the new tab page (Colon Browser's APK on Android, the release page
  elsewhere), a stronger prompt on sites that need the full browser; a server-reader adapter for
  `GET /browser/fetch` with graceful fallback, and a labelled **Preview** mock (`localStorage['colon.reader'] =
  'mock'`). Settings › App and Help list both apps; Colon Browser web Help explains light mode.
- Docs: `docs/phase8-backend-contract.md` (reader proxy, session manager REST and WebSocket messages, control
  owner rules), ADR 0004, `apps/android/README.md` rewritten for two apps.
- Tests: `BrowserPhase8Test.kt` (20 JVM tests: tab persistence, private-tab rules, Custom Tab hosts, desktop user
  agent, panel layouts, clear-data rules, downloads list, per-app update manifest, handoff), run for both flavors;
  `packages/ui/test/light-mode.test.js` (7); `scripts/deploy/android-version.test.js` checks both apps.
### Changed
- The browser engine is one module for both screens: `BrowserHost` (implemented by `BrowserActivity` and
  `ChatBrowserPanel`), `BrowserWeb`, `BrowserSaga`, `TabManager`. Saga can't read or drive private tabs
  (`private_tab` error; left out of `get_tabs` and `page_state`).
- Colon AI no longer contains a standalone browser screen; `openTab` and links open the in-chat panel.
### Not yet (stubbed)
- **Server-side reader** (`GET /browser/fetch`) and the **browser session manager** (tabs, URLs, history and control
  owner per user and device): not in `services/api`; clients fall back (contract in
  `docs/phase8-backend-contract.md`).
- Saga driving the native panel (Phase 9): the chat's AI Browse still runs in the web reader panel.
- Real-device testing of both apps (private tabs on old WebViews, Custom Tab round trips, split divider), push
  notifications, App Links, crash reporting.

## [0.7.1] — 2026-11-13 · Android app (Phase 7 begins)
Colon AI in a native Android shell, with Colon Browser built on Android System WebView. Built in the cloud by GitHub
Actions. Details: `apps/android/README.md`, `docs/android-bridge.md`.
### Added
- **Android app** (`apps/android`, `ng.nifelux.colonai`, Android 7.0+ / minSdk 24, targets API 36, about 2 MB
  shrunk with R8): loads `chat.apparatus.name.ng` with file picker, microphone, back button, offline screen with
  retry, downloads, edge-to-edge insets, system bars that follow the chat theme, and recovery when a low-memory
  phone kills the WebView renderer. Splash (SplashScreen API, backported) and adaptive/themed launcher icons.
  versionCode = major × 10000 + minor × 100 + patch (0.7.1 → 701).
- **Native Colon Browser** (`BrowserActivity`, `TabManager`, `BrowserWeb`): address bar (URL or search), back /
  forward / reload, home page with bookmarks, tabs (10 on low-RAM phones, 30 otherwise) with only 2–5 live WebViews
  (older background tabs are discarded and reload when opened), history and bookmarks on the phone only,
  DownloadManager downloads, full-screen video, uploads, per-site camera/microphone, "Clear browsing data" that
  keeps the Colon AI sign-in. Listed in Android's "Open with" for web links. Saga control indicator (AI / Manual /
  Shared) with Take control, Return to AI, Pause, Stop and a consent prompt.
- **`window.ColonNative` bridge** (`NativeBridge.kt`): origin-restricted to Colon's own pages (WebView
  `addWebMessageListener` / document-start script, with a checked fallback on old WebViews): `info`, `openTab`,
  `share`, `download`, `saveFile`, `haptic`, `requestPermission`, `checkUpdate`, `setTheme`, `setSession`,
  `takeShare`, `bridgeStatus`, plus `share` / `bridge` / `resume` events. User agent ends with `ColonAndroid/<ver>`.
- **Backend bridge client** (`BridgeClient`, `BridgeProtocol`, `Backoff`): WebSocket to `wss://api.apparatus.name.ng/ws`
  with reconnect backoff, heartbeats and network awareness; protocol in `docs/android-bridge.md`.
- **Share to Colon** (`ShareReceiverActivity`, `ShareIntake`): text, links or up to 5 images from any app land in
  the message box and upload tray.
- **In-app updates** (`UpdateChecker`, `VersionManifest`): reads `apps/chat/public/android/version.json` every
  12 hours; downloads the APK, checks package, version and signing key, then opens Android's installer.
- **CI:** `.github/workflows/android.yml` (unit tests, lint, release APK artifact; "Publish a release" or a `v*` tag
  creates the GitHub Release with `colon-ai-<version>.apk`, `.sha256` and `colon-ai.apk`; tag must match
  `package.json`). `.github/workflows/android-keystore.yml` creates the release signing key into repository secrets
  from a phone (modes `create` / `backup`, optional encrypted backup artifact).
- **Web native-shell integration:** `Colon.native` (`packages/ui/js/colon/native.js`) detects the app and sets
  `html[data-shell="android"]`; `apps/chat/src/lib/native-shell.js` syncs theme and session and drops shared content
  into the composer; links and "Open browser" open native tabs (AI Browse stays in the panel); blob exports save
  through the app; voice uses Colon speech in the app. Settings › App and Help show a "Get the Android app" row on
  the web (APK on GitHub Releases) and the installed version with "Check for updates" inside the app
  (`apps/chat/src/components/app-row.js`); Colon Browser web Help has the same row.
- **Polish** (`packages/ui/css/polish.css`): Android shell safe-area handling, no long-press callouts on controls,
  and refined states, spacing and motion of existing components (no layout changes).
- Tests: 17 JVM unit tests (`LogicTest.kt`, `UrlRulesTest.kt`), `packages/ui/test/native.test.js` (6),
  `scripts/deploy/android-version.test.js` (2).
### Fixed
- **Settings opened scrolled to the bottom** on phones (scrollTop ≈ 3450 at 360 px): hiding the composer on a page
  resized it, and the "follow the latest message" handler pulled the shared scroll area down. Pages now always open
  at the top; returning to a conversation still opens at the latest message.
### Not yet (stubbed)
- **Push notifications (FCM):** channels and the Android 13 permission only; needs a Firebase project.
- **Backend bridge server:** today's API only says hello on `/ws`; no Saga commands yet (the app shows this and
  keeps working).
- Native SpeechRecognizer dictation, Google sign-in inside the app (Custom Tab), App Links (`assetlinks.json`),
  crash reporting, and testing on real low/mid/high-end phones.

## [0.6.5] — 2026-11-13 · Hands-free conversation
### Added
- **Hands-free mode** (`apps/chat/src/lib/hands-free.js`): pick "Hands-free conversation" at the bottom of the mic's
  language list. Colon listens, sends when you stop talking, reads the reply aloud, then listens again. A
  "Hands-free" pill above the composer shows Listening / thinking / speaking with an End button; Cancel on the
  recording bar or tapping the mic also ends it. Two turns in a row with no speech end the session.
- End of a turn: 1.6 s without new words (English dictation) or 1.5 s below speech level on the microphone (Colon
  speech for Naijá, Yorùbá, Hausa, Igbo); 9 s of nothing counts as a miss. `ChatMedia` gained `onLevel`, and a
  failed or empty Colon transcription now reports an empty final transcript so the loop can move on.
- Tests: `packages/ui/test/hands-free.test.js` (3).

## [0.6.4] — 2026-11-13 · Done button fix
### Fixed
- **Tapping Done could leave the mic stuck** on Android: if Done landed between two dictation restarts, Chrome had
  no session to end and never fired `onend`, so the bar stayed open and nothing reached the message box. Done now
  finishes with the words so far if `onend` hasn't arrived within a second.

## [0.6.3] — 2026-11-13 · Dictation text fix
### Fixed
- **Spoken words appeared several times** in the message box on Android ("hi hi how hi how are you…"): Chrome
  repeats earlier words inside each new result. The dictation text is now rebuilt from the results each time, and a
  result that already holds the text so far replaces it rather than being added.

## [0.6.2] — 2026-11-13 · Voice fix
### Fixed
- **English dictation stopped after about 5 seconds** on Android: Chrome ends a speech session at the first short
  pause even with `continuous` on. The mic now restarts the session quietly and keeps the words heard so far until
  you tap Done (5-minute cap). A pause with no speech no longer ends the recording. The bar says "tap Done when you
  finish" for dictation too.

## [0.6.1] — 2026-11-13 · Spoken replies
### Added
- **Read aloud in Nigerian voices:** `POST /voice/speak` (`{ text, lang, speaker }` → MP3, ≤ 900 characters) with
  Naija Speech voices for Yorùbá, Hausa, Igbo and Nigerian English (female/male per language); the language is
  detected from the reply. Markdown, code, links and emoji are not read. Last 40 chunks cached in memory.
  Limits: 300 chunks an hour signed in, 60 for guests, and at most `VOICE_TTS_PER_MINUTE` (default 7) a minute for
  the whole app, since the key allows 10 requests a minute in total. Logs `tts_ok` / `tts_failed`.
- **Client** (`apps/chat/src/lib/read-aloud.js`): plays a reply chunk by chunk (≈120 characters first, then ≤ 300),
  fetching the next chunk while one plays; falls back to the phone's voice when Colon voices are off, busy or
  offline. Settings › Voice: read-aloud voice (Automatic / Colon / phone) and Colon voice (female / male).
- **Language first:** tapping the mic opens a small list (English, Naijá, Yorùbá, Hausa, Igbo, Mixed) above it;
  picking one remembers it and starts recording. The recording bar shows the language and no longer has a picker.
### Changed
- Read-aloud "Automatic" uses Colon voices for Yorùbá, Hausa and Igbo replies and the phone's voice for English and
  Naijá: Naija Speech generates slower than real time (measured 9–18 s for 70–130 characters, one request at a time),
  which is fine where no phone voice exists but slower than the phone for English.

## [0.6.0] — 2026-11-13 · Voice input (Phase 6 begins)
Speak to Colon in English, Naijá, Yorùbá, Hausa or Igbo; the words land in the message box to check before sending.
Details: `docs/phases/phase-6-voice.md`.
### Added
- **Voice module** (`services/api/src/modules/voice`): `POST /voice/transcribe` (multipart `file` + `lang`,
  12 MB / 5 minutes) and `GET /voice/status`. Signed-in users 60 recordings an hour; guests 20 an hour per IP (own
  origins only, follows the guest-chat switch). Logs `voice_ok` / `voice_failed` with provider, language and time.
- **Providers:** Naija Speech API (free; NCAIR / N-ATLaS ASR models) leads for Hausa, Igbo, Yorùbá and Nigerian
  English; a Gemini model (`VOICE_GEMINI_MODEL`, default `gemini-3.5-flash-lite`, on `GEMINI_API_KEY`) handles Pidgin
  and "Mixed" and is the fallback. Recordings are never stored.
- **Composer:** "Colon speech" voice method. The recording bar has a language picker (remembered in Settings), a
  level meter and a "Transcribing…" state; a failed transcription falls back to a voice note (signed in).
  Recording is mono with noise suppression at 24 kbps Opus, about 180 KB a minute on slow networks.
- New env: `VOICE`, `NAIJA_SPEECH_API_KEY`, `NAIJA_SPEECH_BASE_URL`, `VOICE_GEMINI_MODEL`, `VOICE_MAX_SECONDS`.
- Settings › Voice: Naijá and "Mixed / not sure" languages, model attribution (required by the NCAIR licence).
### Changed
- Voice method "Automatic": English uses the browser's live dictation when it has it; every other language uses
  Colon speech.

## [0.5.11] — 2026-11-13 · N-ATLaS and Phase 5 complete
Closes Phase 5 (Intelligence & evaluation).
### Added
- **N-ATLaS on Langa**: the `natlas` provider defaults to `https://langa.julimer.com/v1` (model `n-atlas`); it turns on
  only when `NATLAS_API_KEY` is set and stays third in the African-language chain. New env `NATLAS_MAX_TOKENS`
  (default 2048): a provider-level output cap (`client.capTokens`), so Developer mode's 8192 never reaches the host.
- Small N-ATLaS bench `bench/results/natlas-2026-11-13` (Hausa, Igbo, Yorùbá, 2 items each): 3/6, ~0.9 s first token
  (Gemma 4 26B: 4/6 on the same items). Not enabled in production: Langa's free plan is 12,500 tokens/month.
- Benchmark 2026-11-12 complete (Mistral Large 4 with `reasoning_effort: 'low'`; `'none'` answers 400).
### Changed
- Built-in specialist table: Everyday no longer goes to MiniMax; after the complete rerun Gemma 4 26B leads every
  category (MiniMax still last for Yorùbá, Hausa, Igbo).
### Fixed
- Two stale unit tests (Mistral body, specialist table) that failed after the benchmark rerun.
- Version 0.5.11 everywhere.

## [0.5.10] — 2026-11-13 · Specialist routing
Phase 5 specialist routing: where a model clearly beats Saga's default on a kind of request, it leads the chain for
those requests. Details: `docs/phases/phase-5-specialist-routing.md`.
### Added
- **Task classifier** (`ai/classify.js`, rule-based, no model call): category = the African reply language (Naijá,
  Yorùbá, Hausa, Igbo; reuses `prompts.detectLanguage`), else code / reasoning / exam / research / everyday from the
  mode, the message and attachment names.
- **Specialist derivation** (`ai/specialists.js`, pure): from the newest imported benchmark, per category; a model
  leads only when complete in the benchmark and ≥5 points better than the default plus 0.5 point per second of
  slower first token, with a median first token ≤15 s. Complete models under 70 in a category, and MiniMax for
  Yorùbá/Hausa/Igbo, go last. Built-in table (bench 2026-11-12) when no benchmark is imported. Re-derived on import.
- From bench 2026-11-12: Everyday → MiniMax M3.1 Flash; every other category keeps Gemma 4 26B; MiniMax goes last
  for Yorùbá, Hausa and Igbo (Gemma 4 31B wins Hausa on score but is ~18 s to first token, so it stays second).
- **Admin › Routing**: Specialist routing card (per-category head, reason, demoted models, rule, source) and an
  On/Off switch saved with the routing setting; `GET /admin/routing` returns `specialists`, `PATCH` accepts
  `specialists: true|false`. New optional env **`AI_SPECIALIST_ROUTING`** (on|off, default on) when the switch was
  never saved.
- **Admin › Evaluation › Import benchmark** button (posts a `bench/results/<run>.eval.json` to
  `POST /admin/evaluation/bench`).
- `ai_reply_ok` in stderr.log carries `route=specialist:<category>` / `default:<category>` / `default`.
- Tests (11 new): classifier, derivation (margin, latency, incomplete exclusion, demotion, no-eval fallback, static
  table = committed bench), chain reordering, hedge waves, settings switch, import time parsing; integration with
  the mock provider and the admin routing handlers.
### Changed
- Specialists only reorder the head of the chain (and push weak models last); fallback, resting and hedging are
  unchanged, except that a hedged wave no longer pulls a demoted model forward to mix providers.
- Benchmark import accepts the report's local "finished" time (`Thu 2026-11-12 1:52 PM WAT (UTC+01:00)`), so the
  committed 2026-11-12 file imports as is; importing or deleting a run clears the routing cache.
- The routing loader reads the newest benchmark rows from `eval_runs` (one extra query per 30 s per worker).
- Version 0.5.10 everywhere.
### Not changed
- No migration, no new route, no new dependency; the configured routing order is the fallback order.

## [0.5.9] — 2026-11-13 · Developer mode
Phase 5 Developer mode: code explain, fix, generate and review, and a project-files context. Details:
`docs/phases/phase-5-developer.md`.
### Added
- **Developer prompt** (`ai/prompts.js`): explain (walk-through, complexity, pitfalls); fix (name the bug, root cause,
  corrected code as a minimal diff or the full file, how to test); generate (complete runnable code, file names,
  dependencies, run instructions); review/refactor by severity. Fenced code blocks with language tags; code and
  identifiers in English, prose in the reply language; never invent APIs, say when unsure; secure by default (no
  hard-coded secrets, parameterised SQL, input validation); one clarifying question only when essential; Nigerian
  context (cPanel hosting, Paystack/Flutterwave) when relevant.
- **Larger output for Developer replies**: new optional env `AI_DEVELOPER_MAX_TOKENS` (default 8192; other modes keep
  `AI_MAX_TOKENS`). Routing order unchanged.
- **Project files**: attach code files or a `.zip` of a project (20 MB, kind `doc`, mime `application/zip`; other
  ZIP-based files are still refused; more code extensions accepted). The zip is read once at upload into a snapshot
  (`modules/developer/snapshot.js`): top folder stripped; `node_modules`, `.git`, `vendor`, `dist`, `build` and
  other tool folders counted but not read; binaries, images, minified bundles, lockfiles (size only) and secret
  files (`.env`, keys; `.env.example` is read) listed without contents.
- **Project context** for every Developer reply (`modules/developer/project.js`, `chat/context.js forMode`): code
  files and snapshots from every message in the conversation (follow-ups keep them; a re-attached file replaces
  the old copy), ordered by files named in the message, then entry points/configs, then smallest code first, within
  48,000 characters (12,000 per file, 24,000 for a named file). A header with counts and languages and a file tree
  marking every truncated or omitted file and why; the model is told not to guess missing files. Tree and files are
  untrusted: neutralised by the injection guard and fenced per file with random end markers. Guests get a plain
  rendering from `/chat/guest/extract`.
- **Safe ZIP reader** (`extract/zip.js`), now shared with DOCX/PPTX/XLSX/ODT: path traversal, absolute paths and
  NUL names refuse a project archive (422 `unsafe`); zip bombs refused by declared total (128 MB), ratio (200× for
  entries over 1 MB) and entry count (20,000); every entry inflated with a cap at its declared size.
- **Developer quick actions** in the chat app: Explain, Fix a bug, Generate, Review (prefill a short template) and
  Attach project, shown above the composer in Developer mode only. Help FAQ: "How do I get help with my code?".
- Tests (13 new): prompt contents and output cap; snapshot ignore rules, traversal and zip-bomb refusal; context
  priority, budget, truncation and omission notes, merging, injection fencing; chat context per mode; and an
  integration test with the mock provider (the stored zip reaches the model as context and a follow-up reuses it).
### Changed
- Code blocks never widen a message on phones (`max-width`, horizontal scroll contained); they already had the
  language label and Copy.
- Version 0.5.9 everywhere.
### Not changed
- No migration, no new route, no new dependency; routing order as configured.

## [0.5.8] — 2026-11-13 · CBT: fresh questions every test
### Fixed
- **CBT tests no longer repeat themselves.** The same exam + subject + topic used to send the model the identical
  prompt with no memory of earlier tests and no temperature, and only exact-text duplicates were removed, so tests
  came back nearly the same. Now:
  - **Memory of recent tests** (app, `core/cbt-store.js`): the last 40 question stems (140 characters each) per
    exam + subject + topic are kept in `localStorage` (12 kinds, ~40 KB at most; oldest rotate out; bad JSON is
    ignored) and sent with every new test and Retake as `avoid`.
  - **`POST /study/cbt` accepts `avoid`** (optional; up to 40 strings, one line, 160 characters each, 5000 in total).
    They reach the prompt as quoted data items, never as instructions: "do not repeat or closely paraphrase these;
    if you test the same concept, change the angle, numbers, context and options".
  - **A random focus per request** (`modules/study/variety.js`): a shuffled set of syllabus areas to spread over (at
    least 6; built-in lists for the quick subjects, otherwise a random starting area in the model's own syllabus
    order), or with a topic, at least 6 angles on it; a random mix of question types (recall, application,
    calculation, interpretation, error-spotting) and a random variety token. Temperature 0.9 for CBT generation.
  - **Near-duplicate filter** (`modules/study/similar.js`): stems are compared as token sets (no punctuation or stop
    words, plurals folded; Jaccard ≥ 0.6, or ≥ 0.4 with the same correct option). Different numbers = a new
    question. Applied within the test and against `avoid`. A short first answer is topped up by the second call,
    which also avoids the stems already accepted; still short after two calls, items held back only for resembling
    an earlier test fill the gap (never an in-test duplicate) and `cbt_short` is logged.
- Unit tests for the avoid input, the similarity filter, the focused prompt (fixed rng), temperature and top-up.

## [0.5.7] — 2026-11-13 · Study mode tools
### Added
- **Quizzes** in Study mode: Colon Saga settles the subject and level, asks one WAEC/JAMB-style A–D question at a
  time (5 by default), waits for the answer, marks it with a short explanation and a running score, and ends with the
  score, weak topics and what to revise.
- **Flashcards**: 10 by default, as a Markdown table (#, Front, Back), basic to harder, with an offer to quiz on them.
- **Past-question practice**: never presents a made-up question as a real WAEC, NECO, JAMB or university past
  question; generated ones are labelled "WAEC-style"/"JAMB-style". Pasted past questions are solved step by step,
  with the option letter, marking-scheme-style working for theory, and one similar practice question.
- **CBT practice test** (`#/cbt`, from Explore › Study, "CBT practice" in the menu and the Help FAQ): pick WAEC,
  NECO, JAMB, University or General, a subject (quick chips) and an optional topic, then answer exactly 10 objective
  questions (A–D) in 5:00 for the whole test, laid out like the JAMB CBT: countdown (warning at 1:00, red at 0:30,
  screen-reader announcements), question navigator with flags, keyboard shortcuts (A–D, N/P or arrows, F) and
  Submit with an unanswered count. The test submits itself at 0:00 ("Time up — submitted"); the timer counts to an
  absolute end time kept with the answers in `sessionStorage`, so a refresh resumes with the right time left. The
  results show the score, time used and every question with your answer, the right one and why, plus Retake (new
  questions), New test and "Discuss my mistakes" (a Study chat prefilled with the missed questions). Preview mode
  (no connection) shows a friendly "needs a connection" notice.
- **`POST /study/cbt`** (new `modules/study`, route `http/routes/study.js`): open to guests (when guest chat is on)
  and signed-in users, 5 tests per 10 minutes per IP, counted as one Study-mode reply against the daily limits (given
  back when no test could be made), subject and topic run through the safety input check. The model is asked for
  strict JSON; the reply is repaired (fences, LaTeX backslashes, trailing commas, cut-off items) and every item
  checked (4 distinct options, one answer A–D); numeric answer keys that contradict the explanation's own working are
  corrected, and options are shuffled so the right letter varies. Under 10 valid questions → one retry (questions
  pooled), then a 502 with a friendly message. Unit tests for the parser, prompt, input and handler.
- Help page mentions the Study tools. Unit test for the Study prompt.

## [0.5.6] — 2026-11-13 · Benchmark rerun fixes
Gets the four models that failed or stopped in the first benchmark (`services/api/bench/results/2026-11-12.md`)
ready for a rerun: DeepSeek V4.1 Flash and GLM-5.3 Flash (100 % first-token timeouts on NVIDIA), Nemotron 3.5
Lightning (stopped at 130/135) and Mistral Large 4 (stopped at 42). Root causes and the rerun steps:
`docs/phases/phase-5-benchmark.md`.
### Fixed
- **GLM-5.3 Flash** now sends `reasoning_effort: low` (NVIDIA's default is `max`), in Saga's routing and in the
  benchmark. New optional env `NVIDIA_GLM_REASONING` (`low`, `high`, `max`, or `default`).
- **Nemotron 3.5 Lightning** is benchmarked with `reasoning_budget: 1024` and 4096 max tokens: its reasoning counted
  against 2048 max tokens and 16 replies ended at `finish_reason: length` with no answer.
- **Mistral Large 4** sends `reasoning_effort: none` explicitly. DeepSeek, GLM and Mistral get 180 s to the first
  token (NVIDIA free-tier queueing), Nemotron 120 s.
### Added
- **Resume from checkpoint**: `npm run bench -- --resume [run]` continues a stopped run with the same flags; a
  `<model>.status.json` per model (`running`, `done`, `stopped`, `unreliable`, `failed`); Ctrl-C/SIGTERM marks
  running models `stopped`. Each row carries a settings fingerprint, so answers made with other settings are asked
  again instead of being mixed in. `--reset-unreliable`.
- **Provider-wide limits**: one limiter per provider for all its models (NVIDIA: 30 requests/min, 4 in flight by
  default; `--rpm-nvidia`, `--inflight-nvidia`, `BENCH_RPM_NVIDIA`).
- **Retries**: `Retry-After` is honoured on 429/503, exponential back-off with jitter; 400/401/403/404 are never
  retried, and a wrong key or model id stops that model at once.
- **Clear error reasons** per item: code, HTTP status, where it stalled (`connect` = no response headers, the host is
  queueing; `first_token`; `idle`; `max`), reasoning chunks seen, attempts and time, plus an attempt log. Replies cut
  at the token cap say so. The report lists errors by reason per model.
- `npm run bench -- --probe`: one tiny request per model (headers, first reasoning chunk, first answer, finish
  reason) before a long run.
- The provider client attaches `retryAfterMs` and the stall `phase` to its errors (no change to what users see).
- Tests (10 new, mock provider): retry policy, limiter, stall phases, cut-off replies, fatal stop, per-model options,
  checkpoints, probe, and the CLI stopped with SIGTERM then resumed end to end.
### Changed
- Version 0.5.6 everywhere.
### Not changed
- No route, migration or app screen changed; the 2026-11-12 results are kept as they were.

## [0.5.5] — 2026-11-13 · Safety layer
Phase 5 safety: harmful-content filtering on what users send and what the model streams back, prompt-injection
guards for web pages and uploaded files, and an Admin › Safety view. Rule-based and in process (no model, no new
dependency, ~2 ms per message), with lists in English, Nigerian Pidgin, Yorùbá, Hausa and Igbo. Decision record:
`docs/decisions/0003-safety-layer.md`.
### Added
- **`services/api/src/modules/safety/`** (facade `index.js`): `normalize.js` (one folding pass: tone marks, invisible
  characters, look-alike digits, spaced-out letters), `rules.js` (co-occurrence rules with benign-context
  exceptions), `data/*.js` (one file per category), `classify.js`, `policy.js` (settings per audience), `care.js`
  (model guidance), `messages.js` (refusals, stop notice and helplines in five languages), `redact.js`,
  `injection.js`, `output.js`, `provider.js`, `events.js`.
- **Input moderation before the model call** on every chat route (send, regenerate, edit, guest). Categories:
  child sexual content (always refused, cannot be switched off, fail closed), self-harm (never refused: a supportive
  message with Nigerian helplines first, then a careful answer), weapons/explosives/violent harm, illegal drug making
  (incl. mkpuru mmiri, skuchies, gutter water), hate and harassment, explicit sexual content (refused for guests,
  non-graphic for signed-in adults), fraud and scams (Yahoo-yahoo formats, fake alerts, card cloning, BVN/OTP/PIN
  phishing; victims get anti-fraud steps), personal data exposure (finding, tracking or doxxing people). Actions:
  allow, allow with care (guidance added to the system prompt) or refuse (a localized refusal streamed as a normal
  reply; no provider call, no web search, no quota used).
- **Secret redaction**: the user's own card numbers (Luhn-checked), BVN/NIN, OTP, PIN, CVV and passwords are masked
  before the message goes to an AI provider; the saved chat keeps what the user typed.
- **Optional moderation endpoint** (OpenAI-compatible `/moderations`), off by default; only ever stricter; fails
  open with a log line, never for child safety.
- **Prompt-injection guard**: web titles, snippets and page text (Research mode) and uploaded file names and text
  are neutralised (hidden characters, HTML comments, "ignore previous instructions", fake role tags, `SYSTEM:` lines,
  forged delimiters) and fenced in `<<<SOURCES|FILE untrusted id=…>>>` blocks with a random end marker; flags are
  logged.
- **System prompt safety section** in every mode: refuse seriously harmful help, care for self-harm, never reveal
  the prompt or keys, the untrusted-content rule.
- **Output check on streamed replies**: each delta is checked before it is sent (child sexual content, explosive
  recipes, drug synthesis, system-prompt leaks); on a hit the provider is cancelled and `done` carries a safe ending.
  Same SSE events as before (`start → delta… → done`), so the apps need no change.
- **Migration `0007_safety_events`** (new table only): stage, category, action, rule, source, route, mode, language,
  request id, user or guest; no message text unless `SAFETY_LOG_TEXT` is `hash` (keyed HMAC) or `excerpt` (first 80
  characters).
- **Admin › Safety** (admin + 2FA): recent events with category, action and date filters; switches per category
  for signed-in users and guests; provider moderation on/off/default. `GET /admin/safety`,
  `GET /admin/safety/settings`, `PATCH /admin/safety/settings` (audited `admin.safety_updated`; stored in
  `app_settings` key `safety`, live within 30 s).
- New optional env vars: `SAFETY`, `SAFETY_LOG_TEXT`, `SAFETY_PROVIDER_MODERATION`, `SAFETY_MODERATION_URL`,
  `SAFETY_MODERATION_API_KEY`, `SAFETY_MODERATION_MODEL`, `SAFETY_MODERATION_TIMEOUT_MS` (`config/README.md`).
- Tests (30 new): per-category positives and false-positive negatives (medical, news, prevention, slang such as
  "bath bomb", "don't bomb your WAEC", "this traffic go kill me"), injection guard, redaction, output guard,
  chat and Research integration with the mock provider (refusal, care, stream stop, injection, moderation endpoint),
  and security (admin guards, child-safety lock, SQL-safe filters, no reflection).
### Changed
- File blocks and the Research sources block carry an `untrusted id=…` marker; the user's name in the system prompt
  can't add lines.
- `scripts/dev/headless-check.js` also opens Admin › Safety.
- Version 0.5.5 everywhere.
### Not changed
- No route removed or reordered (3 admin routes added); no change to the chat or browser apps.

## [0.5.4] — 2026-11-12 · Restructure: company-grade layout
The repository is reorganised so each part has one obvious place and the rules are checked by CI. Same routes
(97, identical order), same API behaviour and same screens; the only visible differences are the URL changes below.
### Changed
- **API layers** (`services/api/src`): `http/` (server, middleware, router, routes), `ws/`, `modules/` (account, admin,
  ai, auth, bench, chat, extract, health, search), `shared/`, `db/`, `config/`. Dependencies point one way:
  http/ws → modules → shared/db/config.
- **Thin routes**: `http/routes/{health,auth,account,admin,chat}/` only wire paths to guards, rate limits and handlers;
  handlers live in `modules/*/handlers/`.
- **Module facades**: every module has an `index.js`; other code imports a module only through it.
- **One file per provider**: AI providers in `modules/ai/providers/` (hedged racing in `hedge.js`), web search
  providers in `modules/search/providers/`; text extraction split by file type (`sniff`, `image`, `docx`, `pdf`,
  `text`).
- **Tests split**: `services/api/tests/{unit,integration,security,e2e,helpers,fixtures}` (same 87 tests).
- **Config validated at boot**: one schema (`src/config/defaults.js`); production refuses to start without
  `DB_USER`/`DB_NAME`, and any non-numeric value in a numeric variable (or a malformed URL) stops the API with a
  message listing every problem. `.env.example` → `config/api.env.example`, every variable documented in
  `config/README.md`.
- **Request ids**: every response has an `X-Request-Id` header and every log line for that request carries `req_id`.
- **e2e** scripts fixed for Gemma-first routing (`config/e2e.env.example`, mock provider in every slot).
- **Frontend**: classic scripts → ES modules, split into `core/`, `pages/`, `components/` and `actions/` per app;
  the UI kit into `packages/ui/js/{colon,markdown,browser}/` behind its entry files; CSS split per concern
  (`packages/ui/css/*`, `apps/*/public/assets/css/*`); fonts in `packages/ui/fonts`, brand in `packages/brand`.
  `window.Colon` and the other globals keep their keys. The version shown in Help and Settings now comes from
  `Colon.version`.
- **Versioned deploy**: `scripts/deploy/build-docroot.sh` (run by `.cpanel.yml`) puts each release's modules under
  `/v<version>/` and copies `index.html` last; `.htaccess` is never written.
- **`scripts/check.js`** enforces syntax, ≤300 lines per file, ≤120 characters per line, API layer rules, app import
  rules, one version everywhere, and `config/api.env.example` matching the config schema.
- **Docs**: `docs/adr` → `docs/decisions`, phase notes → `docs/phases`; `docs/architecture.md` rewritten; new runbooks
  (`docs/runbooks/`: deploy, rollback, key rotation, backup and restore) and `docs/security/threat-model.md`.
- Dev tools: `scripts/dev/headless-check.js` (Playwright), `static-server.js`, `linkcheck.js`, `cycles.js`.
### URL changes
- Favicon is the SVG file `/v<version>/packages/brand/assets/colon-mark.svg` (admin: `colon-admin-mark.svg`)
  instead of an inline data URL.
- The Preview model list moved to `assets/config/models.json`.
- `/ui/` on the app subdomains now only mirrors the fonts (`/ui/fonts/`) for older pages; the kit itself loads from
  `/v<version>/packages/ui/`. `/brand/` keeps its old files.
### Not changed
- No other behaviour change: same API routes and responses, same database schema (no new migration), same
  screens.

## [0.5.3] — 2026-11-12 · Phase 5: web search with cited sources (Research mode)
Research mode now looks things up on the web before answering and cites what it found with tappable [1], [2] chips and a Sources list. Free and keyless by default; never breaks chat. Details: `docs/phases/phase-5-research.md`.
### Added
- **Web search** (`services/api/src/search/`): pluggable providers behind one interface `search(query, { limit, lang, signal }) → [{ title, url, snippet }]`. Keyless chain **DuckDuckGo** (html endpoint, lite as a second try, `uddg` redirects unwrapped, ads dropped) → **Wikipedia** (English, plus the Naijá/Yorùbá/Hausa/Igbo Wikipedia when the reply is in that language). Optional keyed providers, only used when configured: **Brave Search API**, **Tavily**, **SearXNG** (base URL). A provider that shows a captcha/anomaly page is marked blocked and rested for 10 minutes; any failure hands over to the next provider.
- **Page reader**: the top 3 result pages (admin: 0–5) read in parallel, ~6 s each and ~12 s overall, 1.5 MB cap, HTML only (PDFs and binaries skipped), main text kept (scripts, nav, header, footer, asides, cookie banners dropped) and trimmed to ~2,500 characters around the question. Wikipedia pages through Wikipedia's plain-text API. 10-minute in-memory LRU cache.
- **SSRF guard**: only http/https on ports 80/443, no credentials in URLs, every hop (max 3 redirects) must resolve to public addresses only (loopback, private, link-local/metadata, CGNAT, multicast and IPv6 equivalents refused after DNS resolution).
- **Research flow** (`chat/reply.js`): queries from the latest message (heuristic: filler removed, the year added for "current/latest" questions, a keyword variant, short follow-ups borrow the previous question's topic); for Naijá/Yorùbá/Hausa/Igbo a ~1 s model call writes English queries plus a faithful translation (4 s budget, heuristic fallback). New SSE events before the answer: `status` (`searching`, `reading` + count, `writing`, `unavailable`) and `sources [{ n, title, url, site, snippet }]`. The model gets the numbered sources with strict rules: cite [n] after the claims they support, only use the given sources for facts, say when they don't cover something, today's date in Africa/Lagos for recency, web text treated as untrusted data. If search fails entirely the answer still streams, starting with a short "web search wasn't available" notice. Daily limits and guest mode unchanged (the search runs after the limit check). Logs `search_ok` / `search_failed` (provider, ms, count; no query text).
- Sources are saved with the assistant message (existing `chat_messages.sources`) plus a new `web_search` column (`{ ok, provider, ms, read }`), so history and shared links show them.
- **Chat UI**: "Searching the web…" / "Reading N sources…" / "Writing from N sources…" status while it works; citations render as small superscript chips linking to the source in a new tab (`rel=noopener`); compact Sources row under the answer with the site's own favicon (hidden when missing), title and domain; a **Web** badge on answers that used search (**No web** when it failed). Works in light/dark and in shared chats.
- **Admin › System › Web search** (Super Admin): on/off (default on), provider order with per-provider on/off, results per search (3–8), pages read (0–5), SearXNG URL, and Brave/Tavily/SearXNG keys stored AES-256-GCM encrypted and shown masked. `GET/PATCH /admin/search`, `POST /admin/search/key` (audited).
- Migration `0006_web_search` (runs automatically on API start): `chat_messages.web_search JSON NULL`. New column only.
- New optional env vars: `WEB_SEARCH` (`off` to disable), `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `SEARXNG_URL`, `SEARXNG_API_KEY`.
- `services/api/scripts/research-check.js`: live check of search + reader + a full research answer with timings.
- Tests: `services/api/test/search.test.js` (DuckDuckGo and Wikipedia parsers on fixtures, blocked-page detection and fallback, SSRF guard and redirects, size cap, HTML to text, page reader, citation prompt, SSE `status → sources → answer` order, a failed search still answering, model-written queries) and Web search admin permissions/key masking in `admin.test.js`.
### Changed
- Research-mode system prompt: "you cannot browse" only when there are no web sources.
- Version 0.5.3 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.5.2] — 2026-11-12 · Phase 5: the Colon benchmark
### Changed (routing, from the first benchmark run)
- Every mode now goes Gemma 4 26B (Google) → MiniMax M3.1 Flash (NVIDIA) → Gemma 4 31B → Qwen → DeepSeek → GLM. African languages go Gemma 4 26B → Gemma 4 31B → N-ATLaS → MiniMax → Qwen → DeepSeek → GLM (MiniMax is weak in Yorùbá/Hausa/Igbo). New targets `gemma31` and `minimax` (`NVIDIA_MINIMAX_MODEL`). `.env.example`: `NVIDIA_GEMMA_MODEL` empty (NVIDIA's Gemma 4 31B is gone).
### Results (first run, 2026-11-12, `services/api/bench/results/2026-11-12.md`)
- Gemma 4 26B (Google) 94.6, fastest (0.8 s first token), wrong answers 0 (all 6 misses were Google 500s). MiniMax M3.1 Flash 88.9 (weak Yorùbá/Hausa/Igbo). Gemma 4 31B 83.5 (21 s first token). Gemini 3.5 Flash Lite 96.8 (reference only). DeepSeek V4.1 Flash and GLM-5.3 Flash (NVIDIA) answered nothing. Nemotron and Mistral Large 4 incomplete.
Saga's default is now chosen by benchmark score, and a model can only go into routing after a fresh benchmark. Details and the score formula: `docs/phases/phase-5-benchmark.md`. First live run: `services/api/bench/results/2026-11-12.md`.
### Added
- **The Colon benchmark** (`services/api/bench/sets/*.json`, suite `colon-bench-1`, 135 original items): Nigerian everyday questions, WAEC-style, JAMB-style, university study, coding, reasoning, tool use (tool calls and structured JSON), and Naijá, Yorùbá, Hausa and Igbo. Everything is graded automatically: multiple-choice letters, numbers (`Answer:` line, ₦, commas, fractions), accent-insensitive keywords and regex, JSON parsed and checked against a schema subset and expected values, JavaScript run against unit tests in a **sandboxed child process** (fresh `vm` context, no `require`/`process`/network, CPU and wall-clock timeouts), and a target-language check (function words vs English, plus subdots/tone marks/hooked letters). Optional LLM judge for the language sets (`--judge`).
- **Runner** `npm run bench` (`services/api/scripts/bench.js`, core in `src/bench/`): asks every candidate through the app's own provider client with Saga's real system prompt per mode and language, and records per item the score, first-token and total time and errors. Polite to free tiers: one or two requests at a time per model (per provider with `--concurrency-<provider>`), a gap between items, two retries with back-off on 5xx/timeouts, and longer waits on 429 that don't count as failures. A model with more than 50 % errors after 20 items is stopped as **unreliable**. Resumable (`--run`, `--retry-errors`), re-gradable from saved replies (`--report --regrade`). Writes `bench/results/<run>.md` (scoreboard and every failure), `.json` and `.eval.json`.
- **Score**: `100 × (0.60 accuracy + 0.15 language quality + 0.10 speed + 0.15 reliability)`; cost is recorded ($0 on the free tiers) and breaks ties.
- **Admin › Evaluation** shows benchmark runs: `--save` writes them to `eval_runs`, or post `bench/results/<run>.eval.json` to the new `POST /admin/evaluation/bench`. `GET /admin/models` shows each model's latest benchmark score.
- **The model-change gate** (`src/bench/gate.js`): adding a model, changing a model's id or host, switching one back on, or giving a mode a new first choice in Routing is refused with `409 needs_benchmark` unless a finished benchmark of exactly that provider + model is newer than `BENCH_MAX_AGE_DAYS` (default 30). A Super Admin can skip it once with a written reason (audited); `BENCH_GATE=off` turns it off. CLI: `npm run bench -- --gate provider:model`.
- Migration `0005_bench`: new `eval_runs` columns (`kind`, `provider`, `suite`, `items`, `error_rate`, `first_token_ms`, `details`) and an index.
- Tests: `services/api/test/bench.test.js` (graders, sandbox, every coding item solvable by a reference solution, aggregation and the score, the runner against a mock provider including retries, 429 waits and the unreliable stop, the report, the gate and its wiring into the admin routes).
### Changed
- Version 0.5.2 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.5.1] — 2026-11-12 · Fix: Delete account tap
### Fixed
- The decorative COLON intro wordmark could sit over Settings › Account › **Delete account** and swallow taps on the middle of the row. The intro artwork now has `pointer-events:none`, the faded intro drops behind the page (`visibility:hidden`, `z-index:-1`) and is removed after a tap-to-skip, and the decorative brand marks (`.logo-mark`, `.auth-mark`, `.cw-hero-mark`) never take a tap.
- Version 0.5.1 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`, so phones load the fixed CSS instead of a cached copy.

## [0.5.0] — 2026-11-12 · Phase 4: Admin Dashboard
Every platform setting can now be changed from admin.apparatus.name.ng, and each role sees only what it is allowed to (enforced by the API; every change is audited). Details: `docs/phases/phase-4.md`.
### Added
- **Overview** from stored data: users, chat requests and failures, provider success rates and reply latency, top errors and open reports (new `ai_calls` log, one row per provider attempt, kept 30 days).
- **Models and providers**: add, edit, enable and disable providers and models in the database. Provider API keys are **Super Admin only**, stored AES-256-GCM encrypted (key from `APP_SECRET`) and only ever shown masked (`••••1234`). Environment keys stay the fallback; the first model edit copies the built-in table into the database.
- **Routing** per mode (General/Saga, Study, Developer, Research and the African-languages route): ordered model list with fallbacks, plus the hedge count. **Live, no redeploy:** each worker re-reads within ~30 s. If the database config is empty, broken or leaves no usable model, routing falls back to `routing.js` (chat never breaks).
- **Usage and limits**: member, guest and guest-per-IP daily limits, optional per-mode daily caps, and a per-user override, all editable live.
- **Users**: search and filters (staff, suspended), user page with sessions (revoke one or all), recent sign-in events, role, daily limit, and **suspend/unsuspend** (a suspended user is blocked at sign-in, including Google, and every session is revoked).
- **Moderation queue**: "bad" feedback on replies plus reports on shared links (new **Report this chat** button on shared chats, `POST /shared/:token/report`), with resolve, resolve-and-turn-off-the-link, dismiss and reopen. Feedback context is hidden when the user turned off sharing feedback.
- **Evaluation** (stub): log benchmark runs, and see thumbs up/down per model and the reasons for bad ratings (full benchmarks are Phase 5).
- **African AI registry**: CRUD list of language models and datasets with languages, licence, licence link, source link, commercial-use and status.
- **Voice**: STT/TTS engine settings (stored only, for Phase 6). **Browser**: placeholder until Phases 8–10.
- **System settings** (Super Admin): product name, feature flags (sign-ups, guest chat, uploads, share links), **maintenance mode** (new chat activity gets `503 {error:"maintenance"}` with your message; staff exempt; history still loads) and an **announcement banner** shown in Colon AI.
- **Security**: staff 2FA status, sign-in counts (24 h), sign-in events and the full audit trail.
- Mobile-first admin UI (`apps/admin/public/js/admin-app.js`, `css/admin.css`): bottom tabs for Overview, Users, Moderation and More; every section in the desktop sidebar.
- Migration `0004_admin` (runs automatically on API start): `app_settings`, `ai_providers`, `ai_models`, `ai_calls`, `user_limits`, `user_suspensions`, `moderation_reports`, `eval_runs`, `african_registry`. New tables only.
- Tests: `services/api/test/admin.test.js` (permission matrix for every admin endpoint, live routing and fallback, settings cache, limits, call log) in `npm test`; `services/api/test/e2e-admin.js` runs the whole dashboard API against MySQL and the mock provider.
### Changed
- Moderators now get moderation plus **read-only** users (unlocking an account and `/admin/stats` moved to Admin).
- `/health` reports `ai.routing` (`database` or `default`). `/auth/config` adds `brand_name`, `features`, `maintenance` and `announcement`.
- Nav items in the UI kit can stay out of the tab bar (`tab: false`) or the sidebar (`side: false`); the shell brand follows the system brand name.
- Version 0.5.0 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.4.4] — 2026-11-11 · ~1 s first reply
- **Gemma 4 26B A4B is the main Google model** (first token ≈0.7–1.2 s in tests); Gemma 4 31B is now the Google backup (often 500/503 or 14 s+).
- **Rolling hedge pool:** two models always in flight; one that fails fast is replaced at once instead of waiting for the slow one.
- **Quick 5xx retried once** on the same model (Google's free tier throws random 500s that succeed on retry).
- NVIDIA Gemma disabled by default (`NVIDIA_GEMMA_MODEL` empty; the model id now 404s on NVIDIA). NVIDIA DeepSeek/GLM stay as backups (free tier queues 7–34 s before the first token).
- `ai_reply_ok` log line (provider, model, ms) in stderr.log so the live winner is visible.

## [0.4.3] — 2026-11-11 · Faster replies: hedged racing
- **Saga asks two models at once** (from different providers, e.g. DeepSeek on NVIDIA and Gemma 4 on Google) and streams whichever starts answering first; the other is cancelled. A slow or overloaded free host no longer adds 25 s of "thinking". If both fail before answering, the next pair is tried. `AI_HEDGE` (default 2; 1 = one at a time).
- Live server log before this fix: NVIDIA DeepSeek first-token timeouts and Google Gemma 500/503 "high demand" errors, tried one after another.

## [0.4.2] — 2026-11-11 · NVIDIA provider (free DeepSeek)
- **New provider: NVIDIA build.nvidia.com** (`NVIDIA_API_KEY`). DeepSeek V4.1 Flash is now the first DeepSeek target (thinking off, answers in about 2–7 s), Gemma 4 31B on NVIDIA is a second Gemma host after Google, and GLM-5.3 Flash is the last fallback on every route.
- Routing targets can now carry per-model request options (`body`).
- Tested live: a Pidgin General question and a Developer question both answered through NVIDIA DeepSeek.

## [0.4.1] — 2026-11-11 · Saga reliability fixes
### Fixed
- **Google AI Studio (Gemma 4)**: Google doesn't serve Gemma models on its OpenAI-compatible endpoint, so every Gemma call failed and Saga answered "couldn't reach an AI provider". The client now talks to the native Gemini API (`/v1beta/models/{model}:streamGenerateContent?alt=sse`, `x-goog-api-key`), sending the system prompt as `systemInstruction`, assistant turns as `model`, images as `inlineData`, and hiding thought parts. New `GEMINI_THINKING` (default `minimal`, or `high`, or `off`).
- A second Google model, Gemma 4 26B A4B (`GEMINI_FALLBACK_MODEL`, `off` to disable), now backs up Gemma 4 31B, so a Google error on one doesn't leave Saga silent.
- **No more endless "thinking"**: the chat app now turns a non-stream answer (such as a hosting firewall page), a stream silent for 90 s, or a stream that closes without finishing into a clear error with Retry.
- warn/error logs go to stderr, so cPanel's `stderr.log` shows provider failures.

## [0.4.0] — 2026-11-11 · Phase 3: Colon AI chat backend, model router v1, guest chat
### Added
- **Chat API** (`services/api/src/http/routes/chat.js`, `uploads.js`): every endpoint the remote chat adapter expects. Conversations (list, search, create, rename, pin, archive, delete one or all, export), streamed replies as server-sent events (`user` → `start` → `delta`… → `done`, or `error {code}`), **Stop** (closing the stream, or `POST …/messages/:mid/stop`, which also reaches another worker), **regenerate** (new version replaces the reply), **edit** a sent message (re-answers from there), AI Browse notes, **feedback** (good/bad + reason + comment, stored with the provider and model for evaluation), **share links** (read-only `GET /shared/:token`, can be turned off), chat settings and stats, and `GET /models` from configuration.
- **Uploads**: images, PDF, Word/PowerPoint/Excel/ODT/RTF, text and code files, and recorder voice notes. The real file signature is checked server-side (a renamed `.exe` is refused), size limits match the app (images 10 MB, documents 20 MB, text 2 MB, 5 per message), and files are stored outside web roots with a per-user quota. Text is extracted once at upload with Node built-ins only: PDFs (including compressed object streams and subset fonts with ToUnicode maps, so Yorùbá tone marks and ₦ survive), DOCX/PPTX/XLSX/ODT (built-in ZIP reader), RTF, and an approximate reader for old .doc/.ppt/.xls. Scanned PDFs say they have no text layer. Images go to a vision-capable model when one is configured; otherwise the reply explains it (`no_vision`).
- **Model router v1** (`services/api/src/ai/`): provider-agnostic OpenAI-compatible streaming client (built-in `fetch`), with Groq (Qwen), OpenRouter (DeepSeek, Gemma 4), Google AI Studio (Gemma 4) and N-ATLaS, each enabled only when its key is set and every model id env-overridable. Routing table in one file (`routing.js`) for Phase 4: Naijá, Yorùbá, Hausa or Igbo replies go DeepSeek → N-ATLaS → Gemma 4 → Qwen; General/Study/Research go Qwen → DeepSeek → Gemma 4; Developer goes DeepSeek → Qwen → Gemma 4. Automatic fallback on errors, 429s, missing models and timeouts before the first token (no silent switch mid-answer), with a short rest for a failed target so it doesn't slow every reply. `<think>` reasoning is hidden. `/health` reports which providers are on.
- **The African layer**: per-mode system prompts (General, Study as a patient Nigerian teacher, Developer, Research), Nigerian context and examples, and replies in the user's language. The profile language wins; otherwise Naijá, Yorùbá, Hausa or Igbo is detected from the message.
- **Daily limits** per user and a lower one for guests, in MySQL (`CHAT_DAILY_LIMIT`, `CHAT_GUEST_DAILY_LIMIT`). Guests are counted per browser (an anonymous `colon_gid` cookie), plus a higher shared cap per hashed IP (`CHAT_GUEST_IP_DAILY_LIMIT`) because many mobile users sit behind one carrier IP; raw IPs are never stored. A reply that no provider could give is not counted.
- **Guest chat (ChatGPT-style)**: Colon AI works without an account. Guests chat with Saga through `POST /chat/guest` (streams, saves nothing; origin-checked, rate limited) and the conversation lives only in that tab. Guests can attach documents (read once by `POST /chat/guest/extract`, not stored); images need an account. The sidebar shows **Log in / Sign up** and "Log in to save your chats"; History, Saved and Settings ask guests to log in.
- **New sign-in flow** (`packages/ui/assets/colon-app.js`): **Continue with Google** on top, **OR**, email → **Continue** → password (log in) or name/password/language (sign up), with links to switch, forgot password and the 2FA step. It opens as a dialog in Colon AI (bottom sheet on phones) and is also the `/login` and `/register` page in every app. It reuses the Phase 2 endpoints and never asks the server whether an email exists.
- Migration `0003_chat` (runs automatically on API start like `0002`): `chat_conversations`, `chat_messages`, `chat_attachments`, `chat_feedback`, `chat_settings`, `chat_usage`.
- Unit tests for the router (language and mode routing, fallback order, timeouts, Stop, SSE parsing, `<think>` filtering) and chat helpers (limits, language detection, prompts, context budget, file checks, PDF/DOCX/XLSX/RTF extraction) with mocked `fetch`; `npm test` runs them with the UI tests. `services/api/test/e2e-smoke.js` and `test/helpers/mock-provider.js` run a full guest + account flow against MySQL/MariaDB with a fake provider.
### Changed
- **Colon AI no longer forces sign-in.** The chat app picks its data adapter on start: your account when signed in (Remote, the new default), a guest chat when signed out, and the on-device Preview only when the API can't be reached. Signing in or out reloads into the right mode. The Admin Dashboard still requires sign-in (and 2FA), and Colon Browser is unchanged.
- "Save chat history" off now makes signed-in chats temporary (streamed through `/chat/guest`, never saved).
- Version 0.4.0 across `package.json`, `services/api/package.json`, every `?v=` asset reference and `Colon.version`.

## [0.3.1] — 2026-11-11 · Mobile fixes: scrolling, floating composer, stale-cache crash
Frontend only: no changes to `services/api`, `database`, `.cpanel.yml` or server configuration.
### Fixed
- **Scrolling on phones (Colon AI and Colon Browser).** Root cause: below 900 px both app shells stack vertically, and the flex column item between the fixed frame and the scroll area (`.cw-main` / `.bw-main`) had no `min-height:0`. It grew to the full height of its content, so the inner scroll areas (`#cw-scroll`, `.bw-page`, `.cb-viewport`) never overflowed, and the frame (`overflow:hidden`) clipped everything. Nothing could be scrolled by touch on any page. Desktop was unaffected because the shell is a row there. Fixed with `min-height:0` on `.cw-main`, `.cw-chat`, `.cw-split` and `.bw-main`. Verified with real touch drags (CDP touch events, 360×780, mobile emulation) on welcome, conversation, History, Saved, Explore, Settings, Help, the drawer list, and browser home, reader view, tabs, bookmarks, history, downloads, settings and help, plus mouse-wheel at 1440×900.
- **Colon Browser "C.keyboard is not a function".** Phones were running a stale cached `/ui/colon-app.js` from v0.2.0. Every CSS, JS and font reference in `apps/chat`, `apps/browser` and `apps/admin` `index.html` (and the `@font-face` URLs in `colon-ui.css`) now carries `?v=0.3.1`. Boot is defensive: optional kit helpers (`keyboard`, `resizable`, `verifyBanner`, `bindBanner`) are feature-checked before use, each app checks the kit (`Colon.version` plus the helpers it needs) before starting and shows a friendly **Please refresh** screen if an old kit loads, and a screen that fails to draw shows the same refresh card instead of a raw error. New `public/.htaccess` in each app sends `Cache-Control: no-cache` for `index.html` only. `scripts/check.js` now fails CI if any asset reference is not on the `package.json` version.
- Welcome subtitle is now exactly "Your ideas, questions and ambitions start here." (it was prefixed with the first word of the account name).
### Changed
- **Colon AI mobile footer removed.** The Home / History / Saved / Profile tab bar is gone, and those screens are in the hamburger drawer and sidebar. The shared account screens no longer show a tab bar in Colon AI or Colon Browser (`Colon.start({ tabbar: false })`). Colon Browser keeps its bottom navigation controls (back, forward, home, tabs, menu).
- **Floating composer.** The input is now a rounded pill that floats above the bottom edge, with side and bottom margins. It respects the safe area and sits above the on-screen keyboard (`visualViewport`, `100dvh` fallback). It has a soft shadow and blur, and the thread scrolls underneath it behind a fade. Attach, mode, mic and send are inside the pill. The mode is a compact button in the pill with a menu (General, Study, Developer, Research, Browse the Web). On the welcome screen the Study / Developer / Research chips scroll with the content and are horizontally scrollable without catching vertical swipes. Attach File / Voice Input / Browse the Web chips show on the desktop welcome screen only.
- **Scrolling behaviour.** There is one scroll container per view, and the page behind full-screen apps is locked (`html.app-lock`). Momentum scrolling is on, and `overscroll-behavior: contain` is set on the thread, drawer, conversation list, browser pages and tab strip. While a reply streams, the thread follows only if you are at the bottom. Scrolling up (touch, wheel or keys) stops the follow and shows a **Latest** button. Entry animations play only for new messages, and older messages use `content-visibility: auto` so long threads stay light.
- The "Preview" labels for the on-device data mode are unchanged, and they go away when the backend is connected.

## [0.3.0] — 2026-11-11 · Colon AI + Colon Browser interfaces (UI)
Frontend only: no changes to `services/api`, `database/migrations`, `.cpanel.yml` or server configuration.
### Added
- **Design system v2** (`packages/ui`): royal-blue tokens from the UI spec (#4169E1, #3457C7, #101B3D, #080F24, #EAF0FF, #38BDF8, #0F172A, #64748B, #E2E8F0, #16A34A, #DC2626), light and dark themes with no flash, self-hosted Inter and JetBrains Mono (OFL), new flame logo "COLON AI by Nifelux", glass surfaces, and shared components with every state (default, hover, active, focus, disabled, loading, error): buttons, inputs, switches, segmented controls, chips, popover menus with keyboard navigation, confirm and prompt dialogs, tooltips, drawers, toasts with actions, loaders, progress, skeletons, resizable split handles, 94 inline SVG icons. `visualViewport` tracking keeps inputs above the on-screen keyboard.
- **Colon AI** (`apps/chat`): welcome screen ("What can we explore today?", four prompt cards, Study / Developer / Research modes, input with attach and mic, Attach File / Voice Input / Browse the Web), chat workspace with collapsible sidebar (New Chat, search, Saved, Recent, History, Settings, Help, account), header (sidebar toggle, title rename, model selector, new chat, browser, theme, profile), token-by-token streaming with stop, Markdown, highlighted code with copy, tables, maths, citations and source cards, copy / regenerate / feedback with reasons / read aloud, auto-growing input, mode kept per conversation, model list from configuration, rename / pin / archive / delete with confirmation, uploads (images, PDF, documents, text) with previews, progress, validation and error states, voice input (live dictation or voice notes, with permission-denied, no-microphone and unsupported states), Settings (account, appearance, language, voice, chat preferences, privacy, data export and deletion, sign out), History, Saved, Explore and Help screens, and the integrated browser in embedded and split modes (resizable on desktop, switchable on mobile) sharing one browser session.
- **Colon Browser** (`apps/browser`): standalone app with sidebar (Home, Tabs with count, Bookmarks, History, Downloads, AI Browse, Settings, Help), address bar for URLs and searches with suggestions, back / forward / refresh / home / bookmark / download / full screen, tabs with a mobile tab overview, bookmarks with folders, date-grouped searchable history, downloads and uploads, settings (homepage, search engine, appearance, privacy, permissions, downloads, sessions, clear data), session restore, and visually distinct AI / Manual / Shared control modes with Take Control, Return to AI, Pause AI and Stop. Handoff pauses pending automation before the user takes over. The AI Browse panel shows the task, current site, progress, steps, an action log and sources; Shared mode asks for approval before each action.
- Honest **web reader preview** (docs/decisions/0002): pages are fetched as data, sanitised and rendered without scripts; private and local addresses are blocked by a unit-tested URL guard; sites that refuse cross-origin reads show an "open in new tab / Android app" state.
- **Data adapters** (`apps/chat/public/js/chat-data.js`, `packages/ui/assets/colon-browser-data.js`): every new screen works today on an in-browser implementation (IndexedDB, simulated streaming, on-device preview replies labelled "Preview") and switches to the API with `localStorage['colon.data'] = 'remote'`. Expected endpoints: `docs/frontend-data-adapters.md`.
- Unit tests (`node --test "packages/ui/test/*.test.js"`) for the Markdown renderer, URL/SSRF guard, preview responder and storage; CI runs them.
### Changed
- The animated intro and the Admin Dashboard pick up the new royal-blue brand through the shared design system. Account screens gain an Appearance (theme) control.

## [0.2.0] — 2026-11-11 · Phase 2: Accounts & security
### Added
- Accounts: register, sign in, Google sign-in (when `GOOGLE_CLIENT_ID` is set), email verification and password reset through Brevo (when `BREVO_API_KEY` is set).
- Sessions: httpOnly, Secure, SameSite=Lax cookie shared across Colon apps; device list, sign out one device or all others.
- Roles: Member, Moderator, Admin, Super Admin (`OWNER_EMAIL` becomes Super Admin). TOTP two-factor, required for every staff role.
- Security: scrypt password hashing, AES-256-GCM for 2FA secrets, MySQL-backed rate limits, lockout after 5 failed passwords, CSRF header + origin check, input validation, security headers, audit log.
- Profile with language preference (English, Naijá, Yorùbá, Hausa, Igbo), draft Terms and Privacy, account deletion.
- Admin: overview stats, users and roles, unlock, sign out a user, audit log.
- `packages/ui`: Colon design system and app core. Mobile-first: bottom tab bar, desktop sidebar, safe areas, bottom sheets, smooth route transitions.
- Database migrations now run automatically on API start (`0002_auth`).
### Changed
- Root `package.json` no longer uses npm workspaces, so cPanel installs API packages inside `services/api`.

## [0.1.0] — 2026-11-11
### Added
- Monorepo structure for Nifelux · Colon AI.
- `services/api`: Node 24 API with `/health` and the `/ws` WebSocket gateway.
- `apps/chat`, `apps/browser`, `apps/admin`: app shells with the animated COLON logo intro.
- cPanel Git deployment (`.cpanel.yml`), CI syntax check, and docs.
