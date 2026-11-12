/* Colon App core · sign in, sign up, reset, verify and 2FA flows (page and modal), Google sign-in. */

import { api, refreshUser } from './api.js';
import { $, $$, esc } from './dom.js';
import { bindForm, field } from './forms.js';
import { MARK, icon, logo } from './icons.js';
import { sheet, toast } from './overlays.js';
import { go } from './router.js';
import { LANGS, state, theme } from './state.js';

/* ---------- Shared account screens ---------- */
function authPage(view, title, lead, body) {
  view.innerHTML = '<div class="auth"><div class="inner">' + (title ? '<div class="brand">' + logo(state.brand,
    'by Nifelux', 'lg') + '</div>' +
    '<h1 class="h1">' + title + '</h1><p class="lead">' + lead + '</p>' : '') + body + '</div>' +
    ('<div class="legal">Colon AI by Nifelux · <a href="#/terms">Terms</a> · <a '
      + 'href="#/privacy">Privacy</a></div></div>');
}
// After signing in or out. Apps usable while signed out (guestMode: Colon AI) reload, so every screen
// and data adapter starts fresh for the new account; the others route to `next`.
function afterAuth(q, next) {
  next = next || (q && q.get('next')) || '/';
  return refreshUser().then(function () {
    if (state.guestMode) { location.hash = '#' + next; location.reload(); return; }
    go(next, true);
  });
}
function signedOut(message) {
  state.user = null;
  if (message) toast(message);
  if (state.guestMode) { location.hash = '#/'; location.reload(); return; }
  go('/login', true);
}

/* ---------- Sign in / sign up flow (ChatGPT-style): Google first, OR, email → password or new account ----------
   Used by the /login and /register pages and by Colon.authModal() (Colon AI's Log in / Sign up buttons).
   No "does this email exist?" lookup: the flow follows the button you chose, so accounts can't be probed. */
var gsi = { loading: null, handler: null };
function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (gsi.loading) return gsi.loading;
  gsi.loading = new Promise(function (resolve, reject) {
    var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = resolve; s.onerror = function () { gsi.loading = null;
      reject(new Error('Google sign-in couldn’t load.')); };
    document.head.appendChild(s);
  });
  return gsi.loading;
}
function googleInto(slot, onCredential) {
  var cid = state.config && state.config.google_client_id; if (!cid || !slot) return false;
  gsi.handler = onCredential;
  loadGsi().then(function () {
    if (!gsi.inited) { google.accounts.id.initialize({ client_id: cid, callback: function (resp) { if (
      gsi.handler) gsi.handler(resp.credential); } }); gsi.inited = true; }
    if (!document.body.contains(slot)) return;
    slot.innerHTML = '';
    google.accounts.id.renderButton(slot, { theme: theme.current() === 'light' ? 'outline' : 'filled_black',
      size: 'large', shape: 'pill', width: Math.max(220, Math.min(400, slot.clientWidth || 360)),
      text: 'continue_with', logo_alignment: 'center' });
  }).catch(function () { slot.innerHTML =
    '<p class="tiny muted" style="text-align:center">Google sign-in couldn’t load. Use your email below.</p>'; });
  return true;
}

