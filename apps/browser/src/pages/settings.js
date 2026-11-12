/* Colon Browser · Settings section. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { errBox, head, render } from '../components/chrome.js';
import { S } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, U = ColonURL;

function settingsPage(box) {
  box.innerHTML = head('Settings', 'Your browser, your rules.', '') + '<div class="skel" style="height:200px"></div>';
  S.data.getSettings().then(function (s) {
    var engines = Object.keys(U.ENGINES).map(function (k) { return [k, U.ENGINES[k].name]; });
    function sel(name, label, sub, v,
      opts) { return '<div class="set-row stack"><span class="body"><label class="title" for="bs-' + name + '">'
      + esc(label) + '</label>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '')
      + '</span><select class="select" id="bs-' + name + '" data-s="' + name + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></div>'; }
    function tog(name, label, sub, v) { return '<label class="set-row"><span class="body"><span class="title">'
      + esc(label) + '</span>' + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '')
      + '</span><span class="switch"><input type="checkbox" data-s="' + name + '"' + (v ? ' checked' : '')
      + ' aria-label="' + esc(label) + '"><i></i></span></label>'; }
    function perm(k, label) { return sel('perm.' + k, label, '', s.permissions[k], [['ask', 'Ask'], ['allow',
      'Allow'], ['block', 'Block']]); }
    var custom = s.homepage !== 'colon://newtab';
    box.querySelector('.skel').outerHTML =
      '<div class="section-title">General</div><div class="list">' +
      ('<div class="set-row stack"><span class="body"><span class="title">Homepage</span><span class="sub">What '
        + 'the Home button opens.</span></span><div class="seg" role="group" aria-label="Homepage"><button '
        + 'type="button" data-home="new" aria-pressed="') + !custom
        + '">New tab page</button><button type="button" data-home="custom" aria-pressed="' + custom
        + '">Custom page</button></div></div>' +
      '<form class="set-row stack" data-homeform' + (custom ? '' : ' hidden')
        + (' novalidate><span class="body"><label class="title" for="bs-homeurl">Homepage '
        + 'address</label></span><span class="set-inline"><input class="input" id="bs-homeurl" inputmode="url" '
        + 'value="') + esc(custom ? s.homepage : '')
        + '" placeholder="https://en.wikipedia.org"><button class="btn sm" type="submit">Save</button></span></form>'
        +
      sel('engine', 'Search engine', 'Used for searches from the address bar.', s.engine, engines) + '</div>' +
      '<div class="section-title">Appearance</div><div class="list">' +
      ('<div class="set-row stack"><span class="body"><span class="title">Theme</span></span><div class="seg" '
        + 'role="group" aria-label="Theme">') + [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system',
        'Auto', 'devices']].map(function (t) { return '<button type="button" data-theme-set="' + t[0]
        + '" aria-pressed="' + (C.theme.get() === t[0]) + '">' + icon(t[2]) + t[1] + '</button>';
        }).join('') + '</div></div>' +
      sel('readerFont', 'Reader text size', '', s.readerFont, [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']])
        + '</div>' +
      '<div class="section-title">Privacy</div><div class="list">' +
      tog('saveHistory', 'Save browsing history', 'Turn off to stop recording pages you visit.', s.saveHistory) +
      tog('loadImages', 'Load images', 'Turn off to save data on slow networks.', s.loadImages) +
      tog('blockTrackers', 'Block trackers',
        'Reader preview never runs page scripts. The Android app blocks known trackers.', s.blockTrackers) +
      tog('doNotTrack', 'Send “Do Not Track”', 'Applies in the Colon Android app.', s.doNotTrack) + '</div>' +
      '<div class="section-title">Site permissions</div><div class="list">' + perm('microphone', 'Microphone') + perm(
        'camera', 'Camera') + perm('location', 'Location') + perm('notifications', 'Notifications') +
      ('<div class="set-row"><span class="body"><span class="sub">Reader preview never gives sites access to '
        + 'these. Your choices apply to full browsing in the Colon Android app.</span></span></div></div>') +
      '<div class="section-title">Downloads</div><div class="list">' + tog('askWhereToSave',
        'Ask where to save each file', '', s.askWhereToSave) + tog('downloadOpenAfter',
        'Open files after downloading', '', s.downloadOpenAfter) + '</div>' +
      '<div class="section-title">Sessions and AI</div><div class="list">' + tog('restoreSession',
        'Restore tabs when you return', 'Reopen your last tabs, history and control mode.', s.restoreSession) +
      sel('aiApproval', 'When Saga browses in AI mode', 'Shared mode always asks before every action.', s.aiApproval,
        [['sensitive', 'Ask before sensitive actions'], ['always', 'Ask before every action']]) +
      '<div class="set-row"><span class="body"><span class="title">Where your data lives</span><span class="sub">'
        + esc(S.data.describe) + '</span></span></div></div>' +
      '<div class="section-title">Clear browsing data</div><div class="list"><form class="bw-clear" novalidate>' +
      [['history', 'Browsing history'], ['downloads', 'Downloads and uploads list'], ['session',
        'Open tabs and session'], ['bookmarks', 'Bookmarks and folders'], ['settings', 'Browser settings']].map(
        function (c, i) { return '<label class="check"><input type="checkbox" name="' + c[0] + '"' + (i < 2
        ? ' checked' : '') + '> <span>' + c[1] + '</span></label>'; }).join('') +
      '<button class="btn danger" type="submit">' + icon('trash') + 'Clear selected data</button></form></div>' +
      ('<p class="tiny muted" style="text-align:center;margin:20px 0">Colon Browser v0.3.1 · Web reader preview · '
        + 'by Nifelux</p>');
    box.querySelectorAll('[data-s]').forEach(function (el) {
      el.addEventListener('change', function () {
        var k = el.getAttribute('data-s'), v = el.type === 'checkbox' ? el.checked : el.value, patch = {};
        if (k.indexOf('perm.') === 0) { patch.permissions = Object.assign({}, s.permissions);
          patch.permissions[k.slice(5)] = v; } else patch[k] = v;
        S.data.saveSettings(patch).then(function (n) { s = n; S.inst.reloadSettings(); C.toast('Saved.', 'ok'); });
      });
    });
    box.querySelectorAll('[data-theme-set]').forEach(function (b) { b.addEventListener('click', function () {
      C.theme.set(b.getAttribute('data-theme-set')); box.querySelectorAll('[data-theme-set]').forEach(function (x) {
      x.setAttribute('aria-pressed', x === b); }); }); });
    var hf = box.querySelector('[data-homeform]');
    box.querySelectorAll('[data-home]').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelectorAll('[data-home]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
        if (b.getAttribute('data-home') === 'new') { hf.hidden = true; S.data.saveSettings({
          homepage: 'colon://newtab' }).then(function () { S.inst.reloadSettings();
          C.toast('Home opens a new tab page.', 'ok'); }); }
        else { hf.hidden = false; hf.querySelector('input').focus(); }
      });
    });
    hf.addEventListener('submit', function (e) {
      e.preventDefault(); var inp = hf.querySelector('input'), p = U.parseInput(inp.value, s.engine);
      var g = p && p.type === 'url' ? U.guard(p.url) : { ok: false,
        message: 'Enter a web address like https://example.com' };
      if (!g.ok) { inp.classList.add('err'); C.toast(g.message, 'bad'); return; }
      inp.classList.remove('err'); inp.value = g.url;
      S.data.saveSettings({ homepage: g.url }).then(function () { S.inst.reloadSettings(); C.toast('Homepage saved.',
        'ok'); });
    });
    box.querySelector('.bw-clear').addEventListener('submit', function (e) {
      e.preventDefault(); var what = {}; e.target.querySelectorAll('input:checked').forEach(function (i) { what[
        i.name] = true; });
      if (!Object.keys(what).length) return C.toast('Choose what to clear.');
      C.confirm({ title: 'Clear browsing data?', body: 'The selected data will be permanently removed.',
        confirm: 'Clear', danger: true }).then(function (ok) {
        if (!ok) return;
        S.data.clearData(what).then(function () { C.toast('Browsing data cleared.', 'ok'); if (what.session
          || what.settings) setTimeout(function () { location.reload(); }, 600); else { S.inst.refreshBookmarks();
          render('settings'); } });
      });
    });
  }).catch(function (e) { errBox(box, e, function () { render('settings'); }); });
}

export { settingsPage };
