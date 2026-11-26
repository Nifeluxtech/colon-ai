# JetX Crash Predictor — Handoff

Read this first if you are an AI or developer picking up this work. It says what the product is, what is decided, how it fits this repo, and where the build stands.

## 1. What we are building
A JetX (SmartSoft Gaming) crash-game companion inside the **colon-ai** monorepo (owner: Nifeluxtech):

- A dashboard (web + Android) with the user's account, settings, live session status and signals.
- An inbuilt browser that opens the user's own betting site, where the user logs in themselves.
- A round collector that records every finished JetX multiplier.
- An analysis engine that gives a verdict each round: **BET**, **WAIT** or **STOP**.
- An auto-bet orchestrator that sets the game's auto cash-out (default **1.30x**) and stake, then presses Bet when the verdict is BET.

Look and feel: dark background, premium green highlights, mobile-first (Colon design system in `packages/ui`).

## 2. Decisions already made (do not reopen without the owner)
| Topic | Decision |
|---|---|
| Game | JetX first. Keep JetX data separate from Aviator or other games. |
| Hosting | Existing cPanel shared hosting (same deploy as colon-ai, `.cpanel.yml`). |
| Stack | colon-ai's own stack: Node API (`services/api`), static ES-module apps (`apps/*`), MySQL migrations, Android WebView flavors. Not the PHP stack in the original ChatGPT spec. |
| Sign-in | Reuse Colon accounts (Google or email, verification, 2FA). |
| Site access | Users bring their own gaming site and log in themselves. Never store or read their gaming password or session tokens. |
| Data | Official operator/provider feed where available; otherwise the in-browser collector; plus CSV import. |
| Training | Statistical baseline first; Random Forest, XGBoost, LSTM later in a Python worker (shared cPanel can't run it continuously, so a small VPS later). Auto-retrain as rounds arrive. |
| Auto-bet | Included. **Demo mode is the default**; real money only when the user switches it on. |
| Guardrails | Stake cap, stop-loss, daily loss limit, max bets per session, one-tap kill switch, every bet written to an audit log. |
| Build order | Website first, then Android. |

## 3. The honest math (keep it in the product)
JetX's RTP is about 97%, so the chance a round reaches multiplier *m* is about `0.97 / m`, every round, independent of history. At 1.30x that is about **74.6%**, and each bet loses about 3% on average. The engine must:
- show the live measured hit rate next to this baseline, with confidence ranges;
- test every model only on rounds it has not seen (chronological split) and report whether it beats the baseline;
- default to WAIT when no model has a proven edge.
Never label the app's output as a guaranteed prediction.

Automated clicking on an operator's site may breach its terms; the app warns the user before enabling real-money auto-bet.

## 4. Five-step plan and status
| Step | What | Status |
|---|---|---|
| 1 | Accounts and dashboard: `apps/crash` web app, `crash` API module, MySQL tables (rounds, sessions, bets, settings, audit), routes | **Done and deployed (v0.33.0, merged to `main` as 8b29fed)** |
| 2 | Inbuilt browser: new Android flavor `colonjetx` on the Colon Browser WebView engine, split screen (game top, predictor bottom), manual / AI / shared control | **Done, released and deployed (v0.34.0, merged to `main` as 5a9d766 via PR #68; release v0.34.0 with `colon-jetx.apk`)** |
| 3 | Round collector: injected script in the WebView (pattern: `apps/android/app/src/main/assets/saga/`) reads finished multipliers, posts them with time and round id, dedupes; CSV import | **Done (PR #69 merged as b7dba82, release v0.35.0, deployed). Collector heuristics not yet checked on a live JetX page** |
| 4 | Analysis engine: hit rate vs baseline, streaks, distribution, confidence ranges, out-of-sample model tests, BET / WAIT / STOP with reason | **Done (v0.36.0, branch `feat/crash-predictor-step4`, pushed as `crash-step4`, draft PR; not merged, released or deployed)** |
| 5 | Auto-bet: sets auto cash-out + stake, presses Bet on BET, all guardrails, demo default, audit log; Android build via CI, web via cPanel | Not started |

## 5. Repo conventions you must follow
- `node scripts/check.js` must pass: files ≤ 300 lines, lines ≤ 120 chars; API layering (routes import only `modules/<name>/index.js`, shared, config, middleware; modules never import http/ws or another module's internals); apps import `packages/ui` only through its public entry files and never another app; every asset URL in `apps/*/public/index.html` carries the package.json version; `config/api.env.example` matches `services/api/src/config/defaults.js`.
- `npm test` must pass (node --test).
- Migrations are forward-only SQL in `database/migrations/` with the next number (after `0027_chat_thoughts.sql`), applied at API start.
- Router: `services/api/src/http/router.js` ("METHOD /path/:param", handlers return `[status, body]`).
- Bump versions together (root, api, apps) and add a CHANGELOG entry.
- Work on a branch and open a draft pull request; never push straight to the default branch.

## 6. Files for this feature
- `docs/crash-predictor/HANDOFF.md` — this file; update the status table and log below whenever you finish something.
- `database/migrations/0028_crash.sql` — `crash_settings` (per user: target 1.30, stake, currency, demo_mode 1,
  stake_cap, stop_loss per session, daily_loss_limit, max_bets_per_session, kill_switch, site_url,
  real_money_ack_at), `crash_sessions`, `crash_rounds` (unique user + game + round_id), `crash_bets`, `crash_audit`.
- `services/api/src/modules/crash/` — `index.js` (public entry: `create`, handlers, dashboard summary, `dayStart`),
  `settings.js` (defaults, validation, real-money confirmation, guardrail state), `math.js` (baseline 0.97/target,
  expected return, Wilson 95% range, hit rate vs baseline), `store.js` (MySQL store + in-memory store for tests).
- `services/api/src/http/routes/crash.js` — `GET /crash/dashboard?tz_offset=`, `GET|PUT /crash/settings`,
  `GET /crash/rounds?limit=`, `GET /crash/bets?limit=`; all `requireUser`. The API lives on api.apparatus.name.ng,
  so paths have no `/api` prefix (same as every other route). `PUT` switching demo mode off without
  `confirm_real_money: true` answers 409 `confirm_real_money` with the warning text.
- `services/api/tests/unit/crash.test.js` — baseline math, settings validation, guardrails, dashboard summary.
- `apps/crash/` — web app: `public/index.html`, `public/assets/css/crash.css` (green tokens), `src/main.js`,
  `src/core/{state,api,router}.js`, `src/components/cards.js`, `src/pages/{dashboard,settings,history}.js`.
- Deploy: `.cpanel.yml` runs `build-docroot.sh $REPO crash $HOMEDIR/crash.apparatus.name.ng`;
  `scripts/deploy/build-docroot.sh`, its test and `scripts/check.js` know the `crash` app.

### Step 2 files (Android, v0.34.0)
- `apps/android/app/build.gradle.kts` — flavor `colonjetx` (`ng.nifelux.colonjetx`, `APP_KEY` colonjetx, `APK_NAME`
  colon-jetx, `IS_JETX_APP` true; the other two flavors get `IS_JETX_APP` false).
- `apps/android/app/src/colonjetx/` — manifest (launcher `JetxActivity`), name, green icon and splash, dark theme,
  and the bridge shim `assets/jetx/bridge.js` (`window.ColonJetX`).
- `apps/android/app/src/main/kotlin/ng/nifelux/colonai/Jetx*.kt` — `JetxActivity` (split screen), `JetxChrome`
  (address bar, status dot, banner, chips, divider), `JetxWeb` (the two WebViews on the browser engine's settings),
  `JetxBridge` (predictor origin only, main frame, WebView-enforced; no JavascriptInterface fallback), `JetxApi`
  (`GET /crash/settings` for `site_url`, cookie only to the Colon API host), `JetxPrefs` (mode, layout, divider,
  site), `JetxRules` (pure; `src/test/.../JetxRulesTest.kt`). Resources: `res/layout/activity_jetx.xml`,
  `res/values/{strings,colors}_jetx.xml`, `res/drawable/bg_jetx_*.xml`, style `Colon.JetxChip`.
- Bridge: page -> app `{id, cmd, args}`, app -> page `{id, ok, result|error}` or `{event, data}`. Commands `ready`,
  `status` (app, version, mode, layout, `session {status, host}`, `autoClick: false`), `openSite {url?}`,
  `setLayout {layout}`; events `session`, `mode`, `layout`. The predictor gets the site's host and load state only.
- `apps/crash/src/core/native.js` + dashboard: the app line (site status, control mode) and "Show my betting site".
- CI: `.github/workflows/android.yml` tests, lints and builds `colonjetx` and ships `colon-jetx-<version>.apk` and
  `colon-jetx.apk`; `scripts/deploy/android-version.test.js` checks it. No `version.json` entry yet, so Colon JetX
  has no in-app updates (`VersionManifest.forApp` knows only colonai and colonbrowser).
- Step 3 hooks onto the game pane in `JetxWeb.game` (an injected collector, pattern `assets/saga/`); step 5's clicks
  must check `JetxPrefs.mode` and the guardrails. AI / Shared currently change state and the banner only.

### Step 3 files (round collector, v0.35.0)
- API: `services/api/src/modules/crash/rounds.js` (pure: multiplier 1.00..1,000,000 with ≤ 2 decimals, times, stable
  ids, the 2-second collector window, CSV parsing), `collect.js` (storing, dedupe, sessions, the dashboard's collector
  status), `store.js` (`insertRounds` with INSERT IGNORE, `roundsNear`, `lastRound`, `startSession`, `endSession`;
  `roundStats.collected`). No migration: 0028's unique `(user_id, game, round_id)` and `crash_sessions` suffice.
- Routes (`routes/crash.js`, all `requireUser`): `POST /crash/rounds` `{ rounds: [{ multiplier, ended_at? | seen_at?,
  round_id? }], source: collector | csv | manual }` (≤ 100; 1,500/h), `POST /crash/rounds/import` `{ csv }` (≤ 5,000
  rows, 400 KB; 30/h), `POST /crash/sessions` `{ action: start | stop, reason? }` (120/h). Rounds and import answer
  `{ inserted, duplicates, rejected, errors[≤20] }`. Dedupe: given round id; else `~t<ms>x<cents>` from time and
  multiplier; CSV rows with no time and no id get `~c<sha1 of the file's timeless multipliers>:<n>` (re-import safe)
  and the import time (first row oldest, 1 ms apart); collector rows with no id also count as duplicates when the
  same multiplier is already stored within 2 s. The collector's first stored round opens a session implicitly.
  `/crash/dashboard` gains `collector { status: live (a round in the last 2 min) | idle (session open) | off,
  rounds_today, last_multiplier, last_round_at }`. Audit events: `rounds.imported`, `rounds.manual`,
  `session.started`, `session.stopped`.
- Tests: `services/api/tests/unit/crash-rounds.test.js` (API, in-memory store) and `jetx-collector.test.js` (the
  injected script's pure parts plus a static read-only check).
- Android: `src/colonjetx/assets/jetx/collector.js` (injected at document start into every frame of the game pane,
  origin rule `*`; read-only; finds the history strip = an element with 5..200 children of which ≥ 5 and ≥ 70% are
  `^\d+([.,]\d{1,2})?\s*[x×]$` (0.35.1: others skipped; nested spans, single leaf, open shadow roots), never
  inside buttons, links or forms; 0.35.2: `collector-find.js` adds "×"/"X"/NBSP/zero-width tolerant chips, bare
  "1.07" with a CSS ::after x (or ≥ 5 bare making up 80%), and grouped strips (chips of grid rows under a common
  ancestor ≤ 4 levels up, ≥ 5 and most short leaves); a `diag` message every 10 s with counts and ≤ 3 samples of
  `[0-9.,xX× ]` ≤ 12 chars; first look sends nothing; then diffs the strip,
  newest first or last, by data-round-id style attributes when present; several new rounds at once are stamped 3 s
  apart). `JetxCollector.kt` (the `ColonJetXRounds` web message listener, never replies; queue ≤ 500, batches of
  50 every 5 s, backoff to 5 min, stop session on close / switch off), `JetxRoundRules.kt` (pure, `JetxRoundRulesTest`),
  `JetxApi.post` (cookie only to the Colon API host), `JetxPrefs.collector` (default on). Bridge: command
  `setCollector {on}`, event `collector {on, status: off|waiting|live|signed_out|error|unsupported, rounds_today,
  last_multiplier}`, and `status.collector`.
- Web: dashboard Round collector card and the app's on / off switch; History "Add a round" and "Import a CSV"
  (`apps/crash/src/components/importer.js`).
- Open: the strip heuristics are unverified against the user's real JetX page (SmartSoft may render the history in
  a canvas, without an "x", or in a closed shadow root; then nothing is collected and the selectors need adjusting
  from a saved copy of that page). The live "big multiplier" on crash is not read, only the history strip.

### Step 4 files (analysis engine, v0.36.0)
- API (pure JS, no migration): `services/api/src/modules/crash/dist.js` (normal CDF and quantile, chi-square p,
  two-sided p), `stats.js` (`summary`: hit rate + Wilson vs baseline 0.97 / t and break-even 1 / t, streaks with the
  typical longest, six buckets vs the 0.97 / m shares with a chi-square fit, median, last 50 / 200, runs test),
  `strategies.js` (10 transparent rules; `evaluate`: chronological 50/50 split, the earlier half picks the rule with
  the best 95% lower bound among those with ≥ 30 bets, the later half tests every rule; Bonferroni z for alpha
  0.05 / 10 ≈ 2.81), `engine.js` (`analyse(xs, target)`, `verdict(analysis, rails)`), `analysis.js` (per-user cache
  keyed on round count + newest id + target + limit, 5-minute TTL, 500 users max). `store.js` gains
  `recentMultipliers` and `roundsMeta`. `index.js` adds `analysis()`, `handlers.getAnalysis` and `engine`.
- Verdict order: STOP (any guardrail) → WAIT (0 rounds; < 300 rounds; rounds don't fit the published odds: fit
  p < 0.001 or < 10 distinct multipliers; no rule chosen; chosen rule < 100 unseen bets; its corrected lower bound
  ≤ 1 / target; its condition false for the next round) → BET. Shape: `{ action, verdict, reason, strategy: { id,
  name, rule } | null, numbers, engine: true, note }`. Thresholds are constants in `engine.js` / `strategies.js`.
- Route: `GET /crash/analysis?limit=&tz_offset=` (`requireUser`, 600/h) → `{ game, target, limit, analysed,
  total_rounds, stats, strategies, verdict, guardrails, notice }`. `/crash/dashboard` `verdict` uses the same engine.
- Tests: `services/api/tests/unit/crash-engine.test.js` (seeded synthetic data: fair i.i.d. never BET over 40 seeds
  × 300 / 1,200 / 5,000 rounds; a planted after-a-miss dependence gives BET; marginal bias and identical rounds give
  WAIT on the data check; kill switch and stop-loss give STOP; no look-ahead in any rule).
- Web: `apps/crash/src/pages/analysis.js` (route `/analysis`, nav "Analysis"), `cards.js` `verdictCard(v, { link })`
  shows the reason, rule and numbers; `api.js` `analysis()`; CSS `.cx-table`, `.cx-vnums`, `.cx-honest`.
- Android: nothing added. Step 5 can read the verdict from `GET /crash/dashboard` (or the predictor page) before
  clicking; no bridge field was needed yet.
- Limits: the engine can only find dependence that the 10 fixed rules express; with 5,000 rounds the test half is
  2,500, so a rule betting 10% of rounds has ~250 unseen bets and can only show an edge of several points. A BET on
  real data most likely means a collector error (missed low rounds, doubled rounds) that the fit test did not catch.
  A rule chosen today is re-chosen as rounds arrive (no frozen holdout across time).

### Deploy notes
- Subdomain **crash.apparatus.name.ng**, docroot `/home/apparatu/crash.apparatus.name.ng`.
- `https://crash.apparatus.name.ng` is in the default `ALLOWED_ORIGINS` (`config/defaults.js`, `api.env.example`),
  but the **production `ALLOWED_ORIGINS` env var in cPanel (Setup Node.js App) must also include it**, or the app's
  API calls fail CORS/CSRF. Restart the API after changing it. Migration 0028 applies itself at API start.

## 7. Source spec
The owner's two ChatGPT conversations ("JetX AI Crash Predictor — Complete Technical Architecture" and the training-engine / open-source references one). Useful references named there: crashmath-labs/crash-predictor-benchmark, side-quest-dev/aviator-verifier, vamsiram89/crash_agent, scikit-learn, XGBoost, PyTorch, sktime, skforecast.

## 8. Log
- 2026-11-25: Spec agreed, plan written, step 1 started.
- 2026-11-25: Step 1 done on branch `feat/crash-predictor-step1` (v0.33.0): migration 0028, `crash` API module and
  routes, `apps/crash` (dashboard, settings, history), unit tests, deploy wiring for crash.apparatus.name.ng.
  Verdict is a WAIT placeholder until step 4. Rounds and bets lists stay empty until steps 3 and 5 write them.
- 2026-11-25: Step 1 merged to `main` (8b29fed).
- 2026-11-25: Step 2 done on branch `feat/crash-predictor-step2` (v0.34.0): Android flavor `colonjetx` (Colon JetX)
  with the split screen, Manual / AI / Shared mode (AI and Shared click nothing yet), the `window.ColonJetX` bridge
  stub, the dashboard's app line, CI for the third APK and `JetxRulesTest`. Gradle was not run in the authoring
  sandbox (no ARM64 aapt2); the new Kotlin was compiled with kotlinc against android.jar 36 and AndroidX, and
  `JetxRulesTest` passed there. First CI run on the PR is the real Android build, lint and test.
- 2026-11-25: Step 2 merged to `main` (5a9d766, PR #68), released as v0.34.0 with `colon-jetx.apk`; steps 1 and 2
  deployed.
- 2026-11-25: Step 3 done on branch `feat/crash-predictor-step3` (v0.35.0, draft PR): `POST /crash/rounds`,
  `/crash/rounds/import`, `/crash/sessions`, dedupe, collector status on the dashboard, CSV import and manual entry
  in History, the read-only collector in the Colon JetX game pane (`JetxCollector`, `collector.js`) with an on / off
  switch. No migration. Gradle and kotlinc were not run in the authoring sandbox (no JDK); CI is the real Android
  build. Next: verify the collector on the user's JetX page, then step 4 (analysis engine).
- 2026-11-25: Hotfix 0.35.1 on branch `fix-jetx-collector` (draft PR): the collector found nothing on SportyBet's
  JetX (SmartSoft) page, whose history strip ends in a dropdown chevron button and a half-visible chip. `collector.js`
  now takes a container with ≥ 5 multiplier chips forming ≥ 70% of its children, skips the rest, reads nested spans
  or a single leaf, searches open shadow roots, and posts a text-free diagnostic `{diag: {frame_host, strip_found,
  items}}` every 10 s; the dashboard's collector card (top of the page in the app) shows frames seen, whether the
  strip was found and rounds sent today. Still to verify on the phone.
- 2026-11-25: Hotfix 0.35.2 on branch `fix-jetx-collector-2` (draft PR): on the phone 0.35.1 saw 5 game frames but no
  history strip although SportyBet's JetX shows a grid of "1.07x" pill chips with a More button. The finding code
  moved to `collector-find.js` (injected with `collector.js` in one function, `JetxRoundRules.script`): chip text is
  normalized ("×", "X", NBSP, zero-width, comma decimal), bare numbers count with a ::after x or as a mostly-bare
  strip, and chips in grid rows are grouped under their common ancestor. The diagnostic adds `mult_texts`,
  `canvases`, `shadow_hosts`, `closed_hint` and `sample`, shown on the dashboard line ("Multipliers on page: 0 ·
  Canvases: 1", "Sample: 1.07x, 4.54x"). Still to verify on the phone; if mult_texts stays 0 the history is drawn
  in a canvas or a closed shadow root and the DOM can't be read.
- 2026-11-25: Step 3 merged to `main` (b7dba82, PR #69), released as v0.35.0 and deployed.
- 2026-11-25: Step 4 done on branch `feat/crash-predictor-step4` (v0.36.0, pushed as `crash-step4`, draft PR): the
  analysis engine (stats, 10 rules tested only on unseen rounds with a Bonferroni-corrected bound, BET / WAIT / STOP
  with reason and numbers), `GET /crash/analysis`, the Analysis page and the real verdict on the dashboard. No
  migration, no Android change. A hotfix (v0.35.1, collector) is in flight separately; step 4 is to be rebased onto
  it once it merges. Next: step 5 (auto-bet) reads this verdict.
