/* Colon AI · the Android app row for Settings and Help (v0.7.1). On the web it links to the APK on GitHub
   Releases; inside the app it shows the installed version and checks for an update. */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon;

function appRowHtml() {
  var N = C.native, v = N.version();
  if (N.isShell()) return '<button class="row" type="button" data-app-update><span class="ico">' + C.icon('phone')
    + '</span><span class="body"><span class="title">Colon AI for Android' + (v ? ' v' + C.esc(v) : '')
    + '</span><span class="sub" data-app-state>Check for updates</span></span><span class="chev">' + C.icon('chev')
    + '</span></button>';
  return '<a class="row" href="' + N.RELEASES + '" target="_blank" rel="noopener" data-app-get><span class="ico">'
    + C.icon('phone') + '</span><span class="body"><span class="title">Get the Android app</span><span class="sub">'
    + 'Full browsing in Colon Browser, voice, and Share to Colon. Free APK for Android 7 and newer.</span></span>'
    + '<span class="chev">' + C.icon('chev') + '</span></a>';
}

function bindAppRow(root) {
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