// authFlow(box, { mode: 'login'|'signup', next, page, onDone }) renders the flow into `box`.
function authFlow(box, o) {
  o = o || {};
  var mode = o.mode === 'signup' && state.allowSignup ? 'signup' : 'login';
  var email = o.email || '';
  var done = o.onDone || function () { return afterAuth(null, o.next); };
  function head(title, lead) {
    return (o.page ? '<div class="brand">' + logo(state.brand, 'by Nifelux',
      'lg') + '</div>' : '<div class="auth-mark" aria-hidden="true">' + MARK + '</div>') +
      '<h1 class="h1 auth-title">' + esc(title) + '</h1>' + (lead ? '<p class="lead auth-lead">' + esc(lead)
        + '</p>' : '');
  }
  function emailChip() { return '<div class="auth-email"><span>' + esc(email)
    + '</span><button type="button" class="link" data-edit>Edit</button></div>'; }
  function wire() {
    var e = $('[data-edit]', box); if (e) e.addEventListener('click', start);
    $$('[data-switch]', box).forEach(function (a) { a.addEventListener('click', function (ev) { ev.preventDefault();
      mode = a.getAttribute('data-switch'); start(); }); });
  }
  function totp(submitCode) {
    box.innerHTML = head('Two-step check', 'Enter the 6-digit code from your authenticator app.') +
      '<form class="form" novalidate>' + field({ name: 'code', label: 'Authentication code', mode: 'numeric',
        auto: 'one-time-code', max: 6, cls: 'code-input', placeholder: '••••••' }) +
      ('<button class="btn primary block" type="submit">Verify</button></form><p class="alt"><button type="button" '
        + 'class="link" data-back>Use a different account</button></p>');
    $('[data-back]', box).addEventListener('click', start);
    bindForm($('form', box), function (d) { return submitCode(d.code).then(done); });
    var i = $('input', box); if (i) setTimeout(function () { i.focus(); }, 30);
  }
  function google(credential) {
    return api('/auth/google', { method: 'POST', body: { credential: credential } }).then(function (d) {
      if (d.need_totp) return totp(function (code) { return api('/auth/google', { method: 'POST',
        body: { credential: credential, code: code } }); });
      return done();
    }).catch(function (e) { toast(e.message, 'bad'); });
  }
  function start() {
    var signup = mode === 'signup', hasGoogle = !!(state.config && state.config.google_client_id);
    box.innerHTML = head(signup ? 'Create an account' : (state.allowSignup ? 'Log in or sign up' : 'Log in'),
      o.lead || (signup ? 'Free to start. Built for Africa.' : 'Welcome back to ' + (state.title || 'Colon') + '.')) +
      (hasGoogle ? '<div class="auth-google" data-g></div><div class="divider">OR</div>' : '') +
      '<form class="form" novalidate>' + field({ name: 'email', label: 'Email address', type: 'email', auto: 'email',
        mode: 'email', value: email, placeholder: 'you@example.com' }) +
      '<button class="btn primary block" type="submit">Continue</button></form>' +
      (state.allowSignup ? '<p class="alt">' + (signup
        ? 'Already have an account? <a href="#/login" data-switch="login">Log in</a>' :
        'Don’t have an account? <a href="#/register" data-switch="signup">Sign up</a>') + '</p>' : '');
    wire();
    if (hasGoogle) googleInto($('[data-g]', box), google);
    bindForm($('form', box), function (d) {
      var e = String(d.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) { var err = new Error('Enter a valid email address.');
        err.field = 'email'; throw err; }
      email = e; return mode === 'signup' ? register() : password();
    });
    if (!o.page || !('ontouchstart' in window)) { var inp = $('input', box); if (inp) setTimeout(function () {
      inp.focus(); }, 40); }
  }
  function password() {
    box.innerHTML = head('Enter your password') + emailChip() +
      '<form class="form" novalidate><input type="email" name="email" value="' + esc(email)
        + '" autocomplete="username" hidden>' +
      field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) +
      ('<div style="text-align:right;margin-top:-4px"><button type="button" class="link small" data-forgot>Forgot '
        + 'password?</button></div>') +
      '<button class="btn primary block" type="submit">Continue</button></form>' +
      (state.allowSignup
        ? '<p class="alt">Don’t have an account? <a href="#/register" data-switch="signup">Sign up</a></p>' : '');
    wire();
    $('[data-forgot]', box).addEventListener('click', forgot);
    bindForm($('form', box), function (d) {
      return api('/auth/login', { method: 'POST', body: { email: email, password: d.password } }).then(function (r) {
        if (r.need_totp) return totp(function (code) { return api('/auth/login', { method: 'POST',
          body: { email: email, password: d.password, code: code } }); });
        return done();
      });
    });
    setTimeout(function () { var i = $('input[type=password]', box); if (i) i.focus(); }, 40);
  }
  function register() {
    box.innerHTML = head('Create your account', 'Free to start. Built for Africa.') + emailChip() +
      '<form class="form" novalidate><input type="email" name="email" value="' + esc(email)
        + '" autocomplete="username" hidden>' +
      field({ name: 'name', label: 'Your name', auto: 'name', max: 80, placeholder: 'Ada Okafor' }) +
      field({ name: 'password', label: 'Password', type: 'password', auto: 'new-password', meter: true,
        placeholder: 'At least 10 characters' }) +
      field({ name: 'language', label: 'Preferred language', type: 'select', value: 'en', options: Object.keys(
        LANGS).map(function (k) { return [k, LANGS[k]]; }) }) +
      ('<div class="field" data-field="accept_terms"><label class="check"><input type="checkbox" '
        + 'name="accept_terms"> <span>I agree to the <a class="link" href="#/terms" target="_blank">Terms</a> and <a '
        + 'class="link" href="#/privacy" target="_blank">Privacy Policy</a>.</span></label><div '
        + 'class="msg"></div></div>') +
      '<button class="btn primary block" type="submit">Create account</button></form>' +
      '<p class="alt">Already have an account? <a href="#/login" data-switch="login">Log in</a></p>';
    wire();
    bindForm($('form', box), function (d) {
      d.email = email;
      return api('/auth/register', { method: 'POST', body: d }).then(function (r) {
        toast(r.verification_sent ? 'Account created. Check your email to confirm it.' :
          'Account created. Welcome to Colon!', 'ok');
        return done();
      });
    });
    setTimeout(function () { var i = $('input[name=name]', box); if (i) i.focus(); }, 40);
  }
  function forgot() {
    box.innerHTML = head('Reset your password', 'We’ll email you a link to choose a new password.') +
      '<form class="form" novalidate>' + field({ name: 'email', label: 'Email address', type: 'email', auto: 'email',
        mode: 'email', value: email }) +
      ('<button class="btn primary block" type="submit">Send reset link</button></form><p class="alt"><button '
        + 'type="button" class="link" data-back>Back to log in</button></p>');
    $('[data-back]', box).addEventListener('click', function () { mode = 'login'; password(); });
    bindForm($('form', box), function (d) {
      email = String(d.email || '').trim().toLowerCase();
      return api('/auth/forgot', { method: 'POST', body: { email: email } }).then(function () {
        box.innerHTML = head('Check your email', 'If an account exists for ' + email
          + ', a reset link is on its way. It works for 1 hour.') +
          '<button type="button" class="btn block" data-back>Back to log in</button>';
        $('[data-back]', box).addEventListener('click', function () { mode = 'login'; start(); });
      });
    });
  }
  start();
}

// Colon.authModal({ mode: 'login'|'signup', lead }) opens the flow in a dialog (bottom sheet on phones).
function authModal(o) {
  o = o || {};
  if (!state.online) { toast('Can’t reach Colon right now. Check your connection and try again.', 'bad'); return; }
  sheet('<button type="button" class="icon-btn sm auth-close" data-close aria-label="Close">' + icon('x')
    + '</button><div class="auth-flow" data-flow></div>', function (el, close) {
    authFlow($('[data-flow]', el), { mode: o.mode, lead: o.lead, onDone: function () { close(); return afterAuth(null,
      o.next || location.hash.replace(/^#/, '') || '/'); } });
  }, { cls: 'auth-sheet', label: o.mode === 'signup' ? 'Sign up' : 'Log in' });
}

export { authFlow, authModal, authPage, signedOut };
