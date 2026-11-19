# Runbook: deploy

Production is one cPanel account (AfeesHost cPanel 138, CloudLinux: 1 GB RAM, 20 entry processes, 5 GB disk, SSH,
Git Version Control, cron, JetBackup; no browser terminal). The repository is cloned at
`/home/apparatu/repositories/colon-ai`. The API runs in place from `services/api` under Setup Node.js App
(Passenger); each web app is built into its subdomain document root by `scripts/deploy/build-docroot.sh`.

## Before you deploy

1. `main` is green in CI (`node scripts/check.js`, `npm test`).
2. The version in the root `package.json` was bumped if any frontend file changed (check.js keeps `index.html`,
   `Colon.version` and every `package.json` on the same version). A new version means a new `/v<version>/` folder,
   so phones never mix old and new modules.
3. Read the new migrations in `database/migrations/`. They run by themselves when the API starts and are
   **forward-only**: there is no down migration (see `rollback.md`).
4. New environment variables are in `config/api.env.example` and `config/README.md`. Add them in cPanel **before**
   restarting: the API refuses to start in production without `DB_USER`/`DB_NAME` or with a non-numeric value in a
   numeric key.
5. For a release with migrations, take a database dump first (`backup-restore.md`, "On demand").

## Deploy

1. cPanel › **Git Version Control** › Manage (colon-ai) › **Pull or Deploy** › **Update from Remote**.
   Check that "HEAD Commit" shows the commit you expect.
2. **Deploy HEAD Commit**. `.cpanel.yml` runs, for chat, browser and admin:
   `/bin/sh scripts/deploy/build-docroot.sh <repo> <app> /home/apparatu/<app>.apparatus.name.ng`.
   It copies the versioned modules to `<docroot>/v<version>/` first (built beside the live folder and swapped in),
   refreshes the `/brand/` and `/ui/fonts/` mirrors, and copies `index.html` and `assets/` **last**. It never
   writes `.htaccess`. It then touches `services/api/tmp/restart.txt`.
3. cPanel › **Setup Node.js App** › the API app › **Restart**. Press "Run NPM Install" only when
   `services/api/package.json` dependencies changed.
4. **Verify**:
   - `https://api.apparatus.name.ng/health` returns `status: ok`, `database.ok: true`, `database.migrations` ending
     with the newest migration, `ai.configured: true` with the expected providers, `two_factor: true`.
   - The response has an `X-Request-Id` header.
   - If the API does not come up, read `services/api/stderr.log` (a configuration error lists every bad variable).
   - Open chat, browser and admin on a phone: the page source loads from `/v<new version>/`; send one guest message
     and one Research-mode message; sign in to admin (2FA).
5. **Prune** old frontend versions once the new one has been live for a day (keep the previous one for rollback):
   ```sh
   # over SSH; lists, then removes, every v* folder except the two newest
   for d in chat browser admin; do
     cd /home/apparatu/$d.apparatus.name.ng && ls -d v*/ | sort -V | head -n -2 | xargs -r rm -rf
   done
   ```
   Disk is 5 GB: each version folder is a few MB per app, so prune at least every few releases.

## Release notes

### 0.10.0 (Phase 10: one browser per chat)

- **Migration `0010_chat_browser_sessions.sql` runs by itself when the API starts** (adds
  `browser_sessions.conversation_id` and moves its unique key to device + conversation, `chat_conversations.
  browser_mode`, `saga_tasks.mode`). Existing sessions become the device-wide session (`conversation_id = ''`), so
  Colon Browser and older apps keep working. Take a database dump first (step 5 above). After the restart,
  `/health` `database.migrations` should end with `0010_chat_browser_sessions`.
- **Optional env key `SAGA_HANDOFF_TIMEOUT_MS`** (default `600000`, 10 minutes): how long Saga waits for the user to
  type a password, code or card details and tap Return to AI. Nothing to add unless you want another value.
- New APKs for both apps (versionCode 1000); `apps/chat/public/android/version.json` points at the `v0.10.0`
  GitHub release, so publish the release (Android workflow) before or together with this deploy.

