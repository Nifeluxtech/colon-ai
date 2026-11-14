/* Colon AI · Settings › Saga (0.11.0, ADR 0007): speed mode (this device), scheduled checks (pause, resume, run
   now, delete), saved routines (delete) and Colon Secured Login (the app's own Saved logins screen; on the web a
   note that logins are saved only in the Android app). Nothing here ever shows or sends a login value. */

import { setSpeed, speedOn } from '../actions/saga-extras.js';
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, esc = C.esc;

function rowHtml(title, sub, actions) {
  return '<div class="set-row"><span class="body"><span class="title">' + esc(title) + '</span>'
    + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</span><span class="cw-saga-acts">' + actions
    + '</span></div>';
}
function btn(attr, label) { return '<button type="button" class="btn ghost small" ' + attr + '>' + esc(label)
  + '</button>'; }

/** The section body (lists fill in after load, see bindSagaSettings). */
function sagaSettingsHtml() {
  var app = C.native.can && C.native.can('vault');
  return '<label class="set-row"><span class="body"><span class="title">Speed mode</span><span class="sub">Fewer, '
    + 'shorter steps for slow networks (this device)</span></span><span class="switch"><input type="checkbox" '
    + 'data-saga-speed' + (speedOn() ? ' checked' : '') + ' aria-label="Speed mode"><i></i></span></label>'
    + (app ? '<button class="row" type="button" data-saga-vault><span class="ico">' + C.icon('lock') + '</span>'
      + '<span class="body"><span class="title">Saved logins (Colon Secured Login)</span><span class="sub">Kept '
      + 'only on this phone, encrypted. Saga sees that a login exists, never what it is.</span></span></button>'
      : rowHtml('Saved logins', 'Logins for Saga are saved only in the Colon AI app for Android, on the phone. '
        + 'They never pass through this website.', '<a class="btn ghost small" target="_blank" rel="noopener" href="'
        + esc(C.native.APK) + '">Get the app</a>'))
    + '<div class="set-sub h4">Scheduled checks</div><div data-saga-schedules><p class="small muted">Loading…</p></div>'
    + '<div class="set-sub h4">Routines</div><div data-saga-routines><p class="small muted">Loading…</p></div>';
}

function scheduleRows(list) {
  if (!list.length) return '<p class="small muted">None yet. Say “check … every morning” in a chat.</p>';
  return list.map(function (s) {
    var paused = s.status === 'paused';
    return rowHtml(s.name, s.when + (paused ? ' · paused' : '') + (s.late ? ' · ran late' : ''),
      btn('data-sch-run="' + s.id + '"', 'Run now') + btn('data-sch-pause="' + s.id + '" data-to="'
        + (paused ? 'active' : 'paused') + '"', paused ? 'Resume' : 'Pause') + btn('data-sch-del="' + s.id + '"',
        'Delete'));
  }).join('');
}
function routineRows(list) {
  if (!list.length) return '<p class="small muted">None yet. After a task, say “save this as a routine called …”.</p>';
  return list.map(function (r) {
    return rowHtml(r.name, r.steps.length + ' steps' + (r.runs ? ' · run ' + r.runs + '×' : ''),
      btn('data-rt-del="' + r.id + '"', 'Delete'));
  }).join('');
}

function bindSagaSettings(root) {
  var sp = root.querySelector('[data-saga-speed]');
  if (sp) sp.addEventListener('change', function () {
    setSpeed(sp.checked); C.toast(sp.checked ? 'Speed mode on.' : 'Speed mode off.', 'ok');
  });
  var v = root.querySelector('[data-saga-vault]');
  if (v) v.addEventListener('click', function () {
    C.native.call('vault', { action: 'manage' }).catch(function () { C.toast('Couldn’t open saved logins.', 'bad'); });
  });
  var sch = root.querySelector('[data-saga-schedules]'), rt = root.querySelector('[data-saga-routines]');
  function load() {
    C.api('/browser/schedules').then(function (d) { sch.innerHTML = scheduleRows(d.schedules || []); },
      function () { sch.innerHTML = '<p class="small muted">Scheduled checks aren’t available right now.</p>'; });
    C.api('/browser/routines').then(function (d) { rt.innerHTML = routineRows(d.routines || []); },
      function () { rt.innerHTML = '<p class="small muted">Routines aren’t available right now.</p>'; });
  }
  function act(p, ok) { p.then(function () { if (ok) C.toast(ok, 'ok'); load(); },
    function (e) { C.toast((e && e.message) || 'That didn’t work.', 'bad'); }); }
  root.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sch-run],[data-sch-pause],[data-sch-del],[data-rt-del]');
    if (!b) return;
    var id = encodeURIComponent(b.getAttribute('data-sch-run') || b.getAttribute('data-sch-pause')
      || b.getAttribute('data-sch-del') || b.getAttribute('data-rt-del'));
    if (b.hasAttribute('data-sch-run')) act(C.api('/browser/schedules/' + id + '/run', { method: 'POST' }),
      'Saga will run it on your phone now.');
    else if (b.hasAttribute('data-sch-pause')) act(C.api('/browser/schedules/' + id, { method: 'PATCH',
      body: { status: b.getAttribute('data-to') } }));
    else C.confirm({ title: 'Delete this?', confirm: 'Delete', danger: true }).then(function (yes) {
      if (!yes) return;
      act(C.api('/browser/' + (b.hasAttribute('data-rt-del') ? 'routines/' : 'schedules/') + id,
        { method: 'DELETE' }), 'Deleted.');
    });
  });
  if (sch && rt) load();
}

export { bindSagaSettings, sagaSettingsHtml };
