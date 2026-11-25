# Colon JetX (Crash Predictor)
JetX companion for signed-in Colon users. Deployed to crash.apparatus.name.ng. Plan, decisions and the honest-math
rules: [docs/crash-predictor/HANDOFF.md](../../docs/crash-predictor/HANDOFF.md).

Step 1 (v0.33.0): dashboard, settings and history on the `crash` API module (`/crash/*`, signed-in only).
Step 2 (v0.34.0): the Colon JetX Android app (`apps/android`, flavor `colonjetx`) shows this app in its bottom pane,
under the user's betting site, and gives it `window.ColonJetX`; `src/core/native.js` wraps it (open the site in the
top pane, the site's status and the control mode). In a normal browser there is no bridge and nothing changes.

| Path | Purpose |
|---|---|
| `public/index.html`, `public/assets/css/crash.css` | The page and its green-on-dark tokens over the shared design system |
| `src/main.js` | Boot only |
| `src/core/` | `state.js` (`window.ColonCrash`, number formats), `api.js` (the `/crash/*` calls), `router.js` (routes) |
| `src/core/native.js` | The Colon JetX Android app's bridge (`window.ColonJetX`); absent in a normal browser |
| `src/components/` | `cards.js`: header, stats, verdict, baseline, round chips, bet rows |
| `src/pages/` | `dashboard.js`, `settings.js`, `history.js` |

Sign-in, profile, 2FA and devices are the shared Colon account screens (`#/login`, `#/account`). The verdict is
WAIT until the analysis engine (step 4) proves an edge over the baseline; it is never shown as a prediction.
Demo mode is on by default; switching to real money shows the operator-terms and ~3% loss warning first.
