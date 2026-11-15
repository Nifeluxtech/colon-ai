/* Colon AI · driving this chat's browser from the chat (Phase 10). "open the browser", "open google.com", "go to
   my bank site" open the browser in the thread (inline on phones) without a Browse button; while it is open,
   "search for X", "click the second result", "scroll down", "what does this page say" are Saga tasks run on THIS
   chat's browser, and "let me help" / "you do it" / "done" change the mode or hand control back. The user's words
   and what was done are kept in the thread; the composer stays free while Saga works.
   In the app the browser is the native panel (Saga drives it through the server); on the web it is the reader
   panel with its own session per conversation. Intents: lib/browser-intent.js; modes: lib/browser-modes.js.
   0.10.3 (ADR 0006): the app's browser is AI-only. While the user has it (Take control, or Saga asked for them),
   whatever they send is their hand-back: it is kept in the thread and goes to Saga with the browser ("I've logged
   in, continue"); "let me help" no longer switches to a shared mode.
   0.10.4: "reshow / show / reopen the browser" brings this chat's live browser back on its page (in view), and
   "continue" / "carry on" after a task ended (or was cut off) continues it (the card's Continue); neither goes to
   the chat model as plain chat.
   0.11.3 (owner): a follow-up to the chat's last browser task ({ follow: true }, any site, any specialist: the chat's
   Developer / Study / Research mode is kept) continues that task's browser session (continue_of: Saga starts from
   what it did), and its live card shows under the user's message. The server sends the same follow-ups back here
   (event browse) when this page didn't catch one (browseFromServer).
   0.11.5 (owner): signed in, the chat model decides whether to browse (its browse tool; the server sends event
   browse, and the live card opens under the user's message in this chat's session on every call). Only the
   browser's own controls are read here (ctx.tools). Each message carries this chat's browser state (pageState):
   the page, a short summary and the numbered clickable items the phone read (Readability + Turndown). */

import { browseNative, continueNative, sagaActive, stopSaga } from './saga-native.js';
import { addThreadNote, nativeBrowser, openBrowser, revealInThread, setChatMode, setLayout, syncChat, syncNative }
  from '../components/browser-panel.js';
import { ensureChat, openedBy } from '../components/browser-chats.js';
import { placeCards } from '../components/browser-card.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';
import { S, signedIn } from '../core/state.js';
import { parseIntent } from '../lib/browser-intent.js';
import { modeLabel } from '../lib/browser-modes.js';
import { givesBack, holdsIdle } from '../lib/saga-card.js';

var C = Colon;

var ENDED = ['done', 'error', 'stopped'];
function nativeCtx() {
  var st = S.browser.nativeState || {}, run = st.run || {};
  return { open: !!st.open, waiting: !!(st.handoff && st.handoff.message), resumable: !!st.resumable,
    ended: ENDED.indexOf(run.state) >= 0 && !!(run.goal || run.task), busy: sagaActive(),
    recent: !!(run.task || run.goal), prev: prevUserText(), tools: signedIn() };
}
// 0.11.3: the user's last message in this chat (a follow-up fragment is read with it).
function prevUserText() {
  for (var i = (S.messages || []).length - 1; i >= 0; i--) {
    var m = S.messages[i];
    if (m && m.role === 'user' && m.content) return String(m.content);
  }
  return '';
}
function webCtx() { return { open: S.browser.layout !== 'none', prev: prevUserText(), tools: signedIn() }; }
function host(u) { return ColonURL.displayUrl(u).replace(/^www\./, '').split('/')[0] || u; }
function say(text) { return addThreadNote(text, {}).catch(function () {}); }
// 0.10.5: the reopened browser's live card goes under this reply and scrolls into view. 0.11.1: kept per chat
// (browser-chats.js openedBy), so it is still there after leaving the chat and coming back; the anchor reports again.
function showHere(m) {
  if (!m || !m.id) return m;
  openedBy(m);
  S.browser.revealNext = true;
  S.browser.cardsSig = null;
  placeCards();
  if (S.browser.anchor) S.browser.anchor.force();
  if (S.browser.liveShown && S.browser.host) setTimeout(function () { revealInThread(S.browser.host, true); }, 80);
  return m;
}

// Saga in the app: the task runs on this chat's browser; its answer (and each step) lands in the thread. anchor: the
// message the task's card goes under (the user's instruction).
function runTask(goal, anchor, follow) {
  if (sagaActive()) return say('Saga is still working on your last instruction. Say “stop” to end it, or wait '
    + 'for its answer.');
  // 0.11.3: a follow-up carries on from the chat's last task, in the same browser session (its steps go to Saga).
  var prev = follow ? ((S.browser.nativeState || {}).run || {}).task : null;
  if (prev && /^\d+$/.test(String(prev))) { continueNative({ task: prev, goal: goal, anchor: anchor || '' });
    return Promise.resolve(); }
  // Saga's tasks belong to an account; signed out (or offline Preview), the web reader does the browsing.
  browseNative(goal, { chat: true, anchor: anchor || '' });
  return Promise.resolve();
}

