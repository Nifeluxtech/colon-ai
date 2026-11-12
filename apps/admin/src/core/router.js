/* Colon Admin (Phase 4): overview, users, moderation, models and providers, routing, usage limits,
   evaluation, African AI registry, voice, browser, system settings and security.
   The API enforces every permission; the menu only hides what a role can't open.
     moderator    moderation + read-only users
     admin        everything except admin roles, provider keys and system settings
     super_admin  everything
   This file holds the route table (A.start) and the More screen; each screen lives in pages/. */

import { gate } from './auth.js';
import { A } from './state.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { head } from '../components/page.js';
import { models } from '../pages/ai-providers.js';
import { browser } from '../pages/browser.js';
import { evaluation } from '../pages/evaluation.js';
import { limitsPage } from '../pages/limits.js';
import { moderation } from '../pages/moderation.js';
import { overview } from '../pages/overview.js';
import { registry } from '../pages/registry.js';
import { routing } from '../pages/routing.js';
import { security } from '../pages/security.js';
import { system } from '../pages/settings.js';
import { userPage, users } from '../pages/users.js';
import { voice } from '../pages/voice.js';

var C = Colon, $ = C.$, $$ = C.$$;

/* ================= More (every section, for phones) ================= */
var SECTIONS = [
  ['/', 'grid', 'Overview', 'Users, requests, errors, provider health', 'moderator'],
  ['/users', 'users', 'Users', 'Search, suspend, roles, sessions', 'moderator'],
  ['/moderation', 'hand', 'Moderation', 'Reported chats and bad feedback', 'moderator'],
  ['/models', 'bot', 'Models and providers', 'Models, providers and API keys', 'admin'],
  ['/routing', 'lightning', 'Routing', 'Model order per mode, live', 'admin'],
  ['/limits', 'target', 'Usage and limits', 'Daily quotas per user and mode', 'admin'],
  ['/evaluation', 'list', 'Evaluation', 'Benchmark runs and model feedback', 'admin'],
  ['/registry', 'globe', 'African AI registry', 'Language models and datasets', 'admin'],
  ['/voice', 'mic', 'Voice', 'STT and TTS engines', 'admin'],
  ['/browser', 'compass', 'Browser', 'Live sessions (coming)', 'admin'],
  ['/system', 'settings', 'System settings', 'Branding, flags, maintenance, banner, web search', 'super_admin'],
  ['/security', 'shield', 'Security', 'Staff 2FA, sign-ins, audit trail', 'admin'],
  ['/account', 'user', 'Your account', 'Profile, password, two-factor', 'user']
];
function more(view) {
  gate(view, function () {
    view.innerHTML = head('Admin', C.roleName(C.user.role) + ' · everything you can manage') + '<div class="list">' +
      SECTIONS.filter(function (s) { return C.hasRole(s[4]); }).map(function (s) { return C.row('#' + s[0], s[1], s[2],
        s[3]); }).join('') + '</div>';
  });
}

A.start = function () {
  var nav = SECTIONS.filter(function (s) { return s[0] !== '/account'; }).map(function (s) {
    return { href: s[0], label: s[2].replace(' and providers', '').replace('Usage and limits', 'Limits').replace(
      'African AI registry', 'African AI').replace('System settings', 'System'), icon: s[1], role: s[4],
      tab: ['/', '/users', '/moderation'].indexOf(s[0]) > -1 };
  });
  nav.push({ href: '/more', label: 'More', icon: 'more', role: 'admin', side: false });
  nav.push({ href: '/account', label: 'Account', icon: 'user', match: /^\/account/ });
  var r = function (path, render, title, role) { return { path: path, auth: true, wide: true, title: title,
    render: render, role: role }; };
  C.start({
    app: 'admin', title: 'Colon Admin', subtitle: 'Admin by Nifelux', allowSignup: false,
    nav: nav,
    routes: [
      r('/', overview, ''), r('/users', users, 'Users', 'moderator'), Object.assign(r('/users/:id', userPage, 'User',
        'moderator'), { back: '/users' }),
      r('/moderation', moderation, 'Moderation', 'moderator'), r('/models', models, 'Models', 'admin'), r('/routing',
        routing, 'Routing', 'admin'),
      r('/limits', limitsPage, 'Limits', 'admin'), r('/evaluation', evaluation, 'Evaluation', 'admin'), r('/registry',
        registry, 'African AI', 'admin'),
      r('/voice', voice, 'Voice', 'admin'), r('/browser', browser, 'Browser', 'admin'), r('/system', system, 'System',
        'super_admin'),
      r('/security', security, 'Security', 'admin'), r('/audit', function (v) { C.go('/security?tab=audit', true);
        }, 'Audit', 'admin'), r('/more', more, 'Admin', 'admin')
    ]
  });
};

export { A as ColonAdmin };
