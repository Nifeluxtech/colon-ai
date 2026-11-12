/* Colon App core · account routes and screens: auth routes, legal pages, verify banner, account home. */

import { profilePage, securityPage, sessionsPage } from './account-security.js';
import { api, refreshUser } from './api.js';
import { authFlow, authPage, signedOut } from './auth.js';
import { $, $$, esc, initials } from './dom.js';
import { bindForm, field } from './forms.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';
import { go } from './router.js';
import { LANGS, roleName, state, theme } from './state.js';

var authRoutes = [
  { path: '/login', auth: 'guest', bare: true, title: 'Log in', render: function (view, ctx) {
    authPage(view, '', '', '<div class="auth-flow" data-flow></div>');
    authFlow($('[data-flow]', view), { mode: 'login', page: true, next: ctx.query.get('next') || '/' });
  } },
  { path: '/register', auth: 'guest', bare: true, title: 'Sign up', render: function (view, ctx) {
    if (!state.allowSignup) return go('/login', true);
    authPage(view, '', '', '<div class="auth-flow" data-flow></div>');
    authFlow($('[data-flow]', view), { mode: 'signup', page: true, next: ctx.query.get('next') || '/' });
  } },
  { path: '/forgot', bare: true, title: 'Reset password', render: function (view) {
    authPage(view, 'Reset your password', "Enter your email and we'll send you a reset link.",
      '<form class="form" novalidate>' + field({ name: 'email', label: 'Email', type: 'email', auto: 'email',
        mode: 'email' }) +
      ('<button class="btn primary block" type="submit">Send reset link</button></form><p class="alt"><a '
        + 'href="#/login">Back to sign in</a></p>'));
    bindForm($('form', view), function (d) {
      return api('/auth/forgot', { method: 'POST', body: d }).then(function () {
        authPage(view, 'Check your email', 'If an account exists for ' + esc(d.email)
          + ', a reset link is on its way. It works for 1 hour.',
          '<a class="btn block" href="#/login">Back to sign in</a>');
      });
    });
  } },
  { path: '/reset', bare: true, title: 'New password', render: function (view, ctx) {
    authPage(view, 'Choose a new password', "You'll be signed out on all devices.",
      '<form class="form" novalidate>' + field({ name: 'password', label: 'New password', type: 'password',
        auto: 'new-password', meter: true }) +
      '<button class="btn primary block" type="submit">Save password</button></form>');
    bindForm($('form', view), function (d) {
      return api('/auth/reset', { method: 'POST', body: { token: ctx.query.get('token'), password: d.password } }).then(
        function () {
        toast('Password updated. Please sign in.', 'ok'); state.user = null; go('/login', true);
      });
    });
  } },
  { path: '/verify', bare: true, title: 'Confirm email', render: function (view, ctx) {
    authPage(view, 'Confirming…', 'One moment.', '<div class="skel" style="height:50px"></div>');
    api('/auth/verify-email', { method: 'POST', body: { token: ctx.query.get('token') } }).then(function () {
      return refreshUser().then(function () { authPage(view, 'Email confirmed',
        'Thanks! Your account is fully set up.', '<a class="btn primary block" href="#/">Continue</a>'); });
    }).catch(function (e) { authPage(view, 'Link not valid', esc(e.message),
      '<a class="btn block" href="#/account">Go to account</a>'); });
  } },
  { path: '/terms', bare: true, title: 'Terms', render: function (view) { legal(view, 'Terms of Service', TERMS); } },
  { path: '/privacy', bare: true, title: 'Privacy', render: function (view) { legal(view, 'Privacy Policy', PRIVACY);
    } },

  { path: '/account', auth: true, title: 'Account', render: accountHome },
  { path: '/account/profile', auth: true, title: 'Profile', back: '/account', render: profilePage },
  { path: '/account/security', auth: true, title: 'Security', back: '/account', render: securityPage },
  { path: '/account/sessions', auth: true, title: 'Devices', back: '/account', render: sessionsPage }
];

var TERMS = ('<p><b>Draft, November 2026.</b> These terms will be finalised before public launch (Roadmap Phase '
  + '11).</p><p>Colon AI is provided by Nifelux. Use it lawfully and respectfully. Do not use Colon to harm others, '
  + 'break the law, or attack the service. AI answers can be wrong: check important information, especially medical, '
  + 'legal and financial matters.</p><p>You can delete your account at any time from Account → Security.</p>');
