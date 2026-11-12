/* Colon Browser · Help section. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { head } from '../components/chrome.js';

var C = Colon, icon = C.icon, esc = C.esc;

function helpPage(box) {
  var faq = [
    ['What is “Reader preview”?',
      ('On the web, Colon Browser loads pages as data, removes scripts, trackers and forms, and shows clean text '
      + 'and images. Sites that allow it open inside the browser; others open in a new tab. It is not a full '
      + 'browser engine.')],
    ['Where is the full browser?',
      ('Full browsing, with logins and interactive sites, runs in the Colon Android app on the Android System '
      + 'WebView (ROADMAP Phase 7–8).')],
    ['What are AI, Manual and Shared modes?',
      ('AI: Saga browses for you and every action is shown. Manual: you are in control and AI automation is '
      + 'paused. Shared: Saga proposes each action and waits for your approval.')],
    ['How do I take over from Saga?',
      ('Tap Take Control at any time. Saga pauses its pending actions first, then hands you the browser. Tap '
      + 'Return to AI to let it continue.')],
    ['Is my browsing private?',
      ('Your tabs, history and bookmarks are stored for your account only. Reader preview never runs page '
      + 'scripts. You can clear data any time in Settings.')]
  ];
  box.innerHTML = head('Help', 'How Colon Browser works.', '') +
    '<div class="faq">' + faq.map(function (f) { return '<details class="faq-item"><summary>' + esc(f[0]) + icon(
      'chevDown') + '</summary><p>' + esc(f[1]) + '</p></details>'; }).join('') + '</div>' +
    '<div class="section-title">Keyboard shortcuts</div><div class="list">' + [['Ctrl + L', 'Focus the address bar'],
      ['Alt + ←', 'Back'], ['Alt + →', 'Forward'], ['← →', 'Switch tabs (when a tab is focused)']].map(function (s) {
      return '<div class="set-row"><span class="body"><span class="title">' + esc(s[1])
      + '</span></span><span class="kbd">' + esc(s[0]) + '</span></div>'; }).join('') + '</div>' +
    '<div class="section-title">Get in touch</div><div class="list">' + C.row(
      'https://github.com/Nifeluxtech/colon-ai/issues', 'alert', 'Report a problem', 'Open an issue on GitHub')
      + C.row('#/terms', 'file', 'Terms', '') + C.row('#/privacy', 'lock', 'Privacy', '') + '</div>';
  box.querySelector('a[href^="https://github.com"]').setAttribute('target', '_blank');
}

export { helpPage };