## The `.htaccess` file

Each document root has a server-only `.htaccess` (gitignored; the deploy refuses a repo copy and never overwrites
it). It must send `Cache-Control: no-cache` for `index.html`, so phones always fetch the page that names the newest
`/v<version>/` folder; versioned files can be cached for a long time. Minimal content:

```apache
<Files "index.html">
  Header set Cache-Control "no-cache"
</Files>
```

Merge it with anything cPanel already wrote there (HTTPS redirects, PHP handlers). Do not enable `mod_deflate` for
`text/event-stream` on the API subdomain, or chat replies arrive all at once.

## Release notes: 0.17.0

- **Migration** `0017_tools_research.sql` runs at start-up: one new table, `colon_research_runs` (one row per deep
  research task, its resumable state). Nothing else changes in the database (generated images are ordinary
  `chat_attachments`, image credits are `usage_events` under the plans' existing `image_credits`). Take a database
  dump first. `/health` → `database.migrations` should end with `0017_tools_research`.
- **Environment** (Setup Node.js App; defaults from `services/api/src/config/defaults.js`):
  - `IMAGE_MODEL` (empty): a Google AI Studio image-capable model id your `GEMINI_API_KEY` can use (check it in AI
    Studio first). **Empty = image generation off** (Admin › Tools shows `generate_image` off and `/image` says it
    isn't switched on). A model id Google refuses fails gracefully and the credit is given back.
  - `IMAGE_TIMEOUT_MS` (90000): give up on one image after this long (refunded).
  - `BILLING_CREDITS_IMAGE` (0): Colon credits per image on top of one of the plan's monthly image credits.
  - `BILLING_CREDITS_DEEP_RESEARCH` (10): credits per deep research task, reserved at start, settled when the report
    is posted, refunded when it fails or is cancelled. The plan's `research_tasks` allowance also applies.
  - `RESEARCH_MAX_QUERIES` (4, at most 8), `RESEARCH_MAX_PAGES` (8, at most 20), `RESEARCH_STEP_MS` (35000, keep it
    under `JOBS_TIME_LIMIT_MS`, 50000 by default).
- **Cron env file: deep research runs on the cron, so the cron needs the AI and search settings too.** The cPanel
  cron job runs `/home/apparatu/colon-cron.sh` every 5 minutes (a wrapper script, because the cPanel Cron Jobs form
  rejects the long `--env-file=…` option); the script runs `scripts/cron.js` with
  `/home/apparatu/.colon-cron.env`, and cron sees **only** what is in that file, not the Setup Node.js App
  variables. Without these keys the research steps fail and every run ends refunded. Over SSH, add to
  `/home/apparatu/.colon-cron.env` (same values as Setup Node.js App, one `KEY=value` per line, keep `chmod 600`):
  - `APP_SECRET`: decrypts the provider keys saved in Admin › Models and the search keys saved in Admin › System ›
    Web search. Without it the cron falls back to environment keys only.
  - `GEMINI_API_KEY` (and `GEMINI_BASE_URL` if you changed it), plus every other AI provider key and model setting
    the API has set: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `NATLAS_API_KEY`, their `*_MODEL` /
    `*_BASE_URL` keys, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_SUPPORT_MODELS`, `AI_SUPPORT_MODELS`,
    `AI_MODEL_SET`, `AI_SPECIALIST_ROUTING`, `AI_RETRY_WAIT_MS`, the `AI_*_TIMEOUT_MS` / `AI_MAX_*` keys,
    `BENCH_GATE` and `AI_MODEL_COSTS` (whichever of these you set; the rest keep their defaults). The report is
    written by the Research mode chain, and the search queries by the model too.
  - Web search: `WEB_SEARCH`, `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `SEARXNG_URL`, `SEARXNG_API_KEY` (only the
    ones you use; with none, DuckDuckGo → Wikipedia).
  - `BILLING_CREDITS_DEEP_RESEARCH` and `RESEARCH_MAX_QUERIES`, `RESEARCH_MAX_PAGES`, `RESEARCH_STEP_MS` if you
    changed them (the cron settles and refunds the credits and bounds the steps), next to the `DB_*`, `NODE_ENV`,
    `BILLING_MODE` and `JOBS_*` keys from 0.16.0.
  When you change any of these in Setup Node.js App, change them here too.
- **How long deep research takes**: one bounded step per job (plan, one search per step, up to 3 pages per step,
  then the report), so a task spreads over several cron runs: **about 10–15 minutes** at the 5-minute interval. The
  chat shows a progress line in the thread and the report replaces it; members can cancel (credits come back). A
  run whose job got lost is resumed or ended and refunded by `research.sweep` on the next cron run.
- **Monaco** (Developer mode › Edit on a code block) loads `monaco-editor` **0.52.2 from jsDelivr**
  (`https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min`) on first use. The repository sets no CSP for the apps;
  if a document root's server-only `.htaccess` sends a `Content-Security-Policy`, it must allow `cdn.jsdelivr.net` in
  `script-src`, `style-src`, `font-src` and `worker-src` (plus `blob:` for workers), or the editor falls back to a
  plain textarea (still works, no highlighting). No code is executed anywhere.
- **Check** after the deploy and restart:
  - Admin › Tools (admin or Super Admin, 2FA) lists the nine tools with risk, plans, credits, timeout and consent;
    `generate_image` is off while `IMAGE_MODEL` is empty and on once it is set (restart after setting it).
  - In chat, `/image a red bus in Lagos` returns an image reply (or, with `IMAGE_MODEL` empty, the "isn't switched
    on" card). A failed image shows an error card and its credit is given back.
  - In Research mode turn on **Deep research**, ask a question, confirm the credit prompt: a progress line appears;
    Admin › Jobs shows `research.step` jobs and recent `cli` cron runs; within ~15 minutes the cited report replaces
    the progress line and the credits are settled. Start a second one and cancel it: it ends and the credits come
    back. If a run fails at once, read `/home/apparatu/logs/colon-cron.log` and check the cron env file keys above.
  - Developer mode: Edit on a code block opens the editor (or the textarea fallback).
  - `version.json` moves to 0.17.0 (versionCode 1700, both APKs; both get the new "from Nifelux" launch splash):
    publish the v0.17.0 release (Android workflow) before or with this deploy.

## Release notes: 0.16.0

- **Migration** `0016_jobs_cron.sql` runs at start-up: new tables `colon_jobs` (the job queue) and `colon_cron_runs`
  (one row per dispatcher run), and one queued `saga.schedule` job for every active Saga schedule (its next due
  time). Take a database dump first. `/health` → `database.migrations` should end with `0016_jobs_cron`.
- **Environment** (optional, defaults are fine; add them in Setup Node.js App **and** in the cron env file below):
  `JOBS_CRON_INTERVAL_MIN` (5, must match the cron schedule), `JOBS_BATCH_SIZE` (10), `JOBS_TIME_LIMIT_MS` (50000),
  `JOBS_LEASE_MS` (300000), `JOBS_MAX_ATTEMPTS` (5), `JOBS_BACKOFF_MS` (60000, doubles each retry, at most 6 h),
  `JOBS_KEEP_DAYS` (14), `JOBS_INPROCESS` (`off`; `on` only as a stop-gap while cron is not set up) and
  `CRON_SECRET` (empty = the HTTP trigger is off).
- **Cron env file** (once). cPanel cron does not see the Setup Node.js App variables, so over SSH create
  `/home/apparatu/.colon-cron.env` with the same values the API uses (at least `NODE_ENV=production`, `DB_HOST`,
  `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `BILLING_MODE=enforce` and any `BILLING_` / `JOBS_` keys you set),
  one `KEY=value` per line, then `chmod 600 /home/apparatu/.colon-cron.env`. It is outside every web root and the
  repository. When you change a DB or billing variable in Setup Node.js App, change it here too.
- **Cron job** (cPanel › Cron Jobs › Add New Cron Job; Common Settings "Once Per Five Minutes", i.e. `*/5 * * * *`;
  use the same number of minutes as `JOBS_CRON_INTERVAL_MIN`). The cPanel Cron Jobs form rejects the long
  `--env-file=…` option, so the command below lives in a wrapper script, `/home/apparatu/colon-cron.sh` (over SSH,
  `chmod 700`), and the cron job's command only runs that script (e.g. `/bin/sh /home/apparatu/colon-cron.sh`).
  What the script runs, on one line:
  ```sh
  cd /home/apparatu/repositories/colon-ai/services/api && /home/apparatu/nodevenv/repositories/colon-ai/services/api/24/bin/node --env-file=/home/apparatu/.colon-cron.env scripts/cron.js --quiet >> /home/apparatu/logs/colon-cron.log 2>&1
  ```
  Confirm the node path first: cPanel › Setup Node.js App › the API app shows "Enter to the virtual environment"
  with `source /home/apparatu/nodevenv/repositories/colon-ai/services/api/24/bin/activate`; the node binary is the
  `bin/node` beside that `activate` (the `24` is the Node major version; it changes if the app's Node version
  changes). Create the log folder once (`mkdir -p /home/apparatu/logs`). Each run talks to MySQL directly (no HTTP,
  so AfeesHost's ALTCHA cannot block it), claims at most `JOBS_BATCH_SIZE` jobs at a time and exits within
  `JOBS_TIME_LIMIT_MS`; two overlapping runs never take the same job. With `--quiet` the log only gets errors.
- **Secondary trigger** (optional): set `CRON_SECRET` (32+ random characters) in Setup Node.js App and call
  `POST https://api.apparatus.name.ng/internal/cron/run` with header `X-Cron-Secret: <secret>`. Use it only from a
  client AfeesHost's ALTCHA lets through; the CLI above is the supported dispatcher.
- **What moved**: Saga scheduled checks are jobs now (each due time is a `saga.schedule` job, re-queued when it
  runs). They still run on the user's phone, started by the API worker the phone is connected to, so nothing
  changes for users: same times, same "ran late" note when the phone was offline. A chat or Research reply cut off
  by a restart has its reserved credits refunded (or settled when text was saved) by the `chat.reconcile` job, and
  done jobs are pruned daily (`jobs.prune`). Saga tasks are still not charged credits.
- **Check**: run the cron command once by hand over SSH (without `--quiet`): it prints one `cron_run` line with
  `claimed`/`done` counts and exits 0. Admin › Jobs (admin or Super Admin) shows "Last run … (cli …)" and no red
  "never run" banner; after 20 minutes without cron runs it shows the "cron looks stopped" warning (3 × 5 minutes).
  As a user with a Saga schedule, Settings › Saga still lists it with the same next time, and Admin › Jobs › Queued
  shows its `saga.schedule` job. Pause it: the job turns `cancelled`; resume: a new one is queued. Retry and Cancel
  on a job ask for a reason and appear in Security › Audit (`admin.job_retried`, `admin.job_cancelled`).
  `version.json` moves to 0.16.0 (versionCode 1600, both APKs; the apps are unchanged): publish the v0.16.0 release
  (Android workflow) before or with this deploy.

## Release notes: 0.15.0

- **Migration** `0015_memory_projects.sql` runs at start-up: new tables `colon_projects`, `colon_memories`,
  `colon_memory_consent`, and a nullable `project_id` (foreign key, `ON DELETE SET NULL`) on `chat_conversations`
  and `chat_attachments`. Take a database dump first. `/health` → `database.migrations` should end with
  `0015_memory_projects`. The two `ALTER TABLE`s touch every chat row once; on today's table size that is seconds.
- **Environment** (optional, defaults are fine): `MEMORY_TOKEN_BUDGET` (500, tokens of memories added to one reply;
  0 = none) and `MEMORY_MAX_ITEMS` (200 per user). Nothing else to set. Project limits come from the existing plan
  entitlement `projects` (Admin › Plans) and follow `BILLING_MODE` (shadow today: over-limit projects are allowed
  and logged as `projects_over_limit`).
- **Check** (as a normal user on chat.apparatus.name.ng): Settings › Memory shows memory **off**; turn it on, add
  "I live in Ibadan", then ask "Where do I live?" in a new chat: the answer uses it. Turn memory off and ask again:
  it does not. Create a project, add instructions ("Always answer in Pidgin"), start a chat from the project page
  and check the reply follows them; move another chat into it from the chat's menu. Admin › Users › a user shows
  their project and memory counts. `version.json` moves to 0.15.0 (versionCode 1500): publish the v0.15.0 release
  (Android workflow) before or with this deploy.

## Release notes: 0.12.0

- **Migration** `0012_plans_credits.sql` (plans, entitlements, subscriptions, credit wallets, ledger, usage events)
  runs at start-up; take a dump first. `/health` → `database.migrations` should end with `0012_plans_credits`.
- **Environment** (optional): `BILLING_MODE` (default `shadow`: record credit use, never block; `enforce` refuses
  replies when a user's monthly credits run out; `off` records nothing), `BILLING_CREDITS_CHAT`,
  `BILLING_CREDITS_RESEARCH`, `BILLING_CREDITS_SAGA`. Leave it on `shadow` until quotas are agreed and Korapay is in.
- **Check**: as a normal user, send a chat, then `GET https://api.apparatus.name.ng/account/billing` shows the Free
  plan with 99 credits for the month.

## Release notes: 0.11.0

- **Migration** `0011_saga_schedules_routines.sql` (tables for scheduled checks and routines) runs at start-up;
  take a dump first. `/health` → `database.migrations` should end with `0011_saga_schedules_routines`.
- **Environment** (all optional, defaults in `config/api.env.example`): `AI_SUPPORT_MODELS`,
  `GEMINI_SUPPORT_MODELS`, `GEMINI_SUPPORT_VISION`, `GEMINI_SUPPORT_UNAVAILABLE_REST_HOURS`, `GROQ_SUPPORT_MODEL`,
  `OPENROUTER_SUPPORT_MODEL`, `GROQ_SUPPORT_MAX_INPUT_TOKENS`, `OPENROUTER_SUPPORT_MAX_INPUT_TOKENS`,
  `GROQ_SUPPORT_REASONING`, `AI_RETRY_WAIT_MS`, `SAGA_SCHEDULES_MAX`. Support order after Gemma 4 26B → 31B:
  `gemini-flash-lite-latest` → `gemini-3.5-flash-lite` → `gemini-3.8-flash` → `gemini-4-hydrogen` (all on the existing `GEMINI_API_KEY`,
  nothing new to set) → Groq `openai/gpt-oss-120b` → OpenRouter free Gemma. Set `GROQ_API_KEY` and
  `OPENROUTER_API_KEY` for the last two (Admin › Routing shows which are on). Since 0.11.7 the third is
  `gemini-3.8-flash` (stable, no shutdown date), replacing `gemini-2.5-flash`, which Google retires on 1 Dec 2026.
  If the server's env still sets `GEMINI_SUPPORT_MODELS` with `gemini-2.5-flash`, change it to
  `gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.8-flash,gemini-4-hydrogen` (or delete the line to use the default). A model
  Google refuses is skipped for 24 h. `GEMINI_SUPPORT_MODELS=off` turns the four off. Since 0.11.8 the fourth is `gemini-4-hydrogen`
  (free tier; Gemini 4 Argon and Carbon are paid-only).
- **Android**: publish `colon-ai-0.11.0.apk` and `colon-browser-0.11.0.apk` on the GitHub Release `v0.11.0`;
  `version.json` (versionCode 1100) is deployed with the chat app, so phones are offered the update only after the
  release exists. Older apps keep working: the chat checks `ColonNative.can('vault' | 'browserSuspend' | …)`.
- **Check on a phone**: open the sidebar and a menu over a running browser card (the card hides), scroll the thread
  with the card visible (steady), "save my github login" (secure form; the thread says only "Login saved for
  github.com"), a task in the background (notification), "check <site> every morning" (Settings › Saga lists it).
