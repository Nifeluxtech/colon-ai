/* Colon AI · Help & Support screen: FAQ, shortcuts and contact links. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { CW } from '../core/cw.js';

var C = Colon, icon = C.icon, esc = C.esc;

var FAQ = [
  ['What can Colon Saga do?',
    ('Explain topics step by step, quiz you and make flashcards (Study), write and fix code (Developer), and '
    + 'research with sources (Research). '
    + 'General mode is for everything else.')],
  ['What is the CBT practice test?',
    ('A timed practice test like the JAMB CBT: pick WAEC, NECO, JAMB, University or General, a subject and an optional '
    + 'topic, then answer 10 objective questions in 5 minutes. It submits itself at 0:00, marks you instantly and '
    + 'explains every answer; “Discuss my mistakes” opens a Study chat about the ones you missed. Open it from '
    + 'Explore or “CBT practice” in the menu. The questions are exam-style practice, not real past questions, and '
    + 'each test counts as one Study reply toward the daily limit.')],
  ['Do I need an account?',
    ('No. You can chat with Colon Saga without logging in, but guest chats aren’t saved: they disappear when you '
    + 'close the tab. Log in or sign up (free) to save your chats, attach images and pick up on any device.')],
  ['Where are my chats stored?',
    ('When you’re logged in, conversations and files are saved to your Colon account and sync across your devices. '
    + 'Guest chats are never saved. If Colon can’t be reached, the app switches to Preview and keeps chats on this '
    + 'device.')],
  ['Why do replies say “Preview”?',
    ('Preview appears only when the Colon service can’t be reached (for example, no connection). Replies are then '
    + 'generated on your device so the app keeps working. They go away as soon as Colon is reachable again.')],
  ['Is there a daily limit?',
    ('Yes, a generous free daily limit of replies, and a smaller one for guests. It resets at midnight (UTC). '
    + 'Logging in gives you the higher limit.')],
  ['Which files can I attach?',
    ('Images (PNG, JPG, WebP, GIF) up to 10 MB, PDFs and documents up to 20 MB, text or code files up to 2 MB, '
    + 'and a .zip of a code project up to 20 MB. Up to 5 files per message.')],
  ['How do I get help with my code?',
    ('Pick Developer mode, then tap Explain, Fix a bug, Generate or Review for a ready-made request. Attach your '
    + 'code files or a .zip of the project: Colon reads the file tree and the files that matter (node_modules, '
    + 'build folders, images and .env files are skipped) and remembers them for the rest of the chat, so you can '
    + 'keep asking follow-up questions. Name a file (for example “fix src/app.js”) to make sure it is read first.')],
  ['How does voice input work?',
    ('Tap the microphone and speak, then tap Done. Colon writes what you said in the message box so you can fix it '
    + 'before sending. Pick your language (English, Naijá, Yorùbá, Hausa or Igbo) on the recording bar. If the '
    + 'microphone is blocked, allow it in your browser’s site settings.')],
  ['What is the browser panel?',
    ('Colon Browser inside your chat. Open it from the globe button or “Browse the Web”. On the web it is a reader '
    + 'preview that shows pages as clean text; full browsing comes with the Colon Android app.')],
  ['How do I delete my data?',
    ('Settings → Data management lets you export or delete all conversations. You can delete your whole account '
    + 'from Account → Security.')]
];
CW.pages.help = function (page) {
  page.innerHTML = ('<div class="cw-screen"><header class="cw-screen-head"><div><h1 class="h1">Help & Support</h1><p '
    + 'class="lead">Answers, shortcuts and ways to reach us.</p></div></header>') +
    '<div class="section-title">Frequently asked</div><div class="faq">' + FAQ.map(function (f) {
      return '<details class="faq-item"><summary>' + esc(f[0]) + icon('chevDown') + '</summary><p>' + esc(f[1])
      + '</p></details>'; }).join('') + '</div>' +
    '<div class="section-title">Keyboard shortcuts</div><div class="list">' + [['Ctrl', 'K', 'Search conversations'],
      ['Ctrl', 'Shift O', 'New chat'], ['', 'Enter', 'Send message'], ['Shift', 'Enter', 'New line'], ['', 'Esc',
      'Stop generating'], ['', '/', 'Focus the message box']].map(function (s) {
      return '<div class="set-row"><span class="body"><span class="title">' + esc(s[2]) + '</span></span><span>'
        + (s[0] ? '<span class="kbd">' + s[0] + '</span> + ' : '') + '<span class="kbd">' + s[1]
        + '</span></span></div>';
    }).join('') + '</div>' +
    '<div class="section-title">Get in touch</div><div class="list">' +
    C.row('https://github.com/Nifeluxtech/colon-ai/issues', 'alert', 'Report a problem', 'Open an issue on GitHub') +
    C.row('#/terms', 'file', 'Terms of Service', '') + C.row('#/privacy', 'lock', 'Privacy Policy', '') + '</div>' +
    '<p class="tiny muted" style="text-align:center;margin:20px 0">Colon AI v' + esc(C.version)
    + ' · by Nifelux</p></div>';
  page.querySelector('a[href^="https://github.com"]').setAttribute('target', '_blank');
};
