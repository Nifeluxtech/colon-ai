/* Colon Admin · Safety: what the safety layer did (read-only events with filters) and its live settings
   (categories per audience, provider moderation). Events never hold the conversation itself. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { sel, sw } from '../components/form.js';
import { chips, fail, head, num, skel } from '../components/page.js';
import { gate } from '../core/auth.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

var LABELS = { csam: 'Child sexual content', self_harm: 'Self-harm', violence: 'Weapons and violence',
  drugs: 'Drug making', hate: 'Hate and harassment', sexual: 'Sexual content', fraud: 'Fraud and scams',
  privacy: 'Personal data', prompt_injection: 'Prompt injection', prompt_leak: 'Prompt leak',
  provider: 'Moderation endpoint' };
var ACTIONS = { refuse: 'Refused', allow_with_care: 'Answered with care', stopped: 'Reply stopped',
  replaced: 'Reply replaced', neutralized: 'Neutralised', redacted: 'Redacted' };
var TONE = { refuse: 'bad', stopped: 'bad', allow_with_care: 'warn', neutralized: '', redacted: '', replaced: 'bad' };

function label(c) { return LABELS[c] || c; }

/* ================= Safety ================= */
function safety(view) {
  gate(view, function () {
    var f = { days: '7', category: '', action: '' };
    view.innerHTML = head('Safety', 'What the safety layer refused, answered with care or stopped. No message text '
      + 'is kept unless the server says so.') +
      chips([['1', '24 hours'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']], '7', 'data-d') +
      '<div class="adm-stack" style="margin-top:12px"><div class="card form" id="sf"></div>' +
      '<div class="card" id="sc"></div><div class="list" id="se"></div>' +
      '<div class="card form" id="ss">' + skel(3) + '</div></div>';
    function filters(d) {
      $('#sf', view).innerHTML = '<div class="h3">' + icon('search') + ' Filter</div>' +
        sel('category', 'Category', f.category, [['', 'All categories']].concat(d.categories.map(function (c) {
          return [c, label(c)]; }))) +
        sel('action', 'Action', f.action, [['', 'All actions']].concat(d.actions.map(function (a) {
          return [a, ACTIONS[a] || a]; })));
      $$('select', $('#sf', view)).forEach(function (s) { s.addEventListener('change', function () {
        f[s.name] = s.value; load(); }); });
    }
    function counts(d) {
      if (!d.counts.length) { $('#sc', view).innerHTML = '<p class="small muted">' + icon('check')
        + ' Nothing flagged in this period.</p>'; return; }
      var by = {};
      d.counts.forEach(function (c) { by[c.category] = (by[c.category] || 0) + c.n; });
      $('#sc', view).innerHTML = '<div class="h3">In this period</div><div class="adm-badges">' + Object.keys(by)
        .map(function (k) { return '<span class="badge">' + esc(label(k)) + ' · ' + num(by[k]) + '</span>'; })
        .join('') + '</div>';
    }
    function rows(d) {
      if (!d.events.length) { $('#se', view).innerHTML = '<div class="empty">' + icon('shield')
        + '<p>No safety events match.</p></div>'; return; }
      $('#se', view).innerHTML = d.events.map(function (e) {
        var who = e.guest ? 'Guest' : (e.user_email || 'Deleted account');
        return '<div class="row"><span class="ico" style="color:var(--' + (TONE[e.action] === 'bad' ? 'bad'
          : 'warn') + ')">' + icon(e.stage === 'injection' ? 'file' : 'alert') + '</span><span class="body">' +
          '<div class="title">' + esc(label(e.category)) + '</div><div class="sub">' + esc(who) + ' · '
          + esc(e.route || '') + (e.mode ? ' · ' + esc(e.mode) : '') + (e.language ? ' · ' + esc(e.language) : '')
          + (e.rule ? ' · ' + esc(e.rule) : '') + '</div>' +
          (e.excerpt ? '<div class="tiny muted">“' + esc(e.excerpt) + '”</div>' : '') +
          '<div class="adm-badges"><span class="badge ' + (TONE[e.action] || '') + '">' + esc(ACTIONS[e.action]
            || e.action) + '</span><span class="badge">' + esc(e.stage) + '</span>' + (e.source === 'provider'
            ? '<span class="badge">endpoint</span>' : '') + '</div></span>' +
          '<span class="tiny muted" style="flex:none" title="' + esc(e.request_id || '') + '">' + C.ago(e.created_at)
          + '</span></div>';
      }).join('');
    }
    var first = true;
    function load() {
      $('#se', view).innerHTML = skel(3);
      C.api('/admin/safety?days=' + f.days + '&category=' + encodeURIComponent(f.category) + '&action='
        + encodeURIComponent(f.action)).then(function (d) {
        if (first) { filters(d); first = false; }
        counts(d); rows(d);
      }).catch(function (e) { fail($('#se', view), e); });
    }
    $$('[data-d]', view).forEach(function (b) { b.addEventListener('click', function () {
      f.days = b.getAttribute('data-d');
      $$('[data-d]', view).forEach(function (x) { x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', x === b); });
      load(); }); });
    load();
    settingsCard($('#ss', view));
  });
}

function settingsCard(el) {
  C.api('/admin/safety/settings').then(function (d) {
    var S = d.safety, P = S.provider;
    el.innerHTML = '<form novalidate><div class="h3">' + icon('settings') + ' Settings</div>' +
      '<p class="small muted">Live within 30 s. “Signed in” is every account (Colon has no age check); “Guests” are '
        + 'signed-out visitors. Child-safety rules can’t be switched off.' + (S.rules ? '' : ' The server has '
        + 'SAFETY=off: only child-safety rules run.') + '</p>' +
      S.categories.map(function (c) {
        return '<div class="section-title">' + esc(c.label) + '</div><div class="list">' +
          sw('u_' + c.id, 'Signed in', '', c.user, c.locked) + sw('g_' + c.id, 'Guests', '', c.guest, c.locked)
          + '</div>';
      }).join('') +
      '<div class="section-title">Moderation endpoint</div>' +
      sel('provider', 'Provider moderation', P.setting === null ? 'default' : P.setting ? 'on' : 'off',
        [['default', 'Server default (' + (P.env ? 'on' : 'off') + ')'], ['on', 'On'], ['off', 'Off']]) +
      '<p class="tiny muted">' + (P.keyConfigured ? 'Key configured · ' + esc(P.model) + ' · now '
        + (P.effective ? 'running' : 'not running') : 'No SAFETY_MODERATION_API_KEY on the server, so it stays off.')
        + ' Fails open (logged) if the endpoint is slow or down. Message text in events: ' + esc(S.logText)
        + '.</p>' +
      '<button class="btn primary block" type="submit">Save safety settings</button></form>';
    C.bindForm($('form', el), function (v) {
      var cats = {};
      S.categories.forEach(function (c) { if (!c.locked) cats[c.id] = { user: v['u_' + c.id],
        guest: v['g_' + c.id] }; });
      return C.api('/admin/safety/settings', { method: 'PATCH', body: { categories: cats,
        provider: v.provider === 'default' ? null : v.provider === 'on' } })
        .then(function () { C.toast('Safety settings saved. Live within 30 seconds.', 'ok'); });
    });
  }).catch(function (e) { fail(el, e); });
}

export { safety };
