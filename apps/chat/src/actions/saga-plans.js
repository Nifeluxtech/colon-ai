/* Colon AI · scheduled browsing and saved routines from the chat (0.11.0, ADR 0007). "check yolotask every morning
   and tell me about new tasks" creates a scheduled check for this chat: the server keeps it and, at its time, asks
   the phone (Colon AI connected) to run it in this chat's browser; the result comes back here as a message with
   what is new since the last run. "save this as a routine called daily update" records the chat's last finished
   task; "run daily update" / "post my daily update" replays it (risky steps still ask). Intents: lib/saga-plans.js. */

import { browseNative, lastDoneTask, sagaActive } from './saga-native.js';
import { addThreadNote, nativeBrowser } from '../components/browser-panel.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { S, signedIn } from '../core/state.js';
import { planIntent, tzOffset } from '../lib/saga-plans.js';

var C = Colon, esc = C.esc;
S.routines = S.routines || [];

function say(md) { return addThreadNote(md, {}).catch(function () {}); }
function loadRoutines() {
  if (!signedIn()) return Promise.resolve([]);
  return C.api('/browser/routines').then(function (d) { S.routines = d.routines || []; return S.routines; },
    function () { return S.routines; });
}

function schedule(text) {
  var conv = S.current && !S.current.temporary ? S.current.id : null;
  return C.api('/browser/schedules', { method: 'POST', body: { text: text, conversation_id: conv,
    tz_offset: tzOffset(), language: (C.user && C.user.language) || 'en' } }).then(function (d) {
    var s = d.schedule;
    // The user set this up from the app: its runs may start without "Let Saga browse?" on this phone.
    if (C.native.can && C.native.can('sagaSchedules')) {
      nativeBrowser('schedules', { allow: true }).catch(function () {});
    }
    return say('🗓️ Scheduled: **' + esc(s.goal) + '**, ' + esc(s.when) + '. Saga runs it in this chat’s browser on '
      + 'your phone (Colon AI needs to be connected; if it isn’t, the check runs when it next connects and says it ran '
      + 'late). Each result comes here, with what’s new since the last run. Manage it in Settings › Saga.');
  }, function (e) { return say('I couldn’t schedule that: ' + esc((e && e.message) || 'try again later') + '.'); });
}

function saveRoutine(name) {
  var t = lastDoneTask();
  if (!t) return say('There’s no finished Saga task in this chat to save yet. Ask Saga to do it once, then say “save '
    + 'this as a routine called …”.');
  return C.api('/browser/routines', { method: 'POST', body: { task_id: Number(t.id), name: name } }).then(function (d) {
    loadRoutines();
    return say('Saved the routine **' + esc(d.routine.name) + '** (' + d.routine.steps.length + ' steps). Say “'
      + esc(d.routine.name) + '” any time to run it again; risky steps will still ask you first.');
  }, function (e) { return say('I couldn’t save that routine: ' + esc((e && e.message) || 'try again') + '.'); });
}

function runRoutine(r) {
  if (sagaActive()) return say('Saga is still working on your last instruction. Wait for it, or say “stop”.');
  browseNative(r.goal, { chat: true, routineId: r.id });
  return say('Running your routine **' + esc(r.name) + '**. Saga follows the recorded steps and re-plans if a page '
    + 'changed.');
}

function list() {
  return Promise.all([C.api('/browser/schedules').catch(function () { return { schedules: [] }; }), loadRoutines()])
    .then(function (r) {
      var sch = r[0].schedules || [], rt = r[1] || [];
      return say('**Scheduled checks**\n' + (sch.length ? sch.map(function (s) { return '- ' + esc(s.name) + ' — '
        + esc(s.when) + (s.status === 'paused' ? ' _(paused)_' : ''); }).join('\n') : '_None yet._')
        + '\n\n**Routines**\n' + (rt.length ? rt.map(function (x) { return '- ' + esc(x.name) + ' (' + x.steps.length
        + ' steps)'; }).join('\n') : '_None yet._') + '\n\nManage them in Settings › Saga.');
    });
}

/** The composer's text: true when it was a schedule / routine request (handled here, kept in the thread). */
function handlePlanText(text) {
  if (!signedIn()) return false;
  var i = planIntent(text, S.routines);
  if (!i) return false;
  addThreadNote(text, { role: 'user', title: text }).then(function () {
    if (i.kind === 'schedule') return schedule(i.text);
    if (i.kind === 'save_routine') return saveRoutine(i.name);
    if (i.kind === 'run_routine') return runRoutine(i.routine);
    return list();
  }).catch(function (e) { C.toast((e && e.message) || 'That didn’t work. Try again.', 'bad'); });
  return true;
}

export { handlePlanText, loadRoutines };
