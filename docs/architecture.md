# Architecture

Colon AI by Nifelux: three static web apps and one Node API in one repository, deployed to a shared cPanel host.

```
  chat.apparatus.name.ng   browser.apparatus.name.ng   admin.apparatus.name.ng     static web apps (ES modules,
        apps/chat                apps/browser                apps/admin              no build step)
            └──────────────── HTTPS (JSON, SSE) + WebSocket ────────────────┘
                                         │
                              api.apparatus.name.ng                               Node 24 under Passenger
                                    services/api
                    ┌───────────────┬────┴───────────┬──────────────────┐
                 MariaDB      AI providers       web search +        Brevo (email)
                (MySQL)     (Google AI Studio,   page reader         Google sign-in
                             NVIDIA, Groq,       (DuckDuckGo,
                             OpenRouter,          Wikipedia, Brave,
                             N-ATLaS)             Tavily, SearXNG)
  Android app (Phase 7): Android System WebView as the Colon Browser engine, bridged to the API (docs/decisions/0002).
```

Hosting: AfeesHost cPanel 138 on CloudLinux, 1 GB RAM, 20 entry processes, 5 GB disk, SSH, Git Version Control,
cron and JetBackup; no browser terminal and no server-side Chromium. Passenger recycles workers at any time, so no state
may live only in memory (in-memory caches and "resting" model lists are per worker and only an optimisation).

## Repository

```
colon-ai/
├── apps/                        static web apps; each deployed to its own subdomain document root
│   ├── chat/                    Colon AI
│   │   ├── public/              index.html + assets/css/, assets/config/models.json: copied to the docroot as is
│   │   └── src/                 ES modules: main.js (boot), core/, pages/, components/, actions/, lib/
│   ├── browser/                 Colon Browser: public/, src/{main.js, core/, components/, pages/}
│   └── admin/                   Admin Dashboard: public/, src/{main.js, core/, components/, pages/}
├── packages/
│   ├── ui/                      design system and shared code: js/ (colon.js = window.Colon, colon/, markdown/,
│   │                            browser/, store.js, url.js), css/ (tokens, base, components, content, browser),
│   │                            fonts/ (Inter, JetBrains Mono), test/ (node --test)
│   └── brand/                   logo marks (assets/), intro animation (css/, js/)
├── services/
│   └── api/                     the Colon API
│       ├── app.js               Passenger startup file (requires src/http/server.js)
│       ├── src/
│       │   ├── config/          defaults.js (THE schema), env.js (read + validate), index.js (config object)
│       │   ├── http/            server.js (middleware), router.js, middleware/, routes/{health,auth,account,
│       │   │                    admin,chat}/ and routes/study.js (wiring only)
│       │   ├── ws/              WebSocket gateway (/ws)
│       │   ├── modules/         account, admin, ai, auth, bench, chat, extract, health, safety, search,
│       │   │                    study; each has an index.js facade and its handlers/ where it serves routes
│       │   ├── shared/          logger, request-context, crypto, audit, settings, mailer, validate,
│       │   │                    ratelimit, security-headers, multipart
│       │   └── db/              MariaDB pool and migration runner
│       ├── tests/               unit/, integration/, security/ (npm test), e2e/ (needs MariaDB), helpers/, fixtures/
│       ├── bench/               benchmark sets/ and results/
│       └── scripts/             bench.js, research-check.js, dump-routes.js
├── database/migrations/         SQL migrations, applied in order at API start (forward-only)
├── config/                      api.env.example, e2e.env.example, README.md (every variable)
├── scripts/
│   ├── check.js                 repository rules (CI)
│   ├── deploy/                  build-docroot.sh (+ test)
│   └── dev/                     headless-check.js, static-server.js, linkcheck.js, cycles.js
├── docs/                        this file, deployment.md, frontend-data-adapters.md, decisions/, phases/,
│                                runbooks/, security/
├── .cpanel.yml                  cPanel "Deploy HEAD Commit" tasks
└── .github/                     CI, templates, code owners
```

