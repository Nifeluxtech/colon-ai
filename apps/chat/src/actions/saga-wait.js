/* Colon AI · 0.11.6: the chat while a Saga task is live (owner's report: Saga waited on the Colon Secured Login form
   and "Login n", "Hi" typed meanwhile got no reply). What a typed message does is lib/saga-route.js (pure, tested):
   while Saga waits for the user it is a normal chat turn, except "continue", "login", "try again", "I've saved it"…
   (Saga carries on: return_to_ai, or resume after a pause) and "stop" / "cancel"; while Saga works it steers the
   next step (guide) with a line in the thread. The waiting note's links (#colon-login: reopen the login form,
   #colon-stop: stop Saga) are answered here too (CW.sagaWaitLink, from saga-extras' click handler). */

import { addThreadNote, nativeBrowser, syncNative } from '../components/browser-panel.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { CW } from '../core/cw.js';
import { S } from '../core/state.js';
import { routeTyped, waitingOf } from '../lib/saga-route.js';
import { activeTaskId, polledWait, stopSaga } from './saga-native.js';
import { guide, loginCard } from './saga-extras.js';

var C = Colon;
var LIVE = ['running', 'paused', 'needs_user', 'user_control'];

function nativeRun() { return (S.browser && S.browser.nativeState && S.browser.nativeState.run) || {}; }
function liveTask() {
  var run = nativeRun();
  return activeTaskId() || (LIVE.indexOf(run.state) >= 0 ? String(run.task || 'live') : null);
}
/** What Saga waits for now ({ kind: login · user · paused, site }), or null while it works (or nothing is live). */
function sagaWaiting() { return waitingOf(nativeRun(), polledWait()); }
function say(md) { return addThreadNote(md, {}).catch(function () {}); }

/** Saga carries on (the user's words go with it: the phone turns "I've saved it" into "Login saved for …" when
 *  its vault has the login). */
function resumeSaga(note, w) {
  var op = w && w.kind === 'paused' ? 'resume' : 'return_to_ai';
  return nativeBrowser('control', { op: op, note: note || '' }).then(function (st) { syncNative(st);
    return say(w && w.kind === 'login' ? 'Thanks. Saga is carrying on: it signs in with your saved login if it '
      + 'finds one, otherwise it hands the sign-in to you.' : 'Thanks. Saga is carrying on.'); }, function () {
    return say('Saga isn’t waiting for the browser any more. Tell me what to do next.'); });
}
function stopNow() {
  stopSaga();
  return nativeBrowser('control', { op: 'stop' }).then(syncNative, function () {}).then(function () {
    return say('Stopped Saga.'); });
}

/** The composer's text while a Saga task is live (after the password and plan checks): true when it was handled
 *  here; false: it goes to the chat model as a normal message. onWaiting(text) is called when the server says Saga
 *  is waiting after all (guide's 409): the message then goes to the chat model. */
function sagaTyped(text, clearComposer, onWaiting) {
  var w = sagaWaiting();
  var r = routeTyped(text, { task: liveTask(), waiting: w });
  if (!r || r.kind === 'chat') return false;
  clearComposer();
  if (r.kind === 'guide') {
    var id = activeTaskId();
    if (!id) return false;
    guide(id, text).catch(function (e) {
      if (e && e.code === 'waiting' && onWaiting) return onWaiting(text);
      C.toast((e && e.message) || 'Saga couldn’t get that message.', 'bad');
    });
    return true;
  }
  addThreadNote(text, { role: 'user', title: text }).then(function () {
    return r.kind === 'stop' ? stopNow() : resumeSaga(r.note, w);
  }).catch(function (e) { C.toast((e && e.message) || 'The browser didn’t respond. Try again.', 'bad'); });
  return true;
}

/** Reopens the Colon Secured Login form for the site Saga waits on. Saved: Saga signs in at once. */
function reopenLogin() {
  var w = sagaWaiting() || {}, site = w.site || '';
  if (C.native.can && C.native.can('loginWait')) {
    return nativeBrowser('control', { op: 'login_form' }).then(syncNative, function () {
      C.toast('Saga isn’t waiting for a login any more.'); });
  }
  if (!(C.native.can && C.native.can('vault'))) return loginCard(site, 'Saga needs a login for ' + (site || 'this site')
    + '.');
  return C.native.call('vault', { action: 'form', site: site, trust: true }).then(function (r) {
    var saved = r && r.login_saved;
    return nativeBrowser('control', { op: 'return_to_ai', note: saved ? 'Login saved for ' + (r.site || site)
      + ' in Colon Secured Login' : 'I didn\'t save a login.' }).then(syncNative, function () {});
  }, function () {});
}

CW.sagaWaitLink = function (href) {
  if (href === '#colon-login') return reopenLogin();
  if (href === '#colon-stop') return stopNow();
  return null;
};

/** 0.11.6: the browse tool asked for more while Saga waits for the user: Saga carries on with it as the note. */
function browseWhileWaiting(goal) {
  var w = sagaWaiting();
  if (!w) return false;
  resumeSaga(goal, w);
  return true;
}

export { browseWhileWaiting, reopenLogin, sagaTyped, sagaWaiting };
