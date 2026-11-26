# Colon JetX (Crash Predictor)
JetX companion for signed-in Colon users. Deployed to crash.apparatus.name.ng. Plan, decisions and the honest-math
rules: [docs/crash-predictor/HANDOFF.md](../../docs/crash-predictor/HANDOFF.md).

Step 1 (v0.33.0): dashboard, settings and history on the `crash` API module (`/crash/*`, signed-in only).
Step 2 (v0.34.0): the Colon JetX Android app (`apps/android`, flavor `colonjetx`) shows this app in its bottom pane,
under the user's betting site, and gives it `window.ColonJetX`; `src/core/native.js` wraps it (open the site in the
top pane, the site's status and the control mode). In a normal browser there is no bridge and nothing changes.
Step 3 (v0.35.0): the dashboard's Round collector card (`collector` from `/crash/dashboard`, and in the app the
phone's collector status and on / off switch over the bridge); History adds a round by hand or imports a CSV
(`src/components/importer.js`, `POST /crash/rounds` and `/crash/rounds/import`).
Step 4 (v0.36.0): the Analysis page (`src/pages/analysis.js`, `GET /crash/analysis`): hit rate vs baseline vs
break-even, streaks, the distribution against the expected shares, independence, and every rule tested on rounds it
had not seen. The dashboard's verdict card shows the engine's BET / WAIT / STOP with its reason and numbers.

| Path | Purpose |
|---|---|
| `public/index.html`, `public/assets/css/crash.css` | The page and its green-on-dark tokens over the shared design system |
| `src/main.js` | Boot only |
| `src/core/` | `state.js` (`window.ColonCrash`, number formats), `api.js` (the `/crash/*` calls), `router.js` (routes) |
| `src/core/native.js` | The Colon JetX Android app's bridge (`window.ColonJetX`); absent in a normal browser |
| `src/components/` | `cards.js`: header, stats, verdict, baseline, collector, round chips, bet rows; `importer.js`: add a round, CSV import |
| `src/pages/` | `dashboard.js`, `analysis.js`, `settings.js`, `history.js` |

Sign-in, profile, 2FA and devices are the shared Colon account screens (`#/login`, `#/account`). The verdict is
WAIT until a rule beats break-even on rounds it has not seen (step 4); it is never shown as a prediction.
Demo mode is on by default; switching to real money shows the operator-terms and ~3% loss warning first.

Step 5 (v0.37.0): the Auto-bet page (`src/pages/autobet.js`, `GET /crash/autobet`, `POST /crash/autobet/stop`) and
the Live page for the Android app's side panel (`src/pages/live.js`, `GET /crash/live`).
