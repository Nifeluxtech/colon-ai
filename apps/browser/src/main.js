// Colon Browser entry point (boot only). Loads the shared UI kit (the same browser module and session
// adapter Colon AI uses) and the standalone shell as ES modules, then starts the app once the page is parsed.
import '../../../packages/ui/js/colon.js';
import '../../../packages/ui/js/store.js';
import '../../../packages/ui/js/markdown/index.js';
import '../../../packages/ui/js/url.js';
import '../../../packages/ui/js/browser/data.js';
import '../../../packages/ui/js/browser/saga-browse.js';
import '../../../packages/ui/js/browser/index.js';
import './app.js';

const NEED = ['icon', 'esc', 'sheet', 'menu', 'confirm', 'prompt', 'toast', 'debounce', 'logo', 'uid', 'copyText',
  'fmtBytes', 'ago'];
const EXTRA = ['CB', 'ColonBrowser', 'ColonBrowserData', 'ColonURL'];

document.addEventListener('DOMContentLoaded', function () {
  window.colonBooted = true;
  if (!window.colonKitReady(NEED, EXTRA) || typeof window.CB.mount !== 'function') return;
  var C = window.Colon, CB = window.CB;
  function ws(path, title) {
    return { path: path, auth: true, bare: true, app: 'browser', title: title, render: CB.mount, update: CB.route };
  }
  C.start({
    app: 'browser', title: 'Colon Browser', brand: 'COLON BROWSER', subtitle: 'by Nifelux', tabbar: false,
    nav: [
      { href: '/', label: 'Browse', icon: 'compass' },
      { href: '/tabs', label: 'Tabs', icon: 'tabs' },
      { href: '/bookmarks', label: 'Bookmarks', icon: 'bookmark' },
      { href: '/account', label: 'Account', icon: 'user', match: /^\/account/ }
    ],
    routes: [ws('/', ''), ws('/tabs', 'Tabs'), ws('/bookmarks', 'Bookmarks'), ws('/history', 'History'),
      ws('/downloads', 'Downloads'), ws('/ai', 'AI Browse'), ws('/settings', 'Settings'), ws('/help', 'Help')]
  });
});
