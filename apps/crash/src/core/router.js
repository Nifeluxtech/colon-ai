/* Colon JetX (Crash Predictor step 1): the route table. Colon accounts sign in here (Google or email, 2FA) through
   the shared account screens; every crash screen needs a signed-in user, and the API checks that again.
     /           dashboard: account, session, today's stats against the honest baseline, verdict, recent rounds/bets
     /settings   target cash-out, stake, demo mode, guardrails, kill switch, betting site
     /analysis   hit rate vs baseline vs break-even, streaks, distribution, out-of-sample rule tests (v0.36.0)
     /history    every recent round and bet
     /autobet    auto-bet: mode, demo balance, guardrails, kill switch, bet log, hit rate vs the honest odds (v0.38.0)
     /live       the compact Colon panel for the app's side-by-side layout: recorded rounds and the next-round
                 suggestion (v0.38.0); the app's layout event opens it
   Plan: docs/crash-predictor/HANDOFF.md. */

import { X } from './state.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { analysisPage } from '../pages/analysis.js';
import { autobetPage } from '../pages/autobet.js';
import { livePage } from '../pages/live.js';
import * as app from './native.js';
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
      { href: '/autobet', label: 'Auto-bet', icon: 'play' },
      { href: '/history', label: 'History', icon: 'history' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
      { href: '/account', label: 'Account', icon: 'user', match: /^\/account/ }
    ],
    routes: [r('/', dashboard, ''), r('/analysis', analysisPage, 'Analysis'), r('/history', history, 'History'),
      r('/settings', settingsPage, 'Settings'), r('/autobet', autobetPage, 'Auto-bet'), r('/live', livePage, 'Live')]
  });
  // In the Colon JetX app's side-by-side layout this pane is the narrow Colon panel: show the live view there.
  if (app.inApp()) {
    var toLive = function (l) { if (l === 'side' && !/^#\/live/.test(location.hash)) C.go('/live'); };
    app.appStatus().then(function (s) { toLive(s && s.layout); }).catch(function () {});
    app.on('layout', function (x) { toLive(x && x.layout); });
  }
};

export { X as ColonCrash };
