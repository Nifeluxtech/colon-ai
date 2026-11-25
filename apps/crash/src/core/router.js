/* Colon JetX (Crash Predictor step 1): the route table. Colon accounts sign in here (Google or email, 2FA) through
   the shared account screens; every crash screen needs a signed-in user, and the API checks that again.
     /           dashboard: account, session, today's stats against the honest baseline, verdict, recent rounds/bets
     /settings   target cash-out, stake, demo mode, guardrails, kill switch, betting site
     /analysis   hit rate vs baseline vs break-even, streaks, distribution, out-of-sample rule tests (v0.36.0)
     /history    every recent round and bet
   Plan: docs/crash-predictor/HANDOFF.md. */

import { X } from './state.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { analysisPage } from '../pages/analysis.js';
import { dashboard } from '../pages/dashboard.js';
import { history } from '../pages/history.js';
import { settingsPage } from '../pages/settings.js';

var C = Colon;

X.start = function () {
  var r = function (path, render, title) { return { path: path, auth: true, title: title, render: render }; };
  C.start({
    app: 'crash', title: 'Colon JetX', subtitle: 'Crash Predictor by Nifelux', brand: 'COLON JETX', keepBrand: true,
    nav: [
      { href: '/', label: 'Dashboard', icon: 'grid' },
      { href: '/analysis', label: 'Analysis', icon: 'target' },
      { href: '/history', label: 'History', icon: 'history' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
      { href: '/account', label: 'Account', icon: 'user', match: /^\/account/ }
    ],
    routes: [r('/', dashboard, ''), r('/analysis', analysisPage, 'Analysis'), r('/history', history, 'History'),
      r('/settings', settingsPage, 'Settings')]
  });
};

export { X as ColonCrash };