## Rules `scripts/check.js` enforces

CI runs `node scripts/check.js`; it exits 1 on any failure.

1. **Syntax**: every `.js` file passes `node --check`.
2. **Size**: source files (`.js .css .html .sh .yml .sql`) have at most 300 lines and no line over 120 characters.
   Exempt: test fixtures, benchmark sets and results, migrations, fonts.
3. **API layers** (`services/api/src`), dependencies point one way: `http`, `ws` → `modules` → `shared`, `db`, `config`.
   - Route files (`http/routes/`) import only module facades (`modules/<name>/index.js`), `shared/`, `config/`,
     `http/middleware/`, `http/router.js` and other route files.
   - No file imports another module's internals; cross-module use goes through that module's `index.js`.
   - `modules/`, `shared/`, `db/` and `config/` never import `http/` or `ws/`.
   - `shared/`, `db/` and `config/` never import `modules/`.
   - Every relative `require` resolves to a file.
4. **Web apps**: app modules use relative imports only; they import `packages/ui/js` only through its entry files
   (`colon.js`, `store.js`, `url.js`, `markdown/index.js`, `browser/index.js`, `browser/data.js`,
   `browser/saga-browse.js`) and never another app. Every local asset URL in `apps/*/public/index.html` is on the
   current version (`/v<version>/...` or `?v=<version>`), and `Colon.version` and every `package.json` version equal
   the root `package.json` version.
5. **Config**: `config/api.env.example` lists exactly the keys of the API config schema.

## Request flow (API)

`src/http/server.js` handles every request in this order:

1. **Request id**: an incoming `X-Request-Id` is kept when it is plain and 8–128 characters, otherwise a UUID is
   made. It is echoed in the `X-Request-Id` response header and stored in an `AsyncLocalStorage` context, so every
   log line written while handling the request carries `req_id`. Quote it when reporting a problem.
2. **CORS** for allowed origins (`ALLOWED_ORIGINS`); `OPTIONS` answers 204.
3. **Route match** (`http/router.js`, first match wins, order is part of the contract): 404 / 405.
4. **CSRF**: state-changing methods need an allowed `Origin` (when sent) and the `X-Colon-Client` header.
5. **Request parsing**: client IP, query, params, cookies, JSON body (per-route limit; uploads read raw).
6. **Session** (`modules/auth` sessions) loads `req.user` (skipped for `/` and `/health`).
7. **Maintenance mode**: chat writes get 503 for non-staff while an admin has maintenance on.
8. **Handlers**: the route's guards (`requireUser`, role checks, feature switches), rate limits
   (`limit`, `perUser`) and the module handler run in order. A handler returns `[status, body, headers]` or
   streams itself (SSE, file downloads).
9. **Errors**: thrown errors carry `status` and `code`; 5xx are logged with the request id and answered with a generic
   message.

So a request goes: middleware → **thin route** (`http/routes/<area>/*.js`, wiring only) → **module facade**
(`modules/<name>/index.js` → `handlers/`) → **db** (`src/db`) and **providers** (AI, search, mail).

### Chat (SSE) and hedged model racing

`POST /conversations/:id/messages` (and regenerate, edit, and `/chat/guest` for signed-out visitors, which saves
nothing) streams server-sent events from `modules/chat/reply.js`: `start` → `delta`… → `done`, or `error`.
The safety layer (below) runs first and keeps this format for refusals and stopped replies.

- **Routing** (`modules/ai/routing.js`, overridable from Admin › Routing through `modules/ai/dynamic.js`): every
  mode tries **Gemma 4 26B on Google AI Studio first**, then MiniMax M3.1 Flash (NVIDIA) → Gemma 4 31B → Qwen →
  DeepSeek → GLM. When the reply language is Naijá, Yorùbá, Hausa or Igbo: Gemma 4 26B → Gemma 4 31B → N-ATLaS →
  MiniMax → Qwen → DeepSeek → GLM. A provider is on only when its key is set (environment, or stored encrypted in
  Admin › Models). A model enters routing only after a fresh benchmark (`BENCH_GATE`).
