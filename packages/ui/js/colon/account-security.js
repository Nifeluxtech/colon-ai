/* Colon App core · account screens: profile, security (password, two-factor) and sessions. */

import { api, refreshUser } from './api.js';
import { signedOut } from './auth.js';
import { $, $$, ago, device, esc } from './dom.js';
import { bindForm, field } from './forms.js';
import { icon } from './icons.js';
import { sheet, toast } from './overlays.js';
import { LANGS, state } from './state.js';

function profilePage(view) {
  var u = state.user;
  view.innerHTML = (
    '<h1 class="h1">Profile</h1><p class="lead">How Colon greets you and the language it answers in.</p><form '
    + 'class="form card" novalidate>') +
    field({ name: 'name', label: 'Name', value: u.name, auto: 'name', max: 80 }) +
    field({ name: 'language', label: 'Preferred language', type: 'select', value: u.language, options: Object.keys(
      LANGS).map(function (k) { return [k, LANGS[k]]; }) }) +
    '<div class="field"><label>Email</label><input class="input" value="' + esc(u.email) + '" disabled></div>' +
    '<button class="btn primary block" type="submit">Save changes</button></form>';
  bindForm($('form', view), function (d) {
    return api('/account/profile', { method: 'PATCH', body: d }).then(function (r) { state.user = r.user;
      toast('Profile saved.', 'ok'); });
  });
}

function securityPage(view) {
  var u = state.user, staff = u.role !== 'user';
  view.innerHTML = '<h1 class="h1">Security</h1><p class="lead">Keep your Colon account safe.</p>' +
    '<div class="section-title">Two-factor authentication</div><div class="card">' +
    ('<div style="display:flex;gap:12px;align-items:flex-start"><span class="ico" '
      + 'style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--surface-2)'
      + ';flex:none">') + icon('phone') + '</span>' +
    '<div style="flex:1"><div class="h3">Authenticator app ' + (u.totp_enabled ? '<span class="badge ok">On</span>' :
      '<span class="badge">Off</span>') + '</div><p class="small muted" style="margin:4px 0 0">' +
    (u.totp_enabled ? 'You’ll enter a code from your app when you sign in.' :
      'Add a 6-digit code from Google Authenticator or Authy at sign-in.' + (staff ? ' Required for admin roles.' :
      '')) + '</p></div></div>' +
    '<div style="margin-top:14px">' + (u.totp_enabled ? (staff
      ? '<p class="tiny muted">Admin accounts must keep two-factor on.</p>' :
      '<button class="btn block danger" data-2fa-off>Turn off</button>') :
      '<button class="btn primary block" data-2fa-on>Set up two-factor</button>') + '</div></div>' +
    (u.has_password ? '<div class="section-title">Password</div><form class="form card" novalidate>' +
      field({ name: 'current_password', label: 'Current password', type: 'password', auto: 'current-password' }) +
      field({ name: 'new_password', label: 'New password', type: 'password', auto: 'new-password', meter: true }) +
      ('<button class="btn block" type="submit">Change password</button><p class="tiny muted" '
        + 'style="margin:0">Other devices will be signed out.</p></form>') : '') +
    ('<div class="section-title">Danger zone</div><div class="list"><button class="row" data-delete><span '
      + 'class="ico" style="color:var(--bad)">') + icon('trash')
      + ('</span><span class="body"><div class="title" style="color:#ff8a96">Delete account</div><div '
      + 'class="sub">Permanently remove your account</div></span></button></div>');

  var pf = $('form', view);
  if (pf) bindForm(pf, function (d) { return api('/account/password', { method: 'POST', body: d }).then(function () {
    pf.reset(); toast('Password changed.', 'ok'); }); });

  var on = $('[data-2fa-on]', view);
  if (on) on.addEventListener('click', function () {
    on.disabled = true;
    api('/account/2fa/setup', { method: 'POST' }).then(function (s) {
      on.disabled = false;
      var key = s.secret.replace(/(.{4})/g, '$1 ').trim();
      sheet(('<div class="h2">Set up two-factor</div><p class="small muted">1. Open your authenticator app, or tap '
        + 'below if it’s on this phone.</p>') +
        '<a class="btn block" href="' + esc(s.otpauth) + '">' + icon('key') + ' Open authenticator app</a>' +
        ('<p class="small muted">Or enter this key manually:</p><div class="card mono" '
          + 'style="display:flex;align-items:center;gap:8px;padding:12px 14px"><span '
          + 'style="flex:1;word-break:break-all">') + esc(key)
          + '</span><button class="icon-btn" data-copy aria-label="Copy key">' + icon('copy') + '</button></div>' +
        '<p class="small muted">2. Enter the 6-digit code it shows.</p><form class="form" novalidate>' + field({
          name: 'code', label: 'Code', mode: 'numeric', auto: 'one-time-code', max: 6, cls: 'code-input',
          placeholder: '••••••' }) +
        '<button class="btn primary block" type="submit">Turn on</button></form>', function (el, close) {
        $('[data-copy]', el).addEventListener('click', function () { navigator.clipboard
          && navigator.clipboard.writeText(s.secret).then(function () { toast('Key copied.'); }); });
        bindForm($('form', el), function (d) {
          return api('/account/2fa/enable', { method: 'POST', body: d }).then(function () { close();
            toast('Two-factor is on.', 'ok'); return refreshUser().then(function () { securityPage(view); }); });
        });
      });
    }).catch(function (e) { on.disabled = false; toast(e.code === 'app_secret_missing'
      ? 'Two-factor isn’t available yet. The server needs its security key.' : e.message, 'bad'); });
  });

  var off = $('[data-2fa-off]', view);
  if (off) off.addEventListener('click', function () {
    sheet(('<div class="h2">Turn off two-factor?</div><p class="small muted">Your account will be protected by '
      + 'password only.</p><form class="form" novalidate>') +
      (u.has_password ? field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) :
        '') +
      field({ name: 'code', label: 'Code from your app', mode: 'numeric', auto: 'one-time-code', max: 6,
        cls: 'code-input' }) +
      ('<button class="btn danger block" type="submit">Turn off</button><button class="btn ghost block" '
        + 'type="button" data-close>Cancel</button></form>'), function (el, close) {
      bindForm($('form', el), function (d) { return api('/account/2fa/disable', { method: 'POST', body: d }).then(
        function () { close(); toast('Two-factor is off.'); return refreshUser().then(function () { securityPage(view);
        }); }); });
    });
  });

  $('[data-delete]', view).addEventListener('click', function () {
    sheet(('<div class="h2" style="color:#ff8a96">Delete your account?</div><p class="small muted">This permanently '
      + 'removes your profile and signs you out everywhere. It can’t be undone.</p><form class="form" novalidate>') +
      (u.has_password ? field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) :
        '') +
      field({ name: 'confirm', label: 'Type DELETE to confirm', auto: 'off', placeholder: 'DELETE' }) +
      ('<button class="btn danger block" type="submit">Delete account</button><button class="btn ghost block" '
        + 'type="button" data-close>Cancel</button></form>'), function (el, close) {
      bindForm($('form', el), function (d) { return api('/account/delete', { method: 'POST', body: d }).then(function (
        ) { close(); signedOut('Your account was deleted.'); }); });
    });
  });
}

