/* Colon Admin · Security: staff two-factor, sign-in events and the audit trail. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { parseMeta } from '../components/form.js';
import { fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= Security ================= */
var LABELS = { 'auth.login': 'Signed in', 'auth.login_google': 'Signed in with Google',
  'auth.login_failed': 'Failed sign-in', 'auth.totp_failed': 'Wrong 2FA code', 'auth.logout': 'Signed out',
  'auth.login_blocked_suspended': 'Sign-in blocked (suspended)', 'user.register': 'Created account',
    'user.register_google': 'Created account (Google)', 'user.email_verified': 'Confirmed email',
    'auth.reset_requested': 'Asked for password reset', 'auth.password_reset': 'Reset password',
  'account.profile_updated': 'Updated profile', 'account.password_changed': 'Changed password',
    'account.session_revoked': 'Signed out a device', 'account.sessions_revoked_all': 'Signed out other devices',
  'account.2fa_enabled': 'Turned on 2FA', 'account.2fa_disabled': 'Turned off 2FA',
    'account.deleted': 'Deleted account', 'admin.users_viewed': 'Viewed users', 'admin.user_viewed': 'Viewed a user',
    'admin.role_changed': 'Changed a role',
  'admin.user_unlocked': 'Unlocked a user', 'admin.user_signed_out': 'Signed a user out', 'admin.session_revoked':
    'Revoked a session', 'admin.user_suspended': 'Suspended a user', 'admin.user_unsuspended': 'Unsuspended a user',
    'admin.user_limit_set': 'Set a user limit',
  'admin.provider_created': 'Added a provider', 'admin.provider_updated': 'Changed a provider',
    'admin.provider_key_set': 'Set a provider key', 'admin.provider_key_cleared': 'Removed a provider key',
    'admin.provider_deleted': 'Reset a provider',
  'admin.models_seeded': 'Copied models to the database', 'admin.model_created': 'Added a model',
    'admin.model_updated': 'Changed a model', 'admin.model_deleted': 'Deleted a model', 'admin.routing_updated':
    'Changed routing', 'admin.routing_reset': 'Reset routing',
  'admin.limits_updated': 'Changed limits', 'admin.eval_run_created': 'Logged a benchmark run',
    'admin.eval_run_deleted': 'Deleted a benchmark run', 'admin.registry_created': 'Added to the registry',
    'admin.registry_updated': 'Changed a registry entry', 'admin.registry_deleted': 'Deleted a registry entry',
  'admin.voice_updated': 'Changed voice settings', 'admin.system_updated': 'Changed system settings',
    'admin.search_updated': 'Changed web search', 'admin.search_key_set': 'Set a search API key',
    'admin.search_key_cleared': 'Removed a search API key', 'admin.report_viewed': 'Viewed a report',
    'admin.report_resolved': 'Resolved a report', 'admin.report_dismissed': 'Dismissed a report',
    'admin.report_reopened': 'Reopened a report',
  'chat.shared': 'Shared a chat', 'chat.share_reported': 'Reported a shared chat',
    'chat.deleted_all': 'Deleted all chats' };

function security(view, ctx) {
  gate(view, function () {
    var tab = (ctx && ctx.query && ctx.query.get('tab')) || 'staff';
    view.innerHTML = head('Security', 'Staff two-factor, sign-in events and the audit trail.') +
      '<div class="seg block" role="tablist">' + [['staff', 'Staff & 2FA'], ['logins', 'Sign-ins'], ['audit',
        'Audit trail']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" aria-pressed="'
        + (t[0] === tab) + '">' + t[1] + '</button>'; }).join('') + '</div><div id="sc" style="margin-top:14px"></div>';
    $$('[data-t]', view).forEach(function (b) { b.addEventListener('click', function () { C.go('/security?tab='
      + b.getAttribute('data-t'), true); }); });
    var box = $('#sc', view);
    if (tab === 'staff') {
      box.innerHTML = skel(3);
      C.api('/admin/security').then(function (d) {
        var c = d.last_24h, st = function (v, l) { return '<div class="stat"><b>' + num(v) + '</b><span>' + l
          + '</span></div>'; };
        box.innerHTML = '<div class="grid cols-4">' + st(c.logins, 'Sign-ins 24 h') + st(c.failed, 'Failed passwords')
          + st(c.totp_failed, 'Wrong 2FA codes') + st(c.locked_now, 'Locked now') + '</div>' +
          '<div class="section-title">Staff (' + d.staff.length + ')</div><div class="list">' + d.staff.map(function (
            s) {
            return C.row('#/users/' + s.id, s.totp_enabled ? 'shield' : 'alert', (s.name || s.email) + ' · '
              + C.roleName(s.role), (s.totp_enabled ? '2FA on' : '2FA OFF: blocked from admin tools')
              + ' · last sign-in ' + (s.last_login ? C.ago(s.last_login) : 'never') + (s.suspended ? ' · suspended' :
              ''));
          }).join('') + '</div>';
      }).catch(function (e) { fail(box, e); });
      return;
    }
    box.innerHTML = ('<div class="list" id="al"></div><button class="btn block" style="margin-top:12px;display:none" '
      + 'id="more">Load more</button>');
    var last = 0;
    function load() {
      C.api('/admin/audit?scope=' + (tab === 'logins' ? 'logins' : '') + (last ? '&before=' + last : '')).then(
        function (d) {
        var html = d.entries.map(function (a) {
          var meta = parseMeta(a.meta), extra = meta && meta.to ? ' (' + C.roleName(meta.from) + ' → ' + C.roleName(
            meta.to) + ')' : '';
          var bad = /failed|blocked|suspended$/.test(a.action);
          return '<div class="row"><span class="ico" style="' + (bad ? 'color:var(--warn)' : '') + '">' + icon(bad
            ? 'alert' : /admin\./.test(a.action) ? 'shield' : 'user') + '</span><span class="body"><div class="title">'
            + esc(LABELS[a.action] || a.action) + esc(extra) + '</div>' +
            '<div class="sub">' + esc(a.actor_email || (a.target_email ? '' : 'Unknown')) + (a.target_email
              ? (a.actor_email ? ' → ' : '') + esc(a.target_email) : a.target_type ? ' · ' + esc(a.target_type) + ' '
              + esc(a.target_id) : '') + ' · ' + esc(a.ip) + '</div></span><span class="tiny muted" style="flex:none">'
              + C.ago(a.created_at) + '</span></div>';
        }).join('');
        $('#al', view).insertAdjacentHTML('beforeend', html || (last
          ? '' : '<div class="empty">Nothing logged yet.</div>'));
        if (d.entries.length) last = d.entries[d.entries.length - 1].id;
        $('#more', view).style.display = d.entries.length === 50 ? '' : 'none';
      }).catch(function (e) { fail($('#al', view), e); });
    }
    $('#more', view).addEventListener('click', load);
    load();
  });
}

export { LABELS, security };