- **Hedging** (`modules/ai/hedge.js`): up to `AI_HEDGE` (default 2) models are asked at once, mixed across providers;
  the first to send real text wins and the others are cancelled. A target that fails starts the next one at once and
  "rests" (is tried last) for 30 s–10 min depending on the failure; a quick 5xx is retried once. Timeouts:
  `AI_FIRST_TOKEN_TIMEOUT_MS`, `AI_IDLE_TIMEOUT_MS`, `AI_MAX_REPLY_MS`.
- Each provider has one file in `modules/ai/providers/` (google, nvidia, groq, openrouter, natlas); `client.js`
  speaks the OpenAI-compatible and native Gemini streaming formats. Every attempt is logged to `ai_calls`.
- **Stop**: closing the request aborts the provider call and saves the partial reply as `stopped`;
  `POST …/stop` does the same from another request.

### Safety layer (v0.5.5, `modules/safety`, ADR 0003)

Inside `chat/reply.js`, after `start` and before routing, quota, web search or any provider call:

1. **Input moderation** (`safety.checkInput`): the latest user message is folded and run through the rule
   categories (`data/*.js`: csam, self_harm, violence, drugs, hate, sexual, fraud, privacy) enabled for the audience
   (signed in or guest; Admin › Safety, `app_settings.safety`), then optionally the moderation endpoint (off by
   default, fail open, stricter only). Child-safety rules always run.
   - `refuse`: the localized refusal goes out as `delta` → `done` (status `complete`); no provider, search or quota.
   - `allow_with_care`: category guidance is appended to the system prompt; for self-harm a supportive message with
     Nigerian helplines is the first `delta` and stays at the top of the saved reply.
2. **Redaction**: the user's own card numbers, BVN, OTP, PIN, CVV and passwords are masked in the messages sent to
   the provider (the saved chat keeps what the user typed).
3. **Untrusted content**: file blocks (`chat/context.js`) and web sources (`search/prompt.js`) are neutralised and
   fenced with random-id markers; flags are logged at the end of the reply.
4. **Output check**: every provider delta passes `streamGuard().push()` before it is sent; a hit (child sexual
   content, explosive recipe, drug synthesis, system-prompt leak) cancels the provider and ends with `done` carrying
   a safe message. `final()` re-checks the whole text.
5. **Events**: `safety_events` (no text by default), shown in Admin › Safety.

Every system prompt carries the safety section (`ai/prompts.js` ← `safety.SYSTEM`).

### Study: CBT practice test (v0.5.7–0.5.8, `modules/study`)

`POST /study/cbt { subject, topic?, exam: waec|neco|jamb|university|general, language, avoid? }` (guests and signed-in
users; `guestOrigin`, the `guestChat` switch for guests, 5 per 10 minutes per IP) returns
`{ questions: [{ q, options[4], answer: 'A'…'D', explanation }] ×10, durationSec: 300, exam, examLabel, subject, topic }`.
Nothing is saved: the app keeps the test, answers and absolute end time in `sessionStorage` and marks it itself.

1. `cbt.js` cleans the input (one line, capped, prompt-bending characters removed); `safety.checkInput` checks the
   subject and topic (refusal → 422 `refused`).
2. One Study-mode reply is consumed (`ai.limits`); it is refunded if no test could be made.
3. `ai.generate` (mode `study`, not streamed) gets the parameters as the user turn and the strict-JSON rules as extra
   system context (exam style, exactly one correct option, working before the answer, never "real past questions").
   The output check (`safety.streamGuard().final`) runs on the whole reply.
4. `parse.js` repairs and checks the reply (fences, LaTeX backslashes, trailing commas, salvage of complete items),
   drops bad or duplicate items, corrects a numeric key that contradicts the explanation's working, and shuffles the
   options. Fewer than 10 → one more generation (pooled), then 502 `bad_output`.
