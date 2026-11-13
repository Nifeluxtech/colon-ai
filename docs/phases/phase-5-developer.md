# Phase 5 — Developer mode (v0.5.9)

Developer mode is Colon Saga as a senior engineer: it explains, fixes, generates and reviews code, and it can read a
whole project. Attach code files or a `.zip` of the project once; every later message in that conversation keeps
the project as context. Free and in process: no new dependency, no model call to read the project, no migration.

Code: `services/api/src/modules/developer/` (`snapshot.js`, `project.js`, `rules.js`, `index.js`), the safe ZIP
reader `services/api/src/modules/extract/zip.js`, the prompt in `services/api/src/modules/ai/prompts.js`, wired in
`services/api/src/modules/chat/{context,files,reply}.js` and `chat/handlers/{messages,guest,uploads}.js`. App:
`apps/chat/src/components/composer.js` (quick actions), `apps/chat/src/core/{state,common}.js`. Tests:
`services/api/tests/{unit/developer-prompt,unit/developer-project,integration/developer-flow}.test.js`.

## The prompt

`Mode: Developer` replaces the old three-line prompt. It tells Saga to:

- **Explain**: walk through the code in order, then data flow, complexity (Big-O) where it matters, pitfalls.
- **Fix**: name the bug and where it is, give the root cause, then the corrected code as a minimal diff (or a
  before/after of the changed lines) for a small fix, or the full file when changes are spread out; end with how to
  test it (command, input, expected output).
- **Generate**: complete runnable code (no "rest of the code here"), every file named by path, dependencies with
  install commands, run instructions and a quick check.
- **Review/refactor**: findings by severity (bugs, security, correctness, performance, readability), each with the
  improved code, behaviour unchanged unless asked.
- Always fenced code blocks with a language tag; code, identifiers, commands and errors stay in English while the
  prose follows the reply language (English, Naijá, Yorùbá, Hausa, Igbo).
- Never invent APIs, flags, packages or versions; say when unsure and how to check. Never claim it ran code.
- Secure by default: no hard-coded secrets, parameterised SQL, input validation, output escaping, password hashing.
- One clarifying question only when the answer truly depends on it; otherwise state the assumption and answer.
- Nigerian context when relevant: shared cPanel hosting, data costs, Paystack (kobo, server-side verification and
  webhooks) and Flutterwave, without inventing their endpoints.

Every mode still carries the safety section (refusals, no prompt leaks, the untrusted-content rule).

**Output cap.** Developer replies ask for `AI_DEVELOPER_MAX_TOKENS` (default 8192) instead of `AI_MAX_TOKENS` (4096),
so whole files fit (`ai/generate.js`; an explicit `timeouts.maxTokens` still wins). Routing is unchanged: Developer
uses the current routing table (Admin › Routing).

## Quick actions (app)

When Developer is the mode, a row of chips sits above the composer: **Explain**, **Fix a bug**, **Generate**,
**Review** and **Attach project**. A chip fills the composer with a short template and puts the cursor where the
user types next; code already in the box moves under the template, and an untouched template from another chip is
replaced. Attach project opens the file picker. The row scrolls sideways on phones and hides in the other modes.

## Project files

### What can be attached

- Single code and text files (2 MB each): the old list plus `jsx tsx mjs cjs vue svelte scss less h hpp kt swift rb
  dart lua r pl toml ini cfg conf .env.example gradle properties bat ps1 graphql prisma twig ejs hbs`, and
  extensionless files such as `Dockerfile`.
- A `.zip` of a project (20 MB, the document limit), stored as kind `doc` with mime `application/zip` (no schema
  change). Other ZIP-based files (`.jar`, `.apk`) are still refused. The usual limits hold: 5 files per message and
  the per-user upload quota.

### Reading a .zip safely (at upload, once)

`extract/zip.js` is the one ZIP reader (Office documents use it too):

