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
| 1 | Accounts and dashboard: `apps/crash` web app, `crash` API module, MySQL tables (rounds, sessions, bets, settings, audit), routes | **In progress** |
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
- `apps/crash/` — web app (step 1).
- `services/api/src/modules/crash/` and `services/api/src/http/routes/crash.js` — API (step 1).
- `database/migrations/0028_crash.sql` — tables (step 1).

## 7. Source spec
The owner's two ChatGPT conversations ("JetX AI Crash Predictor — Complete Technical Architecture" and the training-engine / open-source references one). Useful references named there: crashmath-labs/crash-predictor-benchmark, side-quest-dev/aviator-verifier, vamsiram89/crash_agent, scikit-learn, XGBoost, PyTorch, sktime, skforecast.

## 8. Log
- 2026-11-25: Spec agreed, plan written, step 1 started.
