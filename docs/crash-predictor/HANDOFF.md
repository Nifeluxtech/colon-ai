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
| 1 | Accounts and dashboard: `apps/crash` web app, `crash` API module, MySQL tables (rounds, sessions, bets, settings, audit), routes | **Done (v0.33.0, branch `feat/crash-predictor-step1`; not yet deployed)** |
| 2 | Inbuilt browser: new Android flavor `colonjetx` on the Colon Browser WebView engine, split screen (game top, predictor bottom), manual / AI / shared control | Not started |
| 3 | Round collector: injected script in the WebView (pattern: `apps/android/app/src/main/assets/saga/`) reads finished multipliers, posts them with time and round id, dedupes; CSV import | Not started |
| 4 | Analysis engine: hit rate vs baseline, streaks, distribution, confidence ranges, out-of-sample model tests, BET / WAIT / STOP with reason | Not started |
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