- An entry name with `..`, a leading `/` or `\`, a drive letter or a NUL byte refuses the **whole archive**
  (422 `unsafe`). Office containers simply drop such names.
- Zip bombs: the declared unpacked total over 128 MB is refused (`too_large`); any entry over 1 MB that unpacks to
  more than 200× its compressed size is refused (`unsafe`); each entry is inflated with `maxOutputLength` capped to
  its declared size, so a lying entry can't grow. Over 20,000 entries is refused. Encrypted and ZIP64 entries are
  skipped.

`developer/snapshot.js` then keeps a JSON snapshot in `chat_attachments.text` (`meta.format = 'zip'`):

- The single top folder GitHub-style downloads add (`my-app-main/`) is stripped.
- **Ignored folders** (counted, never listed one by one): `node_modules`, `.git`, `vendor`, `dist`, `build`,
  `.next`, `.nuxt`, `__pycache__`, `.venv`/`venv`, `target`, `coverage`, `.idea`, `.vscode`, `__MACOSX` and other
  cache/tool folders (`rules.js`).
- **Listed without contents**: binaries, images, fonts, media, archives, PDFs/Office files, source maps (`binary`);
  `*.min.js`, bundles and chunks (`minified`); lockfiles such as `package-lock.json`, `yarn.lock`, `composer.lock`
  (`lockfile`, size only); `.env`, `.env.*`, `.npmrc`, private keys and certificates (`secret`; `.env.example` and
  other `.example/.sample/.template` files are read); files over 1 MB (`too_large`); non-UTF-8 or NUL bytes
  (`not_text`).
- Up to 3,000 files listed, 200,000 characters per file and 2,000,000 characters per archive kept.
- The upload answer's `note` says e.g. "Project archive: 42 files (JavaScript, PHP)."

Guests keep files in the tab, so `POST /chat/guest/extract` returns a plain rendering of the project (tree + the
most relevant files, about 20,000 characters) instead of the snapshot.

### The context for each reply

For every Developer reply (send, regenerate, edit, guest), `chat/context.js forMode()` gathers the code files and
`.zip` snapshots attached to **every message so far** (so a follow-up with no files still has the project), and
`developer/project.js` builds one block that goes into the system context:

1. **Merge**: a later file with the same path wins; a single file whose name matches exactly one path in an archive
   replaces that file (the user re-attached a fixed copy).
2. **Order**: files the user names in the message being answered (full path or a distinctive file name, in the
   order mentioned); then entry points and configs (`package.json`, `composer.json`, `requirements.txt`, README,
   Dockerfile, `.htaccess`, `main/app/index/server/routes/config/settings.*`, `*.config.js`, …), shallowest first;
   then the rest, source code before data/docs, smallest first.
3. **Budget**: 48,000 characters of file contents per reply (about 12k tokens), at most 12,000 per file or 24,000
   for a file the user named. A file that doesn't fit is cut at a line end ("truncated: first 12,000 of 40,210
   characters") or, below 400 characters of room, omitted ("over the context budget").
4. **Header and tree**: counts (listed, sent in full, truncated, not sent), languages by file count, and the file
   tree with sizes, every truncated or omitted file marked with its reason, and the ignored folders. The model is
   told never to guess a missing file and to ask the user to paste it.
5. **Untrusted**: the tree and every file go in their own `<<<FILE untrusted id=… path: …>>>` block with a random end
   marker, after the injection guard (`safety.collector().clean`): "ignore previous instructions", fake role tags,
   forged delimiters and hidden characters are neutralised and logged as `prompt_injection` safety events.

The messages themselves then only say `[Attached project archive: “shop.zip”] (its contents are in the project
context)`, and the history gets the rest of the prompt budget (60,000 characters minus the project block, at least
16,000). In the other modes nothing changes, except that a `.zip` shows as a short plain rendering in its file
block (24,000 characters on the latest message, 3,000 on older ones).

## Limits and later

- The budget is fixed in `developer/project.js` (`BUDGET`, `PER_FILE`, `NAMED_FILE`); make it configurable if free
  tiers allow more.
- No retrieval over very large projects yet (embeddings or symbol search); naming the file is the way to make sure
  it is read.
- Folder upload from the browser (`webkitdirectory`) is not wired; zip the folder instead.
