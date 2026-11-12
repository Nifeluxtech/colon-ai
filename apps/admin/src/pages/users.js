/* Colon Admin · Users: search and filter, and one user's page (role, limits, suspend, sessions). */

import { LABELS } from './security.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { act, opt, sel } from '../components/form.js';
import { chips, fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';
import { ROLES } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= Users ================= */
function users(view) {
  gate(view, function () {
    var filter = '', q = '', t;
    view.innerHTML = head('Users', C.hasRole('admin') ? 'Search, suspend, roles, limits and sessions.' :
      'Search and view accounts (read-only for moderators).') +
      '<form id="sf" class="card adm-search">' + icon('search')
        + ('<input class="input" name="q" type="search" placeholder="Search name or email" aria-label="Search '
        + 'users"></form>') +
      chips([['', 'All'], ['staff', 'Staff'], ['suspended', 'Suspended']], '', 'data-f')
        + '<div class="list ulist" id="ul" style="margin-top:12px"></div>';
    function load() {
      $('#ul', view).innerHTML = skel(2);
      C.api('/admin/users?q=' + encodeURIComponent(q) + '&filter=' + filter).then(function (d) {
        if (!d.users.length) { $('#ul', view).innerHTML = '<div class="empty">No users found.</div>'; return; }
        $('#ul', view).innerHTML = d.users.map(function (u) {
          return '<a class="u row" href="#/users/' + u.id + '"><span class="avatar">' + esc(C.initials(u.name,
            u.email)) + '</span><span class="body"><div class="title">' + esc(u.name || u.email)
            + '</div><div class="sub">' + esc(u.email) + '</div>' +
            '<div class="adm-badges"><span class="badge ' + (u.role !== 'user' ? 'flame' : '') + '">' + C.roleName(
              u.role) + '</span>' + (u.totp_enabled ? '<span class="badge ok">2FA</span>' : '') + (u.verified
              ? '' : '<span class="badge warn">Unverified</span>') + (u.locked
              ? '<span class="badge warn">Locked</span>' : '') + (u.suspended
              ? '<span class="badge bad">Suspended</span>' : '') + '</div></span><span class="chev">' + icon('chev')
              + '</span></a>';
        }).join('');
      }).catch(function (e) { fail($('#ul', view), e); });
    }
    $('#sf', view).addEventListener('submit', function (e) { e.preventDefault(); });
    $('input', $('#sf', view)).addEventListener('input', function (e) { clearTimeout(t); q = e.target.value;
      t = setTimeout(load, 300); });
    $$('[data-f]', view).forEach(function (b) { b.addEventListener('click', function () { filter = b.getAttribute(
      'data-f'); $$('[data-f]', view).forEach(function (x) { x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b); }); load(); }); });
    load();
  });
}