function inApp(i, note) {
  var anchor = note && note.id ? String(note.id) : '';
  switch (i.kind) {
    case 'open':
      // 0.11.1: the app shows this chat's browser first (ensureChat), and the card shows at once under the
      // instruction (note), then moves under the reply when it lands.
      return ensureChat().then(function () { return nativeBrowser('open', i.url ? { url: i.url } : {}); })
        .then(function (st) { syncNative(st); showHere(note);
        var page = st && st.url ? host(st.url) : '';
        return say(i.url ? 'Opened ' + host(i.url) + ' in this chat’s browser.' : page ? 'Here’s this chat’s '
          + 'browser, still on ' + page + '. Tell me what to do next, or say “continue” to carry on.' : 'Opened this '
          + 'chat’s browser. Tell me what to do in it, like “search for…” or “scroll down”.').then(showHere); });
    case 'continue': {
      var run = (S.browser.nativeState || {}).run || {};
      continueNative({ task: run.task, goal: run.goal, anchor: anchor || run.anchor || '' });
      return say('Carrying on in this chat’s browser, from where Saga left off.');
    }
    case 'close':
      return nativeBrowser('close').then(function (st) { syncNative(st); return say('Closed the browser. Its tabs '
        + 'and sign-ins stay with this chat for next time.'); });
    case 'mode':
      return say('This chat’s browser is AI-only: I do the browsing and you watch. Tap **Take control** on the '
        + 'browser card whenever you want to use the page yourself, then tell me here when to carry on.');
    case 'control':
      if (i.op === 'stop') stopSaga();
      return nativeBrowser('control', { op: i.op }).then(function (st) { syncNative(st);
        return say(i.op === 'return_to_ai' ? 'Thanks. Saga is carrying on.' : i.op === 'stop' ? 'Stopped Saga.'
          : 'You’re in control. Say “continue” when Saga should carry on.'); }, function () {
        return say(i.op === 'stop' ? 'Saga isn’t doing anything in the browser right now.' : 'There’s no Saga task '
          + 'to hand back to right now.'); });
    case 'task':
      // 0.11.2: a message that needs the browser opens this chat's browser itself (the 0.11.1 path: the app shows
      // this chat's browser first) and the live card shows at once under the user's message.
      if (!(S.browser.nativeState && S.browser.nativeState.open)) {
        return ensureChat().then(function () { return nativeBrowser('open', {}); }).then(function (st) {
          syncNative(st); showHere(note); return runTask(i.goal, anchor, i.follow); });
      }
      showHere(note);
      return runTask(i.goal, anchor, i.follow);
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
  var run = app && S.browser.nativeState ? S.browser.nativeState.run : null;
  // The user has the browser: their message gives it back to Saga, with these words as the note.
  if (givesBack(run)) {
    addThreadNote(text, { role: 'user', mode: S.draftMode, title: text }).then(function () {
      return nativeBrowser('control', { op: 'return_to_ai', note: text }).then(function (st) { syncNative(st);
        return say('Thanks. Saga has the browser again and is carrying on.'); }, function () {
        return say('Saga isn’t waiting for the browser any more. Tell me what to do next.'); });
    }).catch(function (e) { C.toast((e && e.message) || 'The browser didn’t respond. Try again.', 'bad'); });
    return true;
  }
  // They took an idle browser: the full-screen view closes and the message goes on as usual.
  if (holdsIdle(run)) nativeBrowser('control', { op: 'return_to_ai' }).then(syncNative, function () {});
  var intent = parseIntent(text, app ? nativeCtx() : webCtx());
  if (!intent) return false;
  // A task in the app needs an account (Saga runs on the server); signed out, only open/close work there.
  if (app && intent.kind === 'task' && !signedIn()) return false;
  addThreadNote(text, { role: 'user', mode: S.draftMode, title: text }).then(function (note) {
    syncChat();                      // a chat created just now adopts the browser it already had
    return app ? inApp(intent, note) : onWeb(intent);
  }).catch(function (e) { C.toast((e && e.message) || 'The browser didn’t respond. Try again.', 'bad'); });
  return true;
}

/** 0.11.3: the server found a browser follow-up this page didn't (event browse): the user's message (id) is in the
    thread already; Saga does it in this chat's browser, its live card under that message. */
function browseFromServer(goal, id) {
  var app = C.native.hasPanel() && C.native.can('browserChats');
  var i = { kind: 'task', goal: String(goal || ''), open: true, follow: true };
  if (!i.goal) return;
  syncChat();
  (app ? inApp(i, { id: id }) : onWeb(i)).catch(function (e) {
    C.toast((e && e.message) || 'The browser didn’t respond. Try again.', 'bad'); });
}

/** 0.11.5: the chat model closed this chat's browser (its stop_browsing tool; event browser {op: 'close'}). */
function browserFromServer(ev) {
  if (!ev || ev.op !== 'close') return;
  var app = C.native.hasPanel() && C.native.can('browserChats');
  if (!app) { setLayout('none'); return; }
  if (sagaActive()) stopSaga();
  nativeBrowser('close').then(syncNative, function () {});
}

/** 0.11.5: this chat's browser now, sent with the message for the chat model: { url, title, summary, items } (the
    phone reads the page: feature pageSummary), else the page the panel shows; null with no browser. At most ~1.5 s. */
function pageState() {
  var app = C.native.hasPanel() && C.native.can('browserChats');
  var st = S.browser.nativeState || {};
  if (!app || !signedIn() || !(st.url || (st.run && (st.run.task || st.run.goal)))) return Promise.resolve(null);
  var plain = st.url ? { url: st.url, title: st.title || '', open: !!st.open } : null;
  if (!C.native.can('pageSummary') || !st.url) return Promise.resolve(plain);
  var late = new Promise(function (ok) { setTimeout(function () { ok(plain); }, 1500); });
  return Promise.race([nativeBrowser('page').then(function (p) { return p && p.url ? p : plain; },
    function () { return plain; }), late]);
}

export { browseFromServer, browserFromServer, handleBrowserText, pageState };