5. Fresh questions every test (v0.5.8): the app keeps the last 40 stems per exam + subject + topic in
   `localStorage` (`core/cbt-store.js`) and sends them as `avoid` (≤ 40 × 160 chars, ≤ 5000 in total, quoted as
   data in the prompt). `variety.js` gives each request a random focus (≥ 6 syllabus areas or topic angles, a mix of
   question types, a variety token; injectable `rng`), generation runs at temperature 0.9, and `similar.js` drops
   near-duplicates (token-set Jaccard ≥ 0.6, same numbers) within the test and against `avoid`. The second call
   also avoids the stems already accepted; if still short, avoid-list near-matches fill the gap (`cbt_short`).

### Research mode: search → reader → cited answer

Before the model answers in Research mode (`modules/search`):

1. **Search** (`search.js`, `providers/`): the configured chain, first that answers: DuckDuckGo → Wikipedia by
   default; Brave, Tavily and SearXNG when keyed. A provider showing a captcha rests for 10 minutes.
2. **Reader** (`reader.js`, `net.js`): the top pages (default 3) fetched in parallel through an SSRF-guarded fetch
   (public http/https only, re-checked after DNS and every redirect), size and time capped, HTML only, main text
   trimmed around the question; 10-minute per-worker cache.
3. **Cited answer** (`prompt.js`): the app receives `status` and `sources` events; the model gets the numbered
   sources with strict citation rules and answers with `[n]` chips. When search fails the reply says so in one line
   and chat continues without sources. Details: `docs/phases/phase-5-research.md`.

### Configuration validated at boot

`services/api/src/config/defaults.js` is the one schema of environment variables. `server.js` calls
`config.assertValid()` before anything else: production refuses to start without `DB_USER`/`DB_NAME`, and any
non-numeric value in a numeric key or a malformed URL stops it with one message listing every problem (cPanel
`stderr.log`). Every variable: `config/README.md`.

## Frontend

- **No build step**: browsers load ES modules directly. Each app's `src/main.js` boots it; `packages/ui/js/colon.js`
  is the UI kit's public face (`window.Colon` and the other globals are kept, with the same keys as before the ES module split).
- **Layout per app**: `core/` (state, data and API clients, SSE and storage in chat; auth and router in admin), `pages/` (one screen each),
  `components/` (reusable pieces of a screen), `actions/` (user actions that touch several components, e.g.
  send-message, rename, delete). CSS is split per concern (`packages/ui/css/*` + each app's `public/assets/css/`).
- **Data adapters**: every screen runs on a local implementation or the API (`docs/frontend-data-adapters.md`).
- **Import-cycle caveat**: some module groups import each other (chat pages/components/actions; browser pages and
  chrome; the UI kit's `colon/` auth, account and router). ES modules allow this, and it works because **no module
  uses an imported binding at top level**; imports are only read inside functions that run after boot. Keep it that
  way: a top-level call into a module from the same cycle can see `undefined` depending on load order. List the
  cycles with `node scripts/dev/cycles.js`.

## Versioned frontend deploy

cPanel "Deploy HEAD Commit" runs `.cpanel.yml`, which calls `scripts/deploy/build-docroot.sh <repo> <app> <docroot>`
for each app (POSIX sh, no node needed):

- `apps/<app>/src`, `packages/ui/{js,css,fonts}` and `packages/brand/{css,js,assets}` go to
  `<docroot>/v<version>/...` (version from the root `package.json`), built beside the live folder and swapped in whole.
- `apps/<app>/public/.` (`index.html`, `assets/`) is copied **last**, so a page never references files that are not
  there yet. `index.html` loads everything from `/v<version>/` and its own CSS with `?v=<version>`, so a phone never
  mixes two releases.
- `/brand/` and `/ui/fonts/` mirrors are kept for URLs from older releases. Older `v*` folders stay until pruned.
- `.htaccess` is server-only (gitignored) and never written by the deploy; it sets `no-cache` for `index.html`.

The API runs in place from the repository clone; `.cpanel.yml` touches `tmp/restart.txt`, and the app is restarted
in Setup Node.js App. Steps: `docs/runbooks/deploy.md`.
