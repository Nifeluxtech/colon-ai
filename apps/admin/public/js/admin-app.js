/* Colon Admin (Phase 4): overview, users, moderation, models and providers, routing, usage limits,
   evaluation, African AI registry, voice, browser, system settings and security.
   The API enforces every permission; the menu only hides what a role can't open.
     moderator    moderation + read-only users
     admin        everything except admin roles, provider keys and system settings
     super_admin  everything */
(function () {
  'use strict';
  var C = window.Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;
  var ROLES = ['user', 'moderator', 'admin', 'super_admin'];
  var MODE_LABELS = { general: 'General', study: 'Study', developer: 'Developer', research: 'Research' };
  var A = window.ColonAdmin = {};

  /* ---------- Helpers ---------- */
  function gate(view, fn) {
    if (!C.hasRole('moderator')) {
      view.innerHTML = '<div class="card empty">' + icon('lock') + '<div class="h3" style="color:var(--text)">No admin access</div><p class="small">This account is a Colon member. Ask a Super Admin for a staff role.</p><a class="btn" href="#/account">Go to account</a></div>';
      return;
    }
    if (!C.user.totp_enabled) {
      view.innerHTML = '<div class="card"><div class="h2">Turn on two-factor first</div><p class="small muted">Admin tools need a code from an authenticator app every time you sign in. It takes a minute.</p><a class="btn primary block" href="#/account/security">' + icon('shield') + ' Set up two-factor</a></div>';
      return;
    }
    fn();
  }
  function head(title, lead, action) {
    return '<div class="adm-head"><div><h1 class="h1">' + esc(title) + '</h1>' + (lead ? '<p class="lead">' + esc(lead) + '</p>' : '') + '</div>' + (action || '') + '</div>';
  }
  function skel(n) { var s = ''; for (var i = 0; i < (n || 3); i++) s += '<div class="skel" style="height:44px;margin-top:' + (i ? 12 : 0) + 'px"></div>'; return '<div style="padding:16px">' + s + '</div>'; }
  function fail(el, e) { el.innerHTML = '<div class="card empty">' + icon('alert') + '<p>' + esc(e.message) + '</p></div>'; }
  function num(n) { return Number(n || 0).toLocaleString(); }
  function sw(name, label, sub, on, disabled) {
    return '<label class="set-row"><span class="body"><span class="title">' + esc(label) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</span>' +
      '<span class="switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + ' aria-label="' + esc(label) + '"><i></i></span></label>';
  }
  function area(name, label, value, ph) {
    return '<div class="field" data-field="' + name + '"><label for="f-' + name + '">' + esc(label) + '</label><textarea class="input textarea" id="f-' + name + '" name="' + name + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>' + esc(value || '') + '</textarea><div class="msg"></div></div>';
  }
  function opt(name, label, value, ph, type) { return C.field({ name: name, label: label, value: value == null ? '' : value, placeholder: ph, required: false, type: type || 'text' }); }
  function sel(name, label, value, options) { return C.field({ name: name, label: label, type: 'select', value: value, options: options }); }
  function act(p, done) { return p.then(function (r) { if (done) done(r); return r; }).catch(function (e) { C.toast(e.message, 'bad'); throw e; }); }
  function chips(items, current, attr) {
    return '<div class="chips adm-chips" role="tablist">' + items.map(function (it) { return '<button type="button" class="chip sm' + (it[0] === current ? ' on' : '') + '" ' + attr + '="' + it[0] + '" aria-pressed="' + (it[0] === current) + '">' + esc(it[1]) + '</button>'; }).join('') + '</div>';
  }
  function dot(pct) { return '<span class="status-dot' + (pct == null ? ' warn' : pct >= 90 ? '' : pct >= 50 ? ' warn' : ' bad') + '"></span>'; }
  function parseMeta(m) { if (!m) return null; if (typeof m === 'string') { try { return JSON.parse(m); } catch (e) { return null; } } return m; }
  A.helpers = { head: head, sw: sw, area: area };

  /* ================= Overview ================= */
  function overview(view) {
    gate(view, function () {
      var u = C.user, hi = '<h1 class="h1">Hello, ' + esc((u.name || '').split(' ')[0] || 'admin') + '</h1><p class="lead">' + C.roleName(u.role) + ' · Colon control centre</p>';
      if (!C.hasRole('admin')) {
        view.innerHTML = hi + '<div class="list">' + C.row('#/moderation', 'hand', 'Moderation queue', 'Reported conversations and bad feedback') + C.row('#/users', 'users', 'Users', 'Search and view accounts (read-only)') + '</div>';
        return;
      }
      view.innerHTML = hi + '<div id="ov">' + '<div class="grid cols-4">' + [1, 2, 3, 4].map(function () { return '<div class="stat"><div class="skel" style="height:30px;width:60%"></div><div class="skel" style="height:12px;margin-top:8px"></div></div>'; }).join('') + '</div></div>';
      C.api('/admin/overview').then(function (d) {
        var stat = function (v, l, cls) { return '<div class="stat' + (cls ? ' ' + cls : '') + '"><b>' + v + '</b><span>' + esc(l) + '</span></div>'; };
        var rq = d.requests, failPct = rq.day ? Math.round(rq.failed_day / rq.day * 100) : 0;
        $('#ov', view).innerHTML =
          '<div class="section-title">Users</div><div class="grid cols-4">' + stat(num(d.users.users), 'Users') + stat(num(d.users.active_7d), 'Active 7 days') + stat(num(d.users.new_24h), 'New today') + stat(num(d.users.suspended), 'Suspended') + '</div>' +
          '<div class="section-title">Chat (last 24 hours)</div><div class="grid cols-4">' + stat(num(rq.day), 'Requests') + stat(num(rq.failed_day) + (rq.day ? ' <small>(' + failPct + '%)</small>' : ''), 'Failed') +
            stat(d.latency.avg_ms ? (d.latency.avg_ms / 1000).toFixed(1) + ' s' : '—', 'Avg reply time') + stat(num(d.moderation_open), 'Open reports') + '</div>' +
          '<p class="tiny muted">' + num(rq.week) + ' requests in 7 days · ' + num(rq.guest_day) + ' from guests today · routing from ' + esc(d.routing_source) + '</p>' +
          '<div class="section-title">Provider health</div><div class="list">' + (d.providers.length ? d.providers.map(function (p) {
            return '<div class="row"><span class="ico">' + dot(p.success) + '</span><span class="body"><div class="title">' + esc(p.provider) + (p.enabled ? '' : ' <span class="badge warn">Off now</span>') + '</div><div class="sub">' + num(p.attempts) + ' calls · ' + (p.avg_ms ? (p.avg_ms / 1000).toFixed(1) + ' s avg' : 'no successes') + (p.last_error ? ' · last error ' + esc(p.last_error) : '') + '</div></span><b>' + (p.success == null ? '—' : p.success + '%') + '</b></div>';
          }).join('') : '<div class="empty small">No AI calls in the last 24 hours. Enabled now: ' + esc(d.enabled_providers.join(', ') || 'none') + '</div>') + '</div>' +
          (d.models.length ? '<div class="section-title">Models (24 h)</div><div class="card adm-table-wrap"><table class="adm-table"><thead><tr><th>Model</th><th>Calls</th><th>OK</th><th>Avg</th></tr></thead><tbody>' + d.models.map(function (m) {
            return '<tr><td><b>' + esc(m.model) + '</b><div class="tiny muted">' + esc(m.provider) + '</div></td><td>' + num(m.attempts) + '</td><td>' + (m.success == null ? '—' : m.success + '%') + '</td><td>' + (m.avg_ms ? (m.avg_ms / 1000).toFixed(1) + ' s' : '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '') +
          (d.errors.length ? '<div class="section-title">Errors (24 h)</div><div class="chips">' + d.errors.map(function (e) { return '<span class="badge warn">' + esc(e.code) + ' · ' + num(e.n) + '</span>'; }).join('') + '</div>' : '') +
          '<div class="section-title">Manage</div><div class="list">' + C.row('#/models', 'bot', 'Models and providers', 'Add models, keys, enable or disable') + C.row('#/routing', 'lightning', 'Routing', 'Model order per mode, live') + C.row('#/limits', 'target', 'Usage and limits', 'Daily quotas') + '</div>';
      }).catch(function (e) { fail($('#ov', view), e); });
    });
  }

  /* ================= Users ================= */
  function users(view) {
    gate(view, function () {
      var filter = '', q = '', t;
      view.innerHTML = head('Users', C.hasRole('admin') ? 'Search, suspend, roles, limits and sessions.' : 'Search and view accounts (read-only for moderators).') +
        '<form id="sf" class="card adm-search">' + icon('search') + '<input class="input" name="q" type="search" placeholder="Search name or email" aria-label="Search users"></form>' +
        chips([['', 'All'], ['staff', 'Staff'], ['suspended', 'Suspended']], '', 'data-f') + '<div class="list ulist" id="ul" style="margin-top:12px"></div>';
      function load() {
        $('#ul', view).innerHTML = skel(2);
        C.api('/admin/users?q=' + encodeURIComponent(q) + '&filter=' + filter).then(function (d) {
          if (!d.users.length) { $('#ul', view).innerHTML = '<div class="empty">No users found.</div>'; return; }
          $('#ul', view).innerHTML = d.users.map(function (u) {
            return '<a class="u row" href="#/users/' + u.id + '"><span class="avatar">' + esc(C.initials(u.name, u.email)) + '</span><span class="body"><div class="title">' + esc(u.name || u.email) + '</div><div class="sub">' + esc(u.email) + '</div>' +
              '<div class="adm-badges"><span class="badge ' + (u.role !== 'user' ? 'flame' : '') + '">' + C.roleName(u.role) + '</span>' + (u.totp_enabled ? '<span class="badge ok">2FA</span>' : '') + (u.verified ? '' : '<span class="badge warn">Unverified</span>') + (u.locked ? '<span class="badge warn">Locked</span>' : '') + (u.suspended ? '<span class="badge bad">Suspended</span>' : '') + '</div></span><span class="chev">' + icon('chev') + '</span></a>';
          }).join('');
        }).catch(function (e) { fail($('#ul', view), e); });
      }
      $('#sf', view).addEventListener('submit', function (e) { e.preventDefault(); });
      $('input', $('#sf', view)).addEventListener('input', function (e) { clearTimeout(t); q = e.target.value; t = setTimeout(load, 300); });
      $$('[data-f]', view).forEach(function (b) { b.addEventListener('click', function () { filter = b.getAttribute('data-f'); $$('[data-f]', view).forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); load(); }); });
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
        var options = ROLES.filter(function (r) { return me.role === 'super_admin' || ['user', 'moderator'].indexOf(r) > -1; });
        view.innerHTML =
          '<div class="card adm-user"><span class="avatar" style="width:52px;height:52px;font-size:19px">' + esc(C.initials(u.name, u.email)) + '</span><div style="min-width:0"><div class="h2">' + esc(u.name || 'No name') + '</div><div class="small muted" style="word-break:break-all">' + esc(u.email) + '</div>' +
          '<div class="adm-badges"><span class="badge ' + (u.role !== 'user' ? 'flame' : '') + '">' + C.roleName(u.role) + '</span>' + (u.totp_enabled ? '<span class="badge ok">2FA</span>' : '') + (u.verified ? '<span class="badge ok">Verified</span>' : '<span class="badge warn">Unverified</span>') + (u.locked ? '<span class="badge warn">Locked</span>' : '') + (d.suspension ? '<span class="badge bad">Suspended</span>' : '') + (u.has_google ? '<span class="badge">Google</span>' : '') + '</div></div></div>' +
          '<p class="tiny muted">Joined ' + C.ago(u.created_at) + ' · ' + esc(C.LANGS[u.language] || u.language) + ' · ' + num(d.conversations) + ' saved chats · daily limit ' + (d.daily_limit == null ? 'default' : num(d.daily_limit)) + '</p>' +
          (d.suspension ? '<div class="banner bad">' + icon('lock') + '<span>Suspended ' + C.ago(d.suspension.created_at) + (d.suspension.by_email ? ' by ' + esc(d.suspension.by_email) : '') + (d.suspension.reason ? ': ' + esc(d.suspension.reason) : '') + '</span></div>' : '') +
          (!isAdmin ? '<p class="small muted">' + icon('info') + ' Moderators can view accounts but not change them.</p>' : '') +
          (isAdmin ? '<div class="section-title">Manage</div>' + (canTouch ? '<form class="card form" data-role novalidate>' + sel('role', 'Role', u.role, options.map(function (r) { return [r, C.roleName(r)]; })) + '<button class="btn primary block" type="submit">Save role</button></form>' : '<p class="small muted">' + (self ? 'You can’t change your own account here.' : 'Only a Super Admin can manage this account.') + '</p>') +
            '<form class="card form" data-limit novalidate style="margin-top:12px">' + opt('daily_limit', 'Daily reply limit (empty = platform default)', d.daily_limit, 'Default', 'number') + '<button class="btn block" type="submit">Save limit</button></form>' +
            '<div class="list" style="margin-top:12px">' +
            (canTouch ? (d.suspension ? '<button class="row" data-unsuspend><span class="ico">' + icon('check') + '</span><span class="body"><div class="title">Unsuspend</div><div class="sub">Let this person sign in again</div></span></button>'
              : '<button class="row" data-suspend><span class="ico" style="color:var(--bad)">' + icon('lock') + '</span><span class="body"><div class="title">Suspend account</div><div class="sub">Blocks sign-in and ends every session now</div></span></button>') : '') +
            (u.locked ? '<button class="row" data-unlock><span class="ico">' + icon('key') + '</span><span class="body"><div class="title">Unlock</div><div class="sub">Clear failed sign-in attempts</div></span></button>' : '') +
            (canTouch ? '<button class="row" data-signout><span class="ico">' + icon('out') + '</span><span class="body"><div class="title">Sign out everywhere</div><div class="sub">End all sessions</div></span></button>' : '') + '</div>' : '') +
          '<div class="section-title">Sessions (' + d.sessions.length + ')</div><div class="list">' + (d.sessions.length ? d.sessions.map(function (s) {
            return '<div class="row"><span class="ico">' + icon(/Android|iPhone/.test(s.user_agent) ? 'phone' : 'devices') + '</span><span class="body"><div class="title">' + esc(C.device(s.user_agent)) + '</div><div class="sub">' + esc(s.ip) + ' · active ' + C.ago(s.last_seen_at) + ' · since ' + C.ago(s.created_at) + '</div></span>' +
              (canTouch ? '<button class="btn sm" data-revoke="' + s.id + '">Revoke</button>' : '') + '</div>';
          }).join('') : '<div class="empty small">No active sessions.</div>') + '</div>' +
          '<div class="section-title">Recent sign-in events</div><div class="list">' + (d.logins.length ? d.logins.map(function (l) {
            return '<div class="row"><span class="ico">' + icon(/failed|blocked/.test(l.action) ? 'alert' : 'user') + '</span><span class="body"><div class="title">' + esc(LABELS[l.action] || l.action) + '</div><div class="sub">' + esc(l.ip) + '</div></span><span class="tiny muted">' + C.ago(l.created_at) + '</span></div>';
          }).join('') : '<div class="empty small">None yet.</div>') + '</div>';
        var reload = function () { userPage(view, ctx); };
        var rf = $('[data-role]', view);
        if (rf) C.bindForm(rf, function (f) { return C.api('/admin/users/' + u.id + '/role', { method: 'PATCH', body: { role: f.role } }).then(function () { C.toast('Role updated.', 'ok'); reload(); }); });
        var lf = $('[data-limit]', view);
        if (lf) C.bindForm(lf, function (f) { return C.api('/admin/users/' + u.id + '/limit', { method: 'PATCH', body: { daily_limit: f.daily_limit === '' ? null : Number(f.daily_limit) } }).then(function () { C.toast('Limit saved.', 'ok'); reload(); }); });
        var on = function (sel, fn) { var b = $(sel, view); if (b) b.addEventListener('click', fn); };
        on('[data-suspend]', function () {
          C.prompt({ title: 'Suspend ' + (u.name || u.email) + '? They are signed out everywhere and can’t sign in until unsuspended.', label: 'Reason (optional, kept in the audit log)', value: '', confirm: 'Suspend', required: false, max: 500 }).then(function (reason) {
            if (reason === null) return;
            act(C.api('/admin/users/' + u.id + '/suspend', { method: 'POST', body: { reason: reason } }), function () { C.toast('Account suspended.', 'ok'); reload(); });
          });
        });
        on('[data-unsuspend]', function () { act(C.api('/admin/users/' + u.id + '/unsuspend', { method: 'POST' }), function () { C.toast('Account unsuspended.', 'ok'); reload(); }); });
        on('[data-unlock]', function () { act(C.api('/admin/users/' + u.id + '/unlock', { method: 'POST' }), function () { C.toast('Account unlocked.', 'ok'); reload(); }); });
        on('[data-signout]', function () { C.confirm({ title: 'Sign out everywhere?', body: 'Ends every session for this account.', confirm: 'Sign out' }).then(function (ok) { if (ok) act(C.api('/admin/users/' + u.id + '/signout', { method: 'POST' }), function () { C.toast('Signed out everywhere.', 'ok'); reload(); }); }); });
        $$('[data-revoke]', view).forEach(function (b) { b.addEventListener('click', function () { b.disabled = true; act(C.api('/admin/users/' + u.id + '/sessions/' + b.getAttribute('data-revoke'), { method: 'DELETE' }), function () { C.toast('Session revoked.'); reload(); }).catch(function () { b.disabled = false; }); }); });
      }).catch(function (e) { fail(view, e); });
    });
  }

  /* ================= Moderation ================= */
  function moderation(view) {
    gate(view, function () {
      var status = 'open', kind = '';
      view.innerHTML = head('Moderation', 'Bad feedback on replies and reports on shared chats.') +
        chips([['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['all', 'All']], 'open', 'data-s') +
        '<div style="margin-top:8px">' + chips([['', 'Everything'], ['feedback', 'Bad feedback'], ['share', 'Shared-link reports']], '', 'data-k') + '</div><div class="list" id="ml" style="margin-top:12px"></div>';
      function load() {
        $('#ml', view).innerHTML = skel(3);
        C.api('/admin/moderation?status=' + status + '&kind=' + kind).then(function (d) {
          if (!d.reports.length) { $('#ml', view).innerHTML = '<div class="empty">' + icon('check') + '<p>Nothing here.</p></div>'; return; }
          $('#ml', view).innerHTML = d.reports.map(function (m) {
            return '<button class="row" data-id="' + m.id + '"><span class="ico" style="color:' + (m.kind === 'share' ? 'var(--bad)' : 'var(--warn)') + '">' + icon(m.kind === 'share' ? 'link' : 'thumbDown') + '</span><span class="body"><div class="title">' + esc(m.reason || 'Reported') + '</div>' +
              '<div class="sub">' + esc(m.title || 'Conversation removed') + (m.comment ? ' · “' + esc(m.comment.slice(0, 80)) + '”' : '') + '</div>' +
              '<div class="adm-badges"><span class="badge">' + (m.kind === 'share' ? 'Shared link' : 'Feedback') + '</span>' + (m.status !== 'open' ? '<span class="badge ' + (m.status === 'resolved' ? 'ok' : '') + '">' + esc(m.status) + '</span>' : '') + (m.kind === 'share' && m.shared ? '<span class="badge warn">Link live</span>' : '') + '</div></span><span class="tiny muted" style="flex:none">' + C.ago(m.created_at) + '</span></button>';
          }).join('');
          $$('[data-id]', view).forEach(function (b) { b.addEventListener('click', function () { report(b.getAttribute('data-id'), load); }); });
        }).catch(function (e) { fail($('#ml', view), e); });
      }
      function pick(attr, fn) { $$('[' + attr + ']', view).forEach(function (b) { b.addEventListener('click', function () { fn(b.getAttribute(attr)); $$('[' + attr + ']', view).forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); load(); }); }); }
      pick('data-s', function (v) { status = v; }); pick('data-k', function (v) { kind = v; });
      load();
    });
  }

  function report(id, reload) {
    C.api('/admin/moderation/' + id).then(function (d) {
      var r = d.report, c = d.conversation;
      C.sheet('<div class="h2">' + esc(r.reason || 'Report') + '</div><p class="small muted">' + (r.kind === 'share' ? 'Report on a shared link' : 'Bad feedback on a reply') + ' · ' + C.ago(r.created_at) + (c ? ' · “' + esc(c.title) + '” (' + esc(c.mode) + ')' : '') + '</p>' +
        (r.comment ? '<div class="card small">' + esc(r.comment) + '</div>' : '') +
        (d.gone ? '<p class="small muted">' + icon('info') + ' The conversation was deleted, so only the report is left.</p>' : d.hidden ? '<p class="small muted">' + icon('lock') + ' This person turned off sharing feedback context, so only the reason is shown.</p>' : '') +
        (d.messages.length ? '<div class="adm-thread">' + d.messages.map(function (m) { return '<div class="adm-msg ' + m.role + '"><div class="tiny muted">' + (m.role === 'user' ? 'User' : 'Colon' + (m.model ? ' · ' + esc(m.model) : '')) + '</div>' + esc(m.content) + '</div>'; }).join('') + '</div>' : '') +
        '<form class="form" novalidate style="margin-top:12px">' + area('note', 'Note (optional, kept with the report)', r.note) +
        (r.status === 'open' ? '<button class="btn primary block" type="submit" data-do="resolve">Resolve</button>' + (r.kind === 'share' && c && c.shared ? '<button class="btn danger block" type="button" data-do="unshare">Resolve and turn off the link</button>' : '') + '<button class="btn block" type="button" data-do="dismiss">Dismiss</button>'
          : '<p class="small muted">Marked ' + esc(r.status) + '.</p><button class="btn block" type="button" data-do="reopen">Reopen</button>') +
        '<button class="btn ghost block" type="button" data-close>Close</button></form>', function (el, close) {
        function go(what) {
          var note = $('textarea', el).value;
          var path = what === 'unshare' ? 'resolve' : what;
          act(C.api('/admin/moderation/' + r.id + '/' + path, { method: 'POST', body: { note: note, unshare: what === 'unshare' } }), function () { C.toast(what === 'dismiss' ? 'Dismissed.' : what === 'reopen' ? 'Reopened.' : 'Resolved.', 'ok'); close(); reload(); });
        }
        $('form', el).addEventListener('submit', function (e) { e.preventDefault(); go('resolve'); });
        $$('[data-do]', el).forEach(function (b) { if (b.type !== 'submit') b.addEventListener('click', function () { go(b.getAttribute('data-do')); }); });
      });
    }).catch(function (e) { C.toast(e.message, 'bad'); });
  }

  /* ================= Models and providers ================= */
  function models(view) {
    gate(view, function () {
      view.innerHTML = head('Models and providers', 'Changes reach every server within about 30 seconds.') + '<div id="pv">' + skel(3) + '</div><div id="md"></div>';
      function load() {
        Promise.all([C.api('/admin/providers'), C.api('/admin/models')]).then(function (res) {
          var p = res[0], m = res[1];
          $('#pv', view).innerHTML = '<div class="adm-sec"><div class="section-title">Providers</div><button class="btn sm" data-addp>' + icon('plus') + 'Add</button></div><div class="list">' + p.providers.map(function (x) {
            return '<button class="row" data-p="' + esc(x.id) + '"><span class="ico">' + (x.live ? '<span class="status-dot"></span>' : '<span class="status-dot ' + (x.enabled ? 'warn' : 'bad') + '"></span>') + '</span><span class="body"><div class="title">' + esc(x.name) + ' <span class="tiny muted">' + esc(x.id) + '</span></div>' +
              '<div class="sub">' + esc(x.base_url || 'No base URL') + '</div><div class="adm-badges">' + (x.live ? '<span class="badge ok">Live</span>' : x.enabled ? '<span class="badge warn">Not ready</span>' : '<span class="badge bad">Off</span>') +
              '<span class="badge">' + (x.key.source === 'database' ? 'Key ' + esc(x.key.masked) : x.key.source === 'environment' ? 'Key from server env' : 'No key') + '</span>' + (x.builtin ? '' : '<span class="badge cyan">Custom</span>') + '</div></span><span class="chev">' + icon('chev') + '</span></button>';
          }).join('') + '</div>';
          var groups = {};
          m.models.forEach(function (x) { (groups[x.target] = groups[x.target] || []).push(x); });
          $('#md', view).innerHTML = '<div class="adm-sec"><div class="section-title">Models by slot</div><button class="btn sm" data-addm>' + icon('plus') + 'Add</button></div>' +
            (m.source === 'default' ? '<div class="banner info">' + icon('info') + '<span>These are the built-in models from the server. Your first change copies them to the database.</span><button class="btn sm" data-seed>Copy now</button></div>' : '') +
            Object.keys(groups).map(function (t) {
              return '<div class="card adm-slot"><div class="adm-slot-h"><b>' + esc(t) + '</b><span class="tiny muted">tried top to bottom</span></div>' + groups[t].map(function (x) {
                return '<button class="adm-model" data-m="' + (x.id || '') + '"' + (x.id ? '' : ' disabled') + '><span class="status-dot' + (x.enabled ? '' : ' bad') + '"></span><span class="body"><b>' + esc(x.model) + '</b><span class="tiny muted"> · ' + esc(x.provider_id) + (x.vision ? ' · images' : '') + (x.enabled ? '' : ' · off') + '</span></span>' + (x.id ? icon('edit') : '') + '</button>';
              }).join('') + '</div>';
            }).join('');
          $$('[data-p]', view).forEach(function (b) { b.addEventListener('click', function () { providerSheet(p.providers.filter(function (x) { return x.id === b.getAttribute('data-p'); })[0], p.can_edit_keys, load); }); });
          $('[data-addp]', view).addEventListener('click', function () { providerSheet(null, p.can_edit_keys, load); });
          $('[data-addm]', view).addEventListener('click', function () { modelSheet(null, m.providers, load); });
          $$('[data-m]', view).forEach(function (b) { if (b.getAttribute('data-m')) b.addEventListener('click', function () { modelSheet(m.models.filter(function (x) { return String(x.id) === b.getAttribute('data-m'); })[0], m.providers, load); }); });
          var seed = $('[data-seed]', view);
          if (seed) seed.addEventListener('click', function () { seed.disabled = true; act(C.api('/admin/models/seed', { method: 'POST' }), function () { C.toast('Models copied to the database.', 'ok'); load(); }).catch(function () { seed.disabled = false; }); });
        }).catch(function (e) { fail($('#pv', view), e); });
      }
      load();
    });
  }

  function providerSheet(p, canKeys, reload) {
    var isNew = !p;
    C.sheet('<div class="h2">' + (isNew ? 'Add provider' : esc(p.name)) + '</div>' + (isNew ? '<p class="small muted">Any OpenAI-compatible API (or the native Gemini API).</p>' : '<p class="small muted">' + esc(p.id) + (p.builtin ? ' · built in' : ' · custom') + '</p>') +
      '<form class="form" data-pf novalidate>' + (isNew ? C.field({ name: 'id', label: 'Id (short, lowercase)', placeholder: 'e.g. together' }) : '') +
      C.field({ name: 'name', label: 'Name', value: isNew ? '' : p.name }) + C.field({ name: 'base_url', label: 'Base URL', value: isNew ? '' : p.base_url, placeholder: 'https://…/v1', required: false }) +
      sel('native', 'API type', isNew ? '' : p.native, [['', 'OpenAI-compatible'], ['gemini', 'Native Gemini API']]) +
      (isNew ? '' : '<div class="list">' + sw('enabled', 'Enabled', 'Off removes it from every route', p.enabled) + '</div>') +
      '<button class="btn primary block" type="submit">' + (isNew ? 'Add provider' : 'Save') + '</button></form>' +
      (isNew ? '' : '<div class="section-title">API key</div>' + (canKeys
        ? '<form class="form" data-kf novalidate><p class="small muted">Current: ' + (p.key.source === 'database' ? esc(p.key.masked) + ' (stored encrypted)' : p.key.source === 'environment' ? 'from the server environment' : 'none') + '. A stored key wins over the environment one. It is never shown again.</p>' +
          C.field({ name: 'api_key', label: 'New API key', type: 'password', auto: 'off' }) + '<button class="btn primary block" type="submit">Save key</button>' + (p.key.source === 'database' ? '<button class="btn danger block" type="button" data-clear>Remove stored key</button>' : '') + '</form>'
        : '<p class="small muted">' + icon('lock') + ' Only a Super Admin can view or change API keys.</p>') +
        (p.in_db ? '<button class="btn ghost block" type="button" data-reset style="margin-top:8px">' + (p.builtin ? 'Reset to server defaults' : 'Delete provider') + '</button>' : '')) +
      '<button class="btn ghost block" type="button" data-close>Close</button>', function (el, close) {
      C.bindForm($('[data-pf]', el), function (f) {
        var req = isNew ? C.api('/admin/providers', { method: 'POST', body: { id: f.id, name: f.name, base_url: f.base_url, native: f.native } })
          : C.api('/admin/providers/' + p.id, { method: 'PATCH', body: { name: f.name, base_url: f.base_url, native: f.native, enabled: f.enabled } });
        return req.then(function () { C.toast('Saved.', 'ok'); close(); reload(); });
      });
      var kf = $('[data-kf]', el);
      if (kf) C.bindForm(kf, function (f) { return C.api('/admin/providers/' + p.id + '/key', { method: 'POST', body: { api_key: f.api_key } }).then(function () { C.toast('Key saved (encrypted).', 'ok'); close(); reload(); }); });
      var cl = $('[data-clear]', el);
      if (cl) cl.addEventListener('click', function () { C.confirm({ title: 'Remove the stored key?', body: 'The provider falls back to the key in the server environment, if there is one.', confirm: 'Remove', danger: true }).then(function (ok) { if (ok) act(C.api('/admin/providers/' + p.id + '/key', { method: 'POST', body: { api_key: '' } }), function () { C.toast('Key removed.'); close(); reload(); }); }); });
      var rs = $('[data-reset]', el);
      if (rs) rs.addEventListener('click', function () { C.confirm({ title: p.builtin ? 'Reset ' + p.name + '?' : 'Delete ' + p.name + '?', body: p.builtin ? 'Name, URL, on/off and any stored key go back to the server settings.' : 'Models using it stop working until you move them.', confirm: p.builtin ? 'Reset' : 'Delete', danger: true }).then(function (ok) { if (ok) act(C.api('/admin/providers/' + p.id, { method: 'DELETE' }), function () { C.toast('Done.'); close(); reload(); }); }); });
    });
  }

  function modelSheet(m, providers, reload) {
    var isNew = !m;
    C.sheet('<div class="h2">' + (isNew ? 'Add model' : esc(m.model)) + '</div><p class="small muted">A slot (like “qwen” or “deepseek”) groups models tried in order. Routing picks slots per mode.</p>' +
      '<form class="form" novalidate>' + C.field({ name: 'target', label: 'Slot', value: isNew ? '' : m.target, placeholder: 'e.g. qwen' }) +
      sel('provider_id', 'Provider', isNew ? providers[0] : m.provider_id, providers.map(function (p) { return [p, p]; })) +
      C.field({ name: 'model', label: 'Model id (as the provider names it)', value: isNew ? '' : m.model }) +
      C.field({ name: 'priority', label: 'Order in slot (0 = first)', type: 'number', value: isNew ? 0 : m.priority }) +
      area('body', 'Extra request options (JSON, optional)', isNew || !m.body ? '' : (typeof m.body === 'string' ? m.body : JSON.stringify(m.body)), '{"chat_template_kwargs":{"thinking":false}}') +
      '<div class="list">' + sw('vision', 'Reads images', '', !isNew && m.vision) + sw('enabled', 'Enabled', '', isNew || m.enabled) + '</div>' +
      '<button class="btn primary block" type="submit">' + (isNew ? 'Add model' : 'Save') + '</button>' + (isNew ? '' : '<button class="btn danger block" type="button" data-del>Delete</button>') +
      '<button class="btn ghost block" type="button" data-close>Close</button></form>', function (el, close) {
      C.bindForm($('form', el), function (f) {
        var body = { target: f.target, provider_id: f.provider_id, model: f.model, priority: Number(f.priority || 0), body: f.body, vision: f.vision, enabled: f.enabled };
        return C.api(isNew ? '/admin/models' : '/admin/models/' + m.id, { method: isNew ? 'POST' : 'PATCH', body: body }).then(function () { C.toast('Saved.', 'ok'); close(); reload(); });
      });
      var del = $('[data-del]', el);
      if (del) del.addEventListener('click', function () { C.confirm({ title: 'Delete ' + m.model + '?', confirm: 'Delete', danger: true }).then(function (ok) { if (ok) act(C.api('/admin/models/' + m.id, { method: 'DELETE' }), function () { C.toast('Deleted.'); close(); reload(); }); }); });
    });
  }

  /* ================= Routing ================= */
  function routing(view) {
    gate(view, function () {
      view.innerHTML = head('Routing', 'The order of model slots per mode. The first one that answers wins; the rest are fallbacks.') + '<div id="rt">' + skel(4) + '</div>';
      C.api('/admin/routing').then(function (d) {
        var routes = JSON.parse(JSON.stringify(d.routes)), hedge = d.hedge, slots = Object.keys(d.targets);
        var order = ['general', 'study', 'developer', 'research', 'african'];
        function slotInfo(n) { var t = d.targets[n] || []; return t.length ? t.map(function (x) { return (x.live ? '' : '⚠ ') + x.model; }).join(', ') : 'no models'; }
        function draw() {
          $('#rt', view).innerHTML = '<p class="tiny muted">Source: ' + esc(d.source) + ' · changes reach every server within ' + d.cache_seconds + ' s.</p>' +
            order.map(function (mode) {
              var list = routes[mode] || [];
              return '<div class="card adm-route"><div class="adm-slot-h"><b>' + esc(d.labels[mode] || mode) + '</b></div>' + list.map(function (n, i) {
                return '<div class="adm-rrow"><span class="adm-n">' + (i + 1) + '</span><span class="body"><b>' + esc(n) + '</b><div class="tiny muted">' + esc(slotInfo(n)) + '</div></span>' +
                  '<button class="icon-btn sm" data-up="' + mode + ':' + i + '" aria-label="Move up"' + (i ? '' : ' disabled') + '>' + icon('chevDown', 'flip') + '</button>' +
                  '<button class="icon-btn sm" data-down="' + mode + ':' + i + '" aria-label="Move down"' + (i < list.length - 1 ? '' : ' disabled') + '>' + icon('chevDown') + '</button>' +
                  '<button class="icon-btn sm" data-rm="' + mode + ':' + i + '" aria-label="Remove"' + (list.length > 1 ? '' : ' disabled') + '>' + icon('x') + '</button></div>';
              }).join('') +
                (slots.filter(function (s) { return list.indexOf(s) < 0; }).length ? '<select class="select adm-add" data-add="' + mode + '" aria-label="Add a fallback"><option value="">+ Add fallback…</option>' + slots.filter(function (s) { return list.indexOf(s) < 0; }).map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') + '</select>' : '') + '</div>';
            }).join('') +
            '<div class="card"><div class="adm-slot-h"><b>Models asked at once (hedge)</b></div><p class="small muted">Saga asks this many models together and streams the first to answer. 1 = one after another.</p><div class="seg block">' +
            [1, 2, 3, 4].map(function (n) { return '<button type="button" data-h="' + n + '" aria-pressed="' + (n === hedge) + '">' + n + '</button>'; }).join('') + '</div></div>' +
            '<button class="btn primary block" data-save>Save routing</button>' + (d.saved ? '<button class="btn ghost block" data-reset>Reset to server defaults</button>' : '');
          function at(attr, fn) { $$('[' + attr + ']', view).forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute(attr).split(':'); fn(routes[p[0]], Number(p[1])); draw(); }); }); }
          at('data-up', function (l, i) { l.splice(i - 1, 0, l.splice(i, 1)[0]); });
          at('data-down', function (l, i) { l.splice(i + 1, 0, l.splice(i, 1)[0]); });
          at('data-rm', function (l, i) { l.splice(i, 1); });
          $$('[data-add]', view).forEach(function (s) { s.addEventListener('change', function () { if (s.value) { routes[s.getAttribute('data-add')].push(s.value); draw(); } }); });
          $$('[data-h]', view).forEach(function (b) { b.addEventListener('click', function () { hedge = Number(b.getAttribute('data-h')); draw(); }); });
          $('[data-save]', view).addEventListener('click', function (e) {
            var b = e.currentTarget; b.disabled = true;
            act(C.api('/admin/routing', { method: 'PATCH', body: { routes: routes, hedge: hedge } }), function () { C.toast('Routing saved. Live within 30 s.', 'ok'); routing(view); }).catch(function () { b.disabled = false; });
          });
          var rs = $('[data-reset]', view);
          if (rs) rs.addEventListener('click', function () { C.confirm({ title: 'Reset routing?', body: 'Every mode goes back to the order built into the server.', confirm: 'Reset' }).then(function (ok) { if (ok) act(C.api('/admin/routing', { method: 'DELETE' }), function () { C.toast('Routing reset.'); routing(view); }); }); });
        }
        draw();
      }).catch(function (e) { fail($('#rt', view), e); });
    });
  }

  /* ================= Usage and limits ================= */
  function limitsPage(view) {
    gate(view, function () {
      view.innerHTML = head('Usage and limits', 'Daily reply limits, live on every server within 30 s. Days reset at midnight UTC.') + '<div id="lm">' + skel(4) + '</div>';
      C.api('/admin/limits').then(function (d) {
        var L = d.limits, t = d.today;
        var tStat = function (k, l) { var x = t[k] || { subjects: 0, requests: 0 }; return '<div class="stat"><b>' + num(x.requests) + '</b><span>' + l + ' · ' + num(x.subjects) + ' active</span></div>'; };
        $('#lm', view).innerHTML = '<div class="section-title">Today</div><div class="grid cols-4">' + tStat('users', 'Member replies') + tStat('guests', 'Guest replies') + '</div>' +
          '<form class="card form" novalidate style="margin-top:14px"><div class="h3">Daily limits</div>' +
          C.field({ name: 'user', label: 'Members (replies per day, default ' + d.defaults.user + ')', type: 'number', value: L.user }) +
          C.field({ name: 'guest', label: 'Guests per browser (default ' + d.defaults.guest + ')', type: 'number', value: L.guest }) +
          C.field({ name: 'guestIp', label: 'All guests on one network/IP (default ' + d.defaults.guestIp + ')', type: 'number', value: L.guestIp }) +
          '<div class="h3" style="margin-top:8px">Per mode (optional)</div><p class="small muted">Extra cap per person per mode. Empty = no cap. Staff are exempt.</p>' +
          Object.keys(MODE_LABELS).map(function (m) { return opt('mode_' + m, MODE_LABELS[m], L.modes[m], 'No cap', 'number'); }).join('') +
          '<button class="btn primary block" type="submit">Save limits</button></form>' +
          '<div class="section-title">Per-user overrides</div><div class="list">' + (d.overrides.length ? d.overrides.map(function (o) {
            return C.row('#/users/' + o.user_id, 'user', (o.name || o.email) + ' · ' + num(o.daily_limit) + '/day', o.email);
          }).join('') : '<div class="empty small">None. Set one from a user’s page.</div>') + '</div>';
        C.bindForm($('form', view), function (f) {
          var modes = {}; Object.keys(MODE_LABELS).forEach(function (m) { modes[m] = f['mode_' + m] === '' ? null : Number(f['mode_' + m]); });
          return C.api('/admin/limits', { method: 'PATCH', body: { user: Number(f.user), guest: Number(f.guest), guestIp: Number(f.guestIp), modes: modes } }).then(function () { C.toast('Limits saved.', 'ok'); });
        });
      }).catch(function (e) { fail($('#lm', view), e); });
    });
  }

  /* ================= Evaluation ================= */
  function evaluation(view) {
    gate(view, function () {
      view.innerHTML = head('Evaluation', 'Benchmark runs (full Colon benchmark arrives in Phase 5) and what people think of each model.', '<button class="btn sm" data-add>' + icon('plus') + 'Add run</button>') + '<div id="ev">' + skel(3) + '</div>';
      function load() {
        C.api('/admin/evaluation').then(function (d) {
          $('#ev', view).innerHTML = '<div class="section-title">Benchmark runs</div><div class="list">' + (d.runs.length ? d.runs.map(function (r) {
            return '<div class="row"><span class="ico">' + icon('target') + '</span><span class="body"><div class="title">' + esc(r.name) + (r.score != null ? ' · <b>' + r.score + '</b>' : '') + '</div><div class="sub">' + esc(r.model || 'any model') + ' · ' + esc(r.status) + ' · ' + C.ago(r.created_at) + (r.notes ? ' · ' + esc(r.notes) : '') + '</div></span><button class="icon-btn sm" data-del="' + r.id + '" aria-label="Delete run">' + icon('trash') + '</button></div>';
          }).join('') : '<div class="empty small">No runs yet. Log one with “Add run”.</div>') + '</div>' +
            '<div class="section-title">Feedback per model (30 days)</div>' + (d.feedback.length ? '<div class="card adm-table-wrap"><table class="adm-table"><thead><tr><th>Model</th><th>👍</th><th>👎</th><th>Positive</th></tr></thead><tbody>' + d.feedback.map(function (f) {
              var tot = f.up + f.down, pct = tot ? Math.round(f.up / tot * 100) : 0;
              return '<tr><td><b>' + esc(f.model || 'unknown') + '</b><div class="tiny muted">' + esc(f.provider || '—') + '</div></td><td>' + f.up + '</td><td>' + f.down + '</td><td><div class="progress"><i style="width:' + pct + '%"></i></div><span class="tiny">' + pct + '%</span></td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="empty small">No feedback yet.</div>') +
            (d.reasons.length ? '<div class="section-title">Why replies were rated bad</div><div class="chips">' + d.reasons.map(function (x) { return '<span class="badge">' + esc(x.reason) + ' · ' + x.n + '</span>'; }).join('') + '</div>' : '');
          $$('[data-del]', view).forEach(function (b) { b.addEventListener('click', function () { C.confirm({ title: 'Delete this run?', confirm: 'Delete', danger: true }).then(function (ok) { if (ok) act(C.api('/admin/evaluation/runs/' + b.getAttribute('data-del'), { method: 'DELETE' }), load); }); }); });
        }).catch(function (e) { fail($('#ev', view), e); });
      }
      $('[data-add]', view).addEventListener('click', function () {
        C.sheet('<div class="h2">Log a benchmark run</div><form class="form" novalidate>' + C.field({ name: 'name', label: 'Name', placeholder: 'e.g. WAEC maths set v1' }) + opt('model', 'Model', '', 'e.g. gemma-4-26b-a4b-it') +
          sel('status', 'Status', 'planned', [['planned', 'Planned'], ['running', 'Running'], ['done', 'Done'], ['failed', 'Failed']]) + opt('score', 'Score (0–100)', '', '', 'number') + area('notes', 'Notes') +
          '<button class="btn primary block" type="submit">Save</button><button class="btn ghost block" type="button" data-close>Cancel</button></form>', function (el, close) {
          C.bindForm($('form', el), function (f) { return C.api('/admin/evaluation/runs', { method: 'POST', body: f }).then(function () { close(); load(); }); });
        });
      });
      load();
    });
  }

  /* ================= African AI registry ================= */
  var REG_STATUS = [['candidate', 'Candidate'], ['approved', 'Approved'], ['in_use', 'In use'], ['rejected', 'Rejected']];
  function registry(view) {
    gate(view, function () {
      var kind = '';
      view.innerHTML = head('African AI registry', 'Language models and datasets, with their licences.', '<button class="btn sm" data-add>' + icon('plus') + 'Add</button>') +
        chips([['', 'All'], ['model', 'Models'], ['dataset', 'Datasets']], '', 'data-k') + '<div class="list" id="rg" style="margin-top:12px"></div>';
      function load() {
        $('#rg', view).innerHTML = skel(3);
        C.api('/admin/registry?kind=' + kind).then(function (d) {
          $('#rg', view).innerHTML = d.entries.length ? d.entries.map(function (x) {
            return '<button class="row" data-id="' + x.id + '"><span class="ico">' + icon(x.kind === 'model' ? 'bot' : 'database') + '</span><span class="body"><div class="title">' + esc(x.name) + '</div><div class="sub">' + esc(x.languages || 'languages not set') + ' · ' + esc(x.licence || 'licence unknown') + '</div>' +
              '<div class="adm-badges"><span class="badge">' + esc(x.kind) + '</span><span class="badge ' + (x.status === 'in_use' || x.status === 'approved' ? 'ok' : x.status === 'rejected' ? 'bad' : '') + '">' + esc((REG_STATUS.filter(function (s) { return s[0] === x.status; })[0] || [0, x.status])[1]) + '</span><span class="badge ' + (x.commercial === 'yes' ? 'ok' : x.commercial === 'no' ? 'warn' : '') + '">Commercial use: ' + esc(x.commercial) + '</span></div></span><span class="chev">' + icon('chev') + '</span></button>';
          }).join('') : '<div class="empty">Nothing yet. Add N-ATLaS, NaijaVox and other African models and datasets here.</div>';
          $$('[data-id]', view).forEach(function (b) { b.addEventListener('click', function () { entry(d.entries.filter(function (x) { return String(x.id) === b.getAttribute('data-id'); })[0]); }); });
        }).catch(function (e) { fail($('#rg', view), e); });
      }
      function entry(x) {
        var isNew = !x; x = x || { kind: 'model', commercial: 'unknown', status: 'candidate' };
        C.sheet('<div class="h2">' + (isNew ? 'Add to registry' : esc(x.name)) + '</div><form class="form" novalidate>' +
          sel('kind', 'Type', x.kind, [['model', 'Language model'], ['dataset', 'Dataset']]) + C.field({ name: 'name', label: 'Name', value: x.name || '' }) +
          opt('languages', 'Languages', x.languages, 'e.g. Yorùbá, Hausa, Igbo, Naijá') + opt('licence', 'Licence', x.licence, 'e.g. Apache-2.0, CC BY 4.0') +
          opt('licence_url', 'Licence link', x.licence_url, 'https://…', 'url') + opt('source_url', 'Source link', x.source_url, 'https://…', 'url') +
          sel('commercial', 'Commercial use allowed?', x.commercial, [['unknown', 'Unknown'], ['yes', 'Yes'], ['no', 'No']]) + sel('status', 'Status', x.status, REG_STATUS) + area('notes', 'Notes', x.notes) +
          '<button class="btn primary block" type="submit">Save</button>' + (isNew ? '' : '<button class="btn danger block" type="button" data-del>Delete</button>') + '<button class="btn ghost block" type="button" data-close>Close</button></form>', function (el, close) {
          C.bindForm($('form', el), function (f) { return C.api(isNew ? '/admin/registry' : '/admin/registry/' + x.id, { method: isNew ? 'POST' : 'PATCH', body: f }).then(function () { C.toast('Saved.', 'ok'); close(); load(); }); });
          var del = $('[data-del]', el);
          if (del) del.addEventListener('click', function () { C.confirm({ title: 'Delete ' + x.name + '?', confirm: 'Delete', danger: true }).then(function (ok) { if (ok) act(C.api('/admin/registry/' + x.id, { method: 'DELETE' }), function () { close(); load(); }); }); });
        });
      }
      $$('[data-k]', view).forEach(function (b) { b.addEventListener('click', function () { kind = b.getAttribute('data-k'); $$('[data-k]', view).forEach(function (y) { y.classList.toggle('on', y === b); y.setAttribute('aria-pressed', y === b); }); load(); }); });
      $('[data-add]', view).addEventListener('click', function () { entry(null); });
      load();
    });
  }

  /* ================= Voice ================= */
  function voice(view) {
    gate(view, function () {
      view.innerHTML = head('Voice', 'Speech-to-text and text-to-speech engines. Saved now, used by Voice (Phase 6).') + '<div id="vc">' + skel(3) + '</div>';
      C.api('/admin/voice').then(function (d) {
        var V = d.voice, E = d.engines;
        var part = function (k, title) {
          var x = V[k];
          return '<div class="card form"><div class="h3">' + title + '</div><div class="list">' + sw(k + '_enabled', 'Enabled', '', x.enabled) + '</div>' +
            sel(k + '_engine', 'Engine', x.engine, E[k].map(function (e) { return [e, e]; })) +
            (k === 'stt' ? opt('stt_model', 'Model', x.model, 'e.g. whisper-large-v3') : opt('tts_voice', 'Voice', x.voice, 'e.g. ng-female-1')) +
            opt(k + '_endpoint', 'Endpoint (optional)', x.endpoint, 'https://…', 'url') + opt(k + '_languages', 'Languages', x.languages) + '</div>';
        };
        $('#vc', view).innerHTML = '<form novalidate class="adm-stack">' + part('stt', 'Speech to text (STT)') + part('tts', 'Text to speech (TTS)') + '<button class="btn primary block" type="submit">Save voice settings</button></form>';
        C.bindForm($('form', view), function (f) {
          return C.api('/admin/voice', { method: 'PATCH', body: {
            stt: { enabled: f.stt_enabled, engine: f.stt_engine, model: f.stt_model, endpoint: f.stt_endpoint, languages: f.stt_languages },
            tts: { enabled: f.tts_enabled, engine: f.tts_engine, voice: f.tts_voice, endpoint: f.tts_endpoint, languages: f.tts_languages } } }).then(function () { C.toast('Voice settings saved.', 'ok'); });
        });
      }).catch(function (e) { fail($('#vc', view), e); });
    });
  }

  /* ================= Browser (placeholder) ================= */
  function browser(view) {
    gate(view, function () {
      view.innerHTML = head('Browser', 'Colon Browser sessions.') +
        '<div class="card empty">' + icon('compass') + '<div class="h3" style="color:var(--text)">Live sessions are coming</div><p class="small">Watching live browser sessions, failures and a kill switch arrive with the Android browser engine (Phases 8–10). Nothing to manage yet.</p></div>';
    });
  }

  /* ================= System settings (Super Admin) ================= */
  function system(view) {
    gate(view, function () {
      view.innerHTML = head('System settings', 'Branding, feature flags, maintenance mode and the announcement banner. Live within 30 s.') + '<div id="sy">' + skel(4) + '</div>';
      C.api('/admin/system').then(function (d) {
        var S = d.system;
        $('#sy', view).innerHTML = '<form novalidate class="adm-stack">' +
          '<div class="card form"><div class="h3">Branding</div>' + C.field({ name: 'brandName', label: 'Product name', value: S.brandName }) + '</div>' +
          '<div class="card"><div class="h3">Feature flags</div><div class="list">' + Object.keys(d.features).map(function (k) { return sw('f_' + k, d.features[k], '', S.features[k] !== false); }).join('') + '</div><p class="tiny muted">Staff are never blocked by a flag.</p></div>' +
          '<div class="card form"><div class="h3">Maintenance mode</div><div class="list">' + sw('m_on', 'Maintenance on', 'New chat messages get this message instead of a reply. Staff can still chat.', S.maintenance.on) + '</div>' + area('m_message', 'Message', S.maintenance.message) + '</div>' +
          '<div class="card form"><div class="h3">Announcement banner</div><div class="list">' + sw('a_on', 'Show banner in Colon AI', '', S.announcement.on) + '</div>' + area('a_text', 'Text', S.announcement.text, 'e.g. New: Study mode now explains step by step.') +
          sel('a_tone', 'Style', S.announcement.tone, [['info', 'Info'], ['warn', 'Warning']]) + '</div>' +
          '<button class="btn primary block" type="submit">Save system settings</button></form>';
        C.bindForm($('form', view), function (f) {
          var features = {}; Object.keys(d.features).forEach(function (k) { features[k] = f['f_' + k]; });
          return C.api('/admin/system', { method: 'PATCH', body: { brandName: f.brandName, features: features, maintenance: { on: f.m_on, message: f.m_message }, announcement: { on: f.a_on, text: f.a_text, tone: f.a_tone } } })
            .then(function () { C.toast('Saved. Live within 30 seconds.', 'ok'); });
        });
      }).catch(function (e) { fail($('#sy', view), e); });
    });
  }

  /* ================= Security ================= */
  var LABELS = { 'auth.login': 'Signed in', 'auth.login_google': 'Signed in with Google', 'auth.login_failed': 'Failed sign-in', 'auth.totp_failed': 'Wrong 2FA code', 'auth.logout': 'Signed out',
    'auth.login_blocked_suspended': 'Sign-in blocked (suspended)', 'user.register': 'Created account', 'user.register_google': 'Created account (Google)', 'user.email_verified': 'Confirmed email', 'auth.reset_requested': 'Asked for password reset', 'auth.password_reset': 'Reset password',
    'account.profile_updated': 'Updated profile', 'account.password_changed': 'Changed password', 'account.session_revoked': 'Signed out a device', 'account.sessions_revoked_all': 'Signed out other devices',
    'account.2fa_enabled': 'Turned on 2FA', 'account.2fa_disabled': 'Turned off 2FA', 'account.deleted': 'Deleted account', 'admin.users_viewed': 'Viewed users', 'admin.user_viewed': 'Viewed a user', 'admin.role_changed': 'Changed a role',
    'admin.user_unlocked': 'Unlocked a user', 'admin.user_signed_out': 'Signed a user out', 'admin.session_revoked': 'Revoked a session', 'admin.user_suspended': 'Suspended a user', 'admin.user_unsuspended': 'Unsuspended a user', 'admin.user_limit_set': 'Set a user limit',
    'admin.provider_created': 'Added a provider', 'admin.provider_updated': 'Changed a provider', 'admin.provider_key_set': 'Set a provider key', 'admin.provider_key_cleared': 'Removed a provider key', 'admin.provider_deleted': 'Reset a provider',
    'admin.models_seeded': 'Copied models to the database', 'admin.model_created': 'Added a model', 'admin.model_updated': 'Changed a model', 'admin.model_deleted': 'Deleted a model', 'admin.routing_updated': 'Changed routing', 'admin.routing_reset': 'Reset routing',
    'admin.limits_updated': 'Changed limits', 'admin.eval_run_created': 'Logged a benchmark run', 'admin.eval_run_deleted': 'Deleted a benchmark run', 'admin.registry_created': 'Added to the registry', 'admin.registry_updated': 'Changed a registry entry', 'admin.registry_deleted': 'Deleted a registry entry',
    'admin.voice_updated': 'Changed voice settings', 'admin.system_updated': 'Changed system settings', 'admin.report_viewed': 'Viewed a report', 'admin.report_resolved': 'Resolved a report', 'admin.report_dismissed': 'Dismissed a report', 'admin.report_reopened': 'Reopened a report',
    'chat.shared': 'Shared a chat', 'chat.share_reported': 'Reported a shared chat', 'chat.deleted_all': 'Deleted all chats' };

  function security(view, ctx) {
    gate(view, function () {
      var tab = (ctx && ctx.query && ctx.query.get('tab')) || 'staff';
      view.innerHTML = head('Security', 'Staff two-factor, sign-in events and the audit trail.') +
        '<div class="seg block" role="tablist">' + [['staff', 'Staff & 2FA'], ['logins', 'Sign-ins'], ['audit', 'Audit trail']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" aria-pressed="' + (t[0] === tab) + '">' + t[1] + '</button>'; }).join('') + '</div><div id="sc" style="margin-top:14px"></div>';
      $$('[data-t]', view).forEach(function (b) { b.addEventListener('click', function () { C.go('/security?tab=' + b.getAttribute('data-t'), true); }); });
      var box = $('#sc', view);
      if (tab === 'staff') {
        box.innerHTML = skel(3);
        C.api('/admin/security').then(function (d) {
          var c = d.last_24h, st = function (v, l) { return '<div class="stat"><b>' + num(v) + '</b><span>' + l + '</span></div>'; };
          box.innerHTML = '<div class="grid cols-4">' + st(c.logins, 'Sign-ins 24 h') + st(c.failed, 'Failed passwords') + st(c.totp_failed, 'Wrong 2FA codes') + st(c.locked_now, 'Locked now') + '</div>' +
            '<div class="section-title">Staff (' + d.staff.length + ')</div><div class="list">' + d.staff.map(function (s) {
              return C.row('#/users/' + s.id, s.totp_enabled ? 'shield' : 'alert', (s.name || s.email) + ' · ' + C.roleName(s.role), (s.totp_enabled ? '2FA on' : '2FA OFF: blocked from admin tools') + ' · last sign-in ' + (s.last_login ? C.ago(s.last_login) : 'never') + (s.suspended ? ' · suspended' : ''));
            }).join('') + '</div>';
        }).catch(function (e) { fail(box, e); });
        return;
      }
      box.innerHTML = '<div class="list" id="al"></div><button class="btn block" style="margin-top:12px;display:none" id="more">Load more</button>';
      var last = 0;
      function load() {
        C.api('/admin/audit?scope=' + (tab === 'logins' ? 'logins' : '') + (last ? '&before=' + last : '')).then(function (d) {
          var html = d.entries.map(function (a) {
            var meta = parseMeta(a.meta), extra = meta && meta.to ? ' (' + C.roleName(meta.from) + ' → ' + C.roleName(meta.to) + ')' : '';
            var bad = /failed|blocked|suspended$/.test(a.action);
            return '<div class="row"><span class="ico" style="' + (bad ? 'color:var(--warn)' : '') + '">' + icon(bad ? 'alert' : /admin\./.test(a.action) ? 'shield' : 'user') + '</span><span class="body"><div class="title">' + esc(LABELS[a.action] || a.action) + esc(extra) + '</div>' +
              '<div class="sub">' + esc(a.actor_email || (a.target_email ? '' : 'Unknown')) + (a.target_email ? (a.actor_email ? ' → ' : '') + esc(a.target_email) : a.target_type ? ' · ' + esc(a.target_type) + ' ' + esc(a.target_id) : '') + ' · ' + esc(a.ip) + '</div></span><span class="tiny muted" style="flex:none">' + C.ago(a.created_at) + '</span></div>';
          }).join('');
          $('#al', view).insertAdjacentHTML('beforeend', html || (last ? '' : '<div class="empty">Nothing logged yet.</div>'));
          if (d.entries.length) last = d.entries[d.entries.length - 1].id;
          $('#more', view).style.display = d.entries.length === 50 ? '' : 'none';
        }).catch(function (e) { fail($('#al', view), e); });
      }
      $('#more', view).addEventListener('click', load);
      load();
    });
  }

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
    ['/system', 'settings', 'System settings', 'Branding, flags, maintenance, banner', 'super_admin'],
    ['/security', 'shield', 'Security', 'Staff 2FA, sign-ins, audit trail', 'admin'],
    ['/account', 'user', 'Your account', 'Profile, password, two-factor', 'user']
  ];
  function more(view) {
    gate(view, function () {
      view.innerHTML = head('Admin', C.roleName(C.user.role) + ' · everything you can manage') + '<div class="list">' +
        SECTIONS.filter(function (s) { return C.hasRole(s[4]); }).map(function (s) { return C.row('#' + s[0], s[1], s[2], s[3]); }).join('') + '</div>';
    });
  }

  A.start = function () {
    var nav = SECTIONS.filter(function (s) { return s[0] !== '/account'; }).map(function (s) {
      return { href: s[0], label: s[2].replace(' and providers', '').replace('Usage and limits', 'Limits').replace('African AI registry', 'African AI').replace('System settings', 'System'), icon: s[1], role: s[4],
        tab: ['/', '/users', '/moderation'].indexOf(s[0]) > -1 };
    });
    nav.push({ href: '/more', label: 'More', icon: 'more', role: 'admin', side: false });
    nav.push({ href: '/account', label: 'Account', icon: 'user', match: /^\/account/ });
    var r = function (path, render, title, role) { return { path: path, auth: true, wide: true, title: title, render: render, role: role }; };
    C.start({
      app: 'admin', title: 'Colon Admin', subtitle: 'Admin by Nifelux', allowSignup: false,
      nav: nav,
      routes: [
        r('/', overview, ''), r('/users', users, 'Users', 'moderator'), Object.assign(r('/users/:id', userPage, 'User', 'moderator'), { back: '/users' }),
        r('/moderation', moderation, 'Moderation', 'moderator'), r('/models', models, 'Models', 'admin'), r('/routing', routing, 'Routing', 'admin'),
        r('/limits', limitsPage, 'Limits', 'admin'), r('/evaluation', evaluation, 'Evaluation', 'admin'), r('/registry', registry, 'African AI', 'admin'),
        r('/voice', voice, 'Voice', 'admin'), r('/browser', browser, 'Browser', 'admin'), r('/system', system, 'System', 'super_admin'),
        r('/security', security, 'Security', 'admin'), r('/audit', function (v) { C.go('/security?tab=audit', true); }, 'Audit', 'admin'), r('/more', more, 'Admin', 'admin')
      ]
    });
  };
})();