function sessionsPage(view) {
  view.innerHTML = (
    '<h1 class="h1">Devices</h1><p class="lead">Where your account is signed in.</p><div class="list" id="sl"><div '
    + 'style="padding:16px"><div class="skel" style="height:44px"></div><div class="skel" '
    + 'style="height:44px;margin-top:12px"></div></div></div>') +
    '<button class="btn block" style="margin-top:16px" data-others>' + icon('out')
      + ' Sign out all other devices</button>';
  function load() {
    api('/account/sessions').then(function (d) {
      $('#sl', view).innerHTML = d.sessions.map(function (s) {
        return '<div class="row"><span class="ico">' + icon(/Android|iPhone/.test(s.user_agent) ? 'phone' : 'devices')
          + '</span><span class="body"><div class="title">' + esc(device(s.user_agent)) + (s.current
          ? ' <span class="badge ok">This device</span>' : '') + '</div><div class="sub">' + esc(s.ip) + ' · Active '
          + ago(s.last_seen_at) + '</div></span>' +
          (s.current ? '' : '<button class="btn sm" data-revoke="' + s.id + '">Sign out</button>') + '</div>';
      }).join('');
      $$('[data-revoke]', view).forEach(function (b) {
        b.addEventListener('click', function () { b.disabled = true; api('/account/sessions/' + b.getAttribute(
          'data-revoke'), { method: 'DELETE' }).then(function () { toast('Device signed out.'); load();
          }).catch(function (e) { toast(e.message, 'bad'); b.disabled = false; }); });
      });
    }).catch(function (e) { $('#sl', view).innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  load();
  $('[data-others]', view).addEventListener('click', function (e) {
    var b = e.currentTarget; b.disabled = true;
    api('/account/sessions/revoke-others', { method: 'POST' }).then(function () { toast('Other devices signed out.',
      'ok'); load(); }).catch(function (err) { toast(err.message, 'bad'); }).then(function () { b.disabled = false; });
  });
}

export { profilePage, securityPage, sessionsPage };
