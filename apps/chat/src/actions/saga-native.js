/* Colon AI · AI Browse inside the Android app (Phase 9, with the Phase 10 "browser appears when Saga browses").
   When the app has its native browser panel (Colon.native.hasPanel()), Saga drives that real WebView through the
   server (POST /browser/agent -> the phone's bridge): the panel opens at once, the phone asks "Let Saga browse?",
   and every risky step asks for approval on the phone. This module follows the task (GET /browser/agent/:id with
   the action log since the last step), shows Saga's explanation of each step, and adds the answer with its steps
   and cited pages to the chat. On the web, or when the server or the phone can't do it, AI Browse falls back to
   the web reader panel (ColonSagaBrowse), as before. */

import { addBrowseNote, nativeBrowser, nativeFailed, openBrowser, syncNative } from '../components/browser-panel.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { S, data, signedIn } from '../core/state.js';

var C = Colon, POLL_MS = 1500, active = null;
var TERMINAL = ['done', 'step_limit', 'timeout', 'stopped', 'interrupted', 'failed'];
// Errors that mean "do it the web way": no Saga on this server, an app without Saga's tools, no phone link.
var FALLBACK = ['not_enabled', 'app_update_needed', 'no_phone', 'not_found'];
var ENDED = {
  step_limit: 'Saga used all its steps before finishing.', timeout: 'Saga ran out of time.',
  stopped: 'You stopped Saga.', interrupted: 'Saga stopped because you took control or paused.',
  failed: 'Saga couldn’t finish this task.'
};
var ERRORS = { declined: 'You didn’t allow Saga to browse.', no_consent: 'Nobody answered “Let Saga browse?” on the '
  + 'phone.', approval_missing: 'A step needed your approval and didn’t get it, so Saga stopped.', phone_timeout:
  'The browser panel stopped answering.', model_timeout: 'Colon Saga took too long to decide.', bad_reply: 'Colon '
  + 'Saga’s replies couldn’t be understood.' };

function webFallback(goal, why) {
  if (why) C.toast(why);
  var b = openBrowser(null, { panel: true });
  if (b && goal) b.startTask(goal);
}

function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function line(s) { return String(s || '').replace(/[\r\n]+/g, ' ').replace(/([*_`[\]<>])/g, '\\$1'); }

// The note added to the chat: Saga's answer, how it got there (each step it explained) and the pages it cited.
function noteFor(task, steps) {
  var md = task.answer ? String(task.answer) : '';
  if (task.status !== 'done') md = '_' + (ENDED[task.status] || 'Saga stopped.') + (task.error && ERRORS[task.error]
    ? ' ' + ERRORS[task.error] : '') + '_' + (md ? '\n\n' + md : '');
  var shown = steps.filter(function (a) { return a.kind === 'action'; });
  if (shown.length) {
    md += '\n\n**How Saga browsed**\n' + shown.map(function (a, i) {
      var where = a.url ? ' — ' + line(host(a.url)) : '';
      var tag = a.approved === 'approved' ? ' _(you approved)_' : a.approved === 'denied' ? ' _(you declined)_' : '';
      return (i + 1) + '. ' + line(a.say || a.tool) + where + tag + (a.ok === false && a.approved !== 'denied'
        ? ' _(didn’t work)_' : '');
    }).join('\n');
  }
  return md;
}

function poll(t) {
  setTimeout(function () {
    if (active !== t) return;
    C.api('/browser/agent/' + encodeURIComponent(t.id) + '?after=' + t.seq).then(function (d) {
      t.errors = 0;
      (d.actions || []).forEach(function (a) {
        t.seq = Math.max(t.seq, a.seq); t.steps.push(a);
        if (a.kind === 'action' && a.say && a.say !== t.lastSay) { t.lastSay = a.say; C.toast('Saga: ' + a.say); }
      });
      if (TERMINAL.indexOf(d.task.status) < 0) return poll(t);
      active = null;
      if (d.task.status === 'failed' && FALLBACK.indexOf(d.task.error) >= 0) {
        return webFallback(t.goal, d.task.error === 'app_update_needed' ? 'Update Colon AI to let Saga drive the '
          + 'browser panel. Using the web reader for now.' : 'Saga couldn’t reach the browser panel. Using the web '
          + 'reader instead.');
      }
      addBrowseNote(noteFor(d.task, t.steps), d.task.sources || [], t.goal);
    }, function () {
      if (++t.errors < 6) return poll(t);
      active = null; C.toast('Lost track of Saga’s task. Check your connection.', 'bad');
    });
  }, POLL_MS);
}

/** AI Browse in the app: opens the native panel (in the thread on phones since 0.9.1) and, with a goal, has Saga
    browse there. */
function browseNative(goal) {
  nativeBrowser('open', {}).then(syncNative, nativeFailed);
  if (!goal) return;
  // Saga's tasks belong to an account; signed-out (guest) chats keep the web reader.
  if (!signedIn() || data.kind !== 'remote') return webFallback(goal);
  // One task at a time; the panel's Stop button (or Take control) ends the running one.
  if (active) { C.toast('Saga is already browsing. Stop it in the panel first.', 'bad'); return; }
  var conv = S.current && !S.current.temporary ? S.current.id : null;
  C.api('/browser/agent', { method: 'POST', body: { goal: goal, conversation_id: conv,
    language: (C.user && C.user.language) || 'en' } }).then(function (d) {
    active = { id: d.task.id, goal: goal, seq: 0, steps: [], errors: 0, lastSay: '' };
    C.toast('Saga is browsing in the panel. Tap Allow on your phone to let it start.');
    poll(active);
  }, function (e) {
    if (e.code === 'refused') { C.toast(e.message, 'bad'); return; }
    if (FALLBACK.indexOf(e.code) >= 0 || e.status === 404 || e.status === 501) return webFallback(goal);
    C.toast(e.message || 'Saga couldn’t start browsing.', 'bad');
  });
}

export { browseNative };
