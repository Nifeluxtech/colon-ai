// Colon AI entry point (boot only). Loads the shared UI kit and the chat workspace as ES modules, from the
// same versioned folder as this file, then starts the app once the page is parsed.
import '../../../packages/ui/js/colon.js';
import '../../../packages/ui/js/store.js';
import '../../../packages/ui/js/markdown/index.js';
import '../../../packages/ui/js/url.js';
import '../../../packages/ui/js/browser/data.js';
import '../../../packages/ui/js/browser/saga-browse.js';
import '../../../packages/ui/js/browser/index.js';
import './lib/responder.js';
import './core/data.js';
import './lib/media.js';
import './pages/pages.js';
import './pages/settings.js';
import './app.js';

const NEED = ['icon', 'esc', 'sheet', 'menu', 'confirm', 'prompt', 'toast', 'debounce', 'copyText', 'uid', 'fmtBytes',
  'ago', 'logo', 'resizable', 'verifyBanner', 'bindBanner', 'authModal'];
const EXTRA = ['CW', 'ColonChatData', 'ColonBrowser', 'ColonMarkdown', 'ChatMedia'];

document.addEventListener('DOMContentLoaded', function () {
  window.colonBooted = true;
  if (!window.colonKitReady(NEED, EXTRA) || typeof window.CW.mount !== 'function') return;
  var C = window.Colon, CW = window.CW;
  // No sign-in needed: guests chat without saving (v0.4.4). Account screens (/account/…) still need it.
  function ws(path, title) { return { path: path, bare: true, app: 'chat', title: title, render: CW.mount,
    update: CW.route }; }
  C.start({
    app: 'chat', title: 'Colon AI', brand: 'COLON AI', subtitle: 'by Nifelux', tabbar: false, guestMode: true,
    nav: [
      { href: '/', label: 'Home', icon: 'home' },
      { href: '/history', label: 'History', icon: 'history' },
      { href: '/saved', label: 'Saved', icon: 'saved' },
      { href: '/account', label: 'Profile', icon: 'user', match: /^\/account/ }
    ],
    routes: [
      ws('/', ''), ws('/c/:id', ''), ws('/history', 'History'), ws('/saved', 'Saved'),
      ws('/explore', 'Explore'), ws('/settings', 'Settings'), ws('/help', 'Help'), ws('/share/:token', 'Shared chat')
    ]
  });
});
