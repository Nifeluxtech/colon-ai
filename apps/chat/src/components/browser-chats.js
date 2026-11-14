/* Colon AI · one browser per chat in the Android app (Phase 10; moved out of browser-panel.js in 0.11.1). The chat
   on screen changed: the app shows that chat's own browser, a new chat a clean one (or its draft, adopted when its
   conversation was just created), the web reader its session. 0.11.1: the app's state is checked against the chat
   on screen, and when it names another chat the page tells the app again (lib/native-panel.js needsChatResync):
   the card the user opened no longer stays hidden until they leave the chat and come back. */

import { loadCards, openers } from './browser-card.js';
import { appCards, nativeBrowser, placeAll, setLayout, syncNative } from './browser-panel.js';
import { chatCall, sessionKey } from '../lib/browser-modes.js';
import { needsChatResync } from '../lib/native-panel.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { CW } from '../core/cw.js';
import { S, data, signedIn } from '../core/state.js';

var C = Colon;

function onChatScreen() { return !!S.el && (S.view === 'chat' || S.view === 'welcome'); }

// Sends browser('chat', call); the page knows a call is on its way until the app answers.
function sendChat(key, call) {
  S.browser.chatSent = key; S.browser.chatPending = true;
  return nativeBrowser('chat', call).then(function (st) { S.browser.chatPending = false; syncNative(st); },
    function () { S.browser.chatPending = false; });
}

function syncChat() {
  if (!onChatScreen()) return;
  var key = sessionKey(S.current);
  if (S.browser.inst && S.browser.instKey !== key) {
    if (S.browser.layout !== 'none') setLayout('none');
    S.browser.inst.destroy(); S.browser.inst = null;
  }
  var chats = C.native.can('browserChats');
  var call = chats ? chatCall(S.browser.chatSent, key, { created: !!key && key === S.browser.createdId }) : null;
  var switched = Promise.resolve();
  if (call) { S.browser.modeSent = null; switched = sendChat(key, call); }
  // This chat's Saga cards (0.10.3). 0.10.6: none on a new chat; the app's only once it shows this chat (asked
  // earlier, it answered with the previous chat's finished card). 0.11.1: the reply that opened each chat's browser
  // is kept per chat (browser-card.js openers), so coming back puts the live card under it again.
  if (S.browser.cardsKey !== key) {
    S.browser.cardsKey = key; S.browser.cards = []; S.browser.cardsSig = null; S.browser.openedHere = null;
    placeAll();
    var from = !key ? function () { return []; } : C.native.hasPanel() ? appCards
      : signedIn() && data.kind === 'remote' ? null : function () { return []; };
    switched.then(function () { if (S.browser.cardsKey === key) loadCards(key, from); });
  }
  if (!chats) return;
  // AI only (0.10.3); an older app that still has "AI + me" is told so too.
  if (S.browser.modeSent !== key) { S.browser.modeSent = key;
    nativeBrowser('mode', { mode: 'ai' }).then(syncNative, function () {}); }
}
CW.syncChat = syncChat;

/** 0.11.1: the app's state st names another chat than the one on screen: tell it again (at most twice per chat).
 *  Returns the call's promise, or null when nothing was sent. */
function healChat(st) {
  if (!onChatScreen() || !C.native.can('browserChats')) return null;
  var key = sessionKey(S.current), tries = S.browser.resyncs || (S.browser.resyncs = {}), k = key || '';
  if (!needsChatResync(st, key, { pending: S.browser.chatPending, tries: tries[k] })) return null;
  tries[k] = (tries[k] || 0) + 1;
  // A new chat that just got its id adopts the draft browser the app shows (nothing reloads).
  var call = chatCall(st.chat || null, key, { created: !!key && key === S.browser.createdId })
    || { conversation_id: k, adopt: false };
  return sendChat(key, call);
}

/** Before opening the browser from the chat: make sure the app shows this chat's browser. */
function ensureChat() {
  return healChat(S.browser.nativeState) || Promise.resolve();
}

/** The reply (or instruction) message m opened this chat's browser: its live card goes under it from now on. */
function openedBy(m) {
  var key = sessionKey(S.current);
  if (key && m && m.id) openers().set(key, String(m.id), Date.now());
}

// A deleted chat's browser goes with it: the app's profile and tabs, the web reader's session on this device.
function forgetChat(id) {
  if (C.native.can('browserChats')) nativeBrowser('forget', { conversation_id: id }).catch(function () {});
  openers().forget(id);
  var d = window.ColonBrowserData && window.ColonBrowserData.get();
  if (d && d.kind === 'local' && d.removeSession) d.removeSession(id).catch(function () {});
}
CW.forgetAllChats = function () {
  if (C.native.can('browserChats')) nativeBrowser('forget', { all: true }).catch(function () {});
};

export { ensureChat, forgetChat, healChat, openedBy, syncChat };
