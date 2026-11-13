/* Colon AI · driving this chat's browser from the chat (Phase 10). "open the browser", "open google.com", "go to
   my bank site" open the browser in the thread (inline on phones) without a Browse button; while it is open,
   "search for X", "click the second result", "scroll down", "what does this page say" are Saga tasks run on THIS
   chat's browser, and "let me help" / "you do it" / "done" change the mode or hand control back. The user's words
   and what was done are kept in the thread; the composer stays free while Saga works.
   In the app the browser is the native panel (Saga drives it through the server); on the web it is the reader
   panel with its own session per conversation. Intents: lib/browser-intent.js; modes: lib/browser-modes.js. */

import { browseNative, sagaActive } from './saga-native.js';
import { addThreadNote, nativeBrowser, openBrowser, setChatMode, setLayout, syncChat, syncNative }
  from '../components/browser-panel.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { S, signedIn } from '../core/state.js';
import { parseIntent } from '../lib/browser-intent.js';
import { modeLabel } from '../lib/browser-modes.js';

var C = Colon;

function nativeCtx() {
  var st = S.browser.nativeState || {};
  return { open: !!st.open, waiting: !!(st.handoff && st.handoff.message), resumable: !!st.resumable };
}
function webCtx() { return { open: S.browser.layout !== 'none' }; }
function host(u) { return ColonURL.displayUrl(u).replace(/^www\./, '').split('/')[0] || u; }
function say(text) { return addThreadNote(text, {}).catch(function () {}); }

// Saga in the app: the task runs on this chat's browser; its answer (and each step) lands in the thread.
function runTask(goal) {
  if (sagaActive()) return say('Saga is still working on your last instruction. Say “stop” to end it, or wait '
    + 'for its answer.');
  // Saga's tasks belong to an account; signed out (or offline Preview), the web reader does the browsing.
  browseNative(goal, { chat: true });
  return Promise.resolve();
}

function inApp(i) {
  switch (i.kind) {
    case 'open':
      return nativeBrowser('open', i.url ? { url: i.url } : {}).then(function (st) { syncNative(st);
        return say(i.url ? 'Opened ' + host(i.url) + ' in this chat’s browser.' : 'Opened this chat’s browser. '
          + 'Tell me what to do in it, like “search for…” or “scroll down”.'); });
    case 'close':
      return nativeBrowser('close').then(function (st) { syncNative(st); return say('Closed the browser. Its tabs '
        + 'and sign-ins stay with this chat for next time.'); });
    case 'mode':
      return setChatMode(i.mode).then(function () { return say(i.mode === 'shared' ? 'OK, we’ll browse together '
        + '(' + modeLabel('shared') + '): use the page any time and I’ll see what you change.' : 'OK, '
        + modeLabel('ai') + ': I’ll do the browsing and you watch. Say “take control” whenever you want it back.'); });
    case 'control':
      return nativeBrowser('control', { op: i.op }).then(function (st) { syncNative(st);
        return say(i.op === 'return_to_ai' ? 'Thanks. Saga is carrying on.' : i.op === 'stop' ? 'Stopped Saga.'
          : 'You’re in control. Say “continue” when Saga should carry on.'); }, function () {
        return say(i.op === 'stop' ? 'Saga isn’t doing anything in the browser right now.' : 'There’s no Saga task '
          + 'to hand back to right now.'); });
    case 'task':
      if (!(S.browser.nativeState && S.browser.nativeState.open)) {
        return nativeBrowser('open', {}).then(function (st) { syncNative(st); return runTask(i.goal); });
      }
      return runTask(i.goal);
  }
  return Promise.resolve();
}

function onWeb(i) {
  if (i.kind === 'close') { setLayout('none'); return say('Closed the browser.'); }
  if (i.kind === 'mode') return setChatMode(i.mode).then(function () { return say('This chat’s browser is now “'
    + modeLabel(i.mode) + '”. Saga drives the full browser in the Colon AI app; here it reads pages for you.'); });
  if (i.kind === 'control') return say('Taking turns with Saga works in the Colon AI app’s browser.');
  if (i.kind === 'open') { openBrowser(i.url || null); return say(i.url ? 'Opened ' + host(i.url)
    + ' in this chat’s browser (reader mode).' : 'Opened this chat’s browser (reader mode).'); }
  var b = openBrowser(null, { panel: true });
  if (b) b.startTask(i.goal);
  return say('Saga is on it in this chat’s browser. Watch each step in the panel.');
}

/**
 * The composer's text, before it is sent as a chat message: true when it was an instruction for this chat's
 * browser (handled here, kept in the thread), false for an ordinary message.
 */
function handleBrowserText(text) {
  var app = C.native.hasPanel() && C.native.can('browserChats');
  var intent = parseIntent(text, app ? nativeCtx() : webCtx());
  if (!intent) return false;
  // A task in the app needs an account (Saga runs on the server); signed out, only open/close work there.
  if (app && intent.kind === 'task' && !signedIn()) return false;
  addThreadNote(text, { role: 'user', mode: S.draftMode, title: text }).then(function () {
    syncChat();                      // a chat created just now adopts the browser it already had
    return app ? inApp(intent) : onWeb(intent);
  }).catch(function (e) { C.toast((e && e.message) || 'The browser didn’t respond. Try again.', 'bad'); });
  return true;
}

export { handleBrowserText };