var PRIVACY = ('<p><b>Draft, November 2026.</b> This policy will be finalised for NDPR/NDPA compliance before public '
  + 'launch.</p><p>We store your name, email, language choice, sign-in sessions (device and IP) and security logs to '
  + 'run and protect your account. Passwords are stored as one-way hashes. We never sell your data.</p><p>Deleting '
  + 'your account removes your profile and sign-in sessions immediately. Security logs are kept for a limited time to '
  + 'protect the service.</p>');
function legal(view, title, html) {
  view.innerHTML = ('<div class="auth"><div class="inner" style="max-width:640px"><a class="btn ghost sm" '
    + 'href="javascript:history.back()">') + icon('back')
    + ' Back</a><h1 class="h1" style="text-align:left;margin-top:16px">' + title
    + '</h1><div class="card" style="color:var(--text-2);line-height:1.7">' + html + '</div></div></div>';
}

function verifyBanner() {
  if (!state.user || state.user.email_verified) return '';
  return '<div class="banner">' + icon('mail')
    + '<span>Confirm your email to secure your account.</span><button class="btn sm" data-resend>Resend</button></div>';
}
function bindBanner(view) {
  var b = $('[data-resend]', view); if (!b) return;
  b.addEventListener('click', function () {
    b.disabled = true;
    api('/auth/resend-verification', { method: 'POST' }).then(function (r) { toast(r.sent === false
      ? 'Email isn’t switched on yet. We’ll confirm you later.' : 'Confirmation email sent.', r.sent === false
      ? '' : 'ok'); })
      .catch(function (e) { toast(e.message, 'bad'); b.disabled = false; });
  });
}

function accountHome(view) {
  var u = state.user;
  view.innerHTML = verifyBanner() +
    ('<div class="card" style="display:flex;align-items:center;gap:14px"><div class="avatar" '
      + 'style="width:56px;height:56px;font-size:20px">') + esc(initials(u.name, u.email)) + '</div>' +
    '<div style="min-width:0"><div class="h2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
      + esc(u.name || 'Your account')
      + '</div><div class="small muted" style="overflow:hidden;text-overflow:ellipsis">' + esc(u.email) + '</div>' +
    '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="badge flame">' + roleName(u.role)
      + '</span>' + (u.totp_enabled ? '<span class="badge ok">2FA on</span>' : '') + '</div></div></div>' +
    '<div class="section-title">Settings</div><div class="list">' +
    row('#/account/profile', 'user', 'Profile', 'Name and language: ' + LANGS[u.language]) +
    row('#/account/security', 'shield', 'Security', u.totp_enabled ? 'Two-factor on · Password' :
      'Turn on two-factor · Password') +
    row('#/account/sessions', 'devices', 'Devices', 'Where you’re signed in') +
    '<div class="set-row"><span class="ico">' + icon('palette')
      + ('</span><span class="body"><div class="title">Appearance</div><div class="sub">Light, dark or match your '
      + 'device</div></span>') +
    '<div class="seg" role="group" aria-label="Theme" data-theme-seg>' + [['dark', 'Dark'], ['light', 'Light'],
      ['system', 'Auto']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" aria-pressed="'
      + (theme.get() === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div></div></div>' +
    '<div class="section-title">About</div><div class="list">' + row('#/terms', 'file', 'Terms of Service',
      '') + row('#/privacy', 'lock', 'Privacy Policy', '') + '</div>' +
    '<div style="margin-top:24px"><button class="btn block" data-logout>' + icon('out') + ' Sign out</button></div>' +
    '<p class="tiny muted" style="text-align:center;margin-top:18px">Colon AI by Nifelux</p>';
  bindBanner(view);
  $$('[data-theme-seg] button', view).forEach(function (b) { b.addEventListener('click', function () { theme.set(
    b.getAttribute('data-t')); $$('[data-theme-seg] button', view).forEach(function (x) { x.setAttribute(
    'aria-pressed', x === b); }); }); });
  $('[data-logout]', view).addEventListener('click', function () {
    api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () { signedOut(); });
  });
}
function row(href, ic, title, sub) {
  return '<a class="row" href="' + href + '"><span class="ico">' + icon(ic)
    + '</span><span class="body"><div class="title">' + esc(title) + '</div>' + (sub ? '<div class="sub">' + esc(sub)
    + '</div>' : '') + '</span><span class="chev">' + icon('chev') + '</span></a>';
}

export { authRoutes, bindBanner, row, verifyBanner };