function userPage(view, ctx) {
  gate(view, function () {
    var id = ctx.params[0];
    view.innerHTML = skel(4);
    C.api('/admin/users/' + encodeURIComponent(id)).then(function (d) {
      var u = d.user, me = C.user, self = u.id === me.id, isAdmin = C.hasRole('admin');
      var canTouch = isAdmin && !self && (me.role === 'super_admin' || ['user', 'moderator'].indexOf(u.role) > -1);
      var options = ROLES.filter(function (r) { return me.role === 'super_admin' || ['user', 'moderator'].indexOf(r) >
        -1; });
      view.innerHTML =
        '<div class="card adm-user"><span class="avatar" style="width:52px;height:52px;font-size:19px">'
          + esc(C.initials(u.name, u.email)) + '</span><div style="min-width:0"><div class="h2">' + esc(u.name
          || 'No name') + '</div><div class="small muted" style="word-break:break-all">' + esc(u.email) + '</div>' +
        '<div class="adm-badges"><span class="badge ' + (u.role !== 'user' ? 'flame' : '') + '">' + C.roleName(u.role)
          + '</span>' + (u.totp_enabled ? '<span class="badge ok">2FA</span>' : '') + (u.verified
          ? '<span class="badge ok">Verified</span>' : '<span class="badge warn">Unverified</span>') + (u.locked
          ? '<span class="badge warn">Locked</span>' : '') + (d.suspension
          ? '<span class="badge bad">Suspended</span>' : '') + (u.has_google ? '<span class="badge">Google</span>' :
          '') + '</div></div></div>' +
        '<p class="tiny muted">Joined ' + C.ago(u.created_at) + ' · ' + esc(C.LANGS[u.language] || u.language) + ' · '
          + num(d.conversations) + ' saved chats · daily limit ' + (d.daily_limit == null ? 'default' : num(
          d.daily_limit)) + '</p>' +
        (d.suspension ? '<div class="banner bad">' + icon('lock') + '<span>Suspended ' + C.ago(d.suspension.created_at)
          + (d.suspension.by_email ? ' by ' + esc(d.suspension.by_email) : '') + (d.suspension.reason ? ': '
          + esc(d.suspension.reason) : '') + '</span></div>' : '') +
        (!isAdmin ? '<p class="small muted">' + icon('info')
          + ' Moderators can view accounts but not change them.</p>' : '') +
        (isAdmin ? '<div class="section-title">Manage</div>' + (canTouch
          ? '<form class="card form" data-role novalidate>' + sel('role', 'Role', u.role, options.map(function (r) {
          return [r, C.roleName(r)];
          })) + '<button class="btn primary block" type="submit">Save role</button></form>' : '<p class="small muted">'
          + (self ? 'You can’t change your own account here.' : 'Only a Super Admin can manage this account.')
          + '</p>') +
          '<form class="card form" data-limit novalidate style="margin-top:12px">' + opt('daily_limit',
            'Daily reply limit (empty = platform default)', d.daily_limit, 'Default', 'number')
            + '<button class="btn block" type="submit">Save limit</button></form>' +
          '<div class="list" style="margin-top:12px">' +
          (canTouch ? (d.suspension ? '<button class="row" data-unsuspend><span class="ico">' + icon('check')
            + ('</span><span class="body"><div class="title">Unsuspend</div><div class="sub">Let this person sign '
            + 'in again</div></span></button>')
            : '<button class="row" data-suspend><span class="ico" style="color:var(--bad)">' + icon('lock')
              + ('</span><span class="body"><div class="title">Suspend account</div><div class="sub">Blocks sign-in '
              + 'and ends every session now</div></span></button>')) : '') +
          (u.locked ? '<button class="row" data-unlock><span class="ico">' + icon('key')
            + ('</span><span class="body"><div class="title">Unlock</div><div class="sub">Clear failed sign-in '
            + 'attempts</div></span></button>') : '') +
          (canTouch ? '<button class="row" data-signout><span class="ico">' + icon('out')
            + ('</span><span class="body"><div class="title">Sign out everywhere</div><div class="sub">End all '
            + 'sessions</div></span></button>') : '') + '</div>' : '') +
        '<div class="section-title">Sessions (' + d.sessions.length + ')</div><div class="list">' + (d.sessions.length
          ? d.sessions.map(function (s) {
          return '<div class="row"><span class="ico">' + icon(/Android|iPhone/.test(s.user_agent)
            ? 'phone' : 'devices') + '</span><span class="body"><div class="title">' + esc(C.device(s.user_agent))
            + '</div><div class="sub">' + esc(s.ip) + ' · active ' + C.ago(s.last_seen_at) + ' · since ' + C.ago(
            s.created_at) + '</div></span>' +
            (canTouch ? '<button class="btn sm" data-revoke="' + s.id + '">Revoke</button>' : '') + '</div>';
        }).join('') : '<div class="empty small">No active sessions.</div>') + '</div>' +
        '<div class="section-title">Recent sign-in events</div><div class="list">' + (d.logins.length ? d.logins.map(
          function (l) {
          return '<div class="row"><span class="ico">' + icon(/failed|blocked/.test(l.action) ? 'alert' : 'user')
            + '</span><span class="body"><div class="title">' + esc(LABELS[l.action] || l.action)
            + '</div><div class="sub">' + esc(l.ip) + '</div></span><span class="tiny muted">' + C.ago(l.created_at)
            + '</span></div>';
        }).join('') : '<div class="empty small">None yet.</div>') + '</div>';
      var reload = function () { userPage(view, ctx); };
      var rf = $('[data-role]', view);
      if (rf) C.bindForm(rf, function (f) { return C.api('/admin/users/' + u.id + '/role', { method: 'PATCH',
        body: { role: f.role } }).then(function () { C.toast('Role updated.', 'ok'); reload(); }); });
      var lf = $('[data-limit]', view);
      if (lf) C.bindForm(lf, function (f) { return C.api('/admin/users/' + u.id + '/limit', { method: 'PATCH',
        body: { daily_limit: f.daily_limit === '' ? null : Number(f.daily_limit) } }).then(function () { C.toast(
        'Limit saved.', 'ok'); reload(); }); });
      var on = function (sel, fn) { var b = $(sel, view); if (b) b.addEventListener('click', fn); };
      on('[data-suspend]', function () {
        C.prompt({ title: 'Suspend ' + (u.name || u.email)
          + '? They are signed out everywhere and can’t sign in until unsuspended.',
          label: 'Reason (optional, kept in the audit log)', value: '', confirm: 'Suspend', required: false,
          max: 500 }).then(function (reason) {
          if (reason === null) return;
          act(C.api('/admin/users/' + u.id + '/suspend', { method: 'POST', body: { reason: reason } }), function () {
            C.toast('Account suspended.', 'ok'); reload(); });
        });
      });
      on('[data-unsuspend]', function () { act(C.api('/admin/users/' + u.id + '/unsuspend', { method: 'POST' }),
        function () { C.toast('Account unsuspended.', 'ok'); reload(); }); });
      on('[data-unlock]', function () { act(C.api('/admin/users/' + u.id + '/unlock', { method: 'POST' }),
        function () { C.toast('Account unlocked.', 'ok'); reload(); }); });
      on('[data-signout]', function () { C.confirm({ title: 'Sign out everywhere?',
        body: 'Ends every session for this account.', confirm: 'Sign out' }).then(function (ok) { if (ok) act(C.api(
        '/admin/users/' + u.id + '/signout', { method: 'POST' }), function () { C.toast('Signed out everywhere.',
        'ok'); reload(); }); }); });
      $$('[data-revoke]', view).forEach(function (b) { b.addEventListener('click', function () { b.disabled = true;
        act(C.api('/admin/users/' + u.id + '/sessions/' + b.getAttribute('data-revoke'), { method: 'DELETE' }),
        function () { C.toast('Session revoked.'); reload(); }).catch(function () { b.disabled = false; }); }); });
    }).catch(function (e) { fail(view, e); });
  });
}

export { userPage, users };
