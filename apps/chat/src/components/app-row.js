/* Colon AI · the Android app rows for Settings and Help (v0.8.0). On the web they link to the two APKs on GitHub
   Releases (Colon AI and Colon Browser); inside the app they show the installed version, check for an update and
   open the standalone Colon Browser app (or offer it when it isn't installed). */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon;

function row(tag, attrs, ico, title, sub) {
  return '<' + tag + ' class="row" ' + attrs + '><span class="ico">' + C.icon(ico) + '</span><span class="body">'
    + '<span class="title">' + title + '</span><span class="sub"' + (tag === 'button' ? ' data-app-state' : '')
    + '>' + sub + '</span></span><span class="chev">' + C.icon('chev') + '</span></' + tag + '>';
}
function appRowHtml() {
  var N = C.native, v = N.version();
  if (N.isShell()) return row('button', 'type="button" data-app-update', 'phone', 'Colon AI for Android'
    + (v ? ' v' + C.esc(v) : ''), 'Check for updates')
    + (N.hasPanel() ? '<a class="row" href="#" data-browser-app><span class="ico">' + C.icon('globe') + '</span>'
      + '<span class="body"><span class="title">Colon Browser app</span><span class="sub">The full browser: tabs, '
      + 'private tabs, bookmarks and downloads</span></span><span class="chev">' + C.icon('chev') + '</span></a>' : '');
  var link = 'target="_blank" rel="noopener" data-app-get';
  return row('a', 'href="' + N.APK + '" ' + link, 'phone', 'Get Colon AI for Android',
    'Voice, Share to Colon and a real browser beside the chat. Free APK for Android 7 and newer.')
    + row('a', 'href="' + N.BROWSER_APK + '" ' + link, 'globe', 'Get Colon Browser for Android',
      'The full browser: tabs, private tabs, bookmarks, downloads and Google sign-in.')
    + row('a', 'href="' + N.RELEASES + '" ' + link, 'info', 'All releases and what changed', 'GitHub Releases');
}

function bindAppRow(root) {
  var ba = root.querySelector('[data-browser-app]');
  if (ba) ba.addEventListener('click', function (e) { e.preventDefault(); C.native.browser('handoff').catch(
    function () { C.toast('Couldn’t open Colon Browser.', 'bad'); }); });
  var b = root.querySelector('[data-app-update]'); if (!b) return;
  b.addEventListener('click', function () {
    var out = b.querySelector('[data-app-state]'); b.classList.add('is-loading'); out.textContent = 'Checking…';
    C.native.call('checkUpdate', { prompt: true }).then(function (r) {
      out.textContent = r.available ? 'Version ' + r.latest + ' is available' : 'You have the latest version';
    }, function () { out.textContent = 'Couldn’t check right now. Try again later.'; })
      .then(function () { b.classList.remove('is-loading'); });
  });
}

export { appRowHtml, bindAppRow };
