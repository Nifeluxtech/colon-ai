# Changelog

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
