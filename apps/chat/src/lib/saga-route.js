/* Colon AI · 0.11.6: where a message typed while a Saga task is live goes. Owner's report (Android 0.11.5): Saga
   waited on the Colon Secured Login form, and "Login n" and "Hi" typed meanwhile got no reply at all (each was only
   queued for "Saga's next step", which never came). Now:
   - Saga waits for the user (the login form, a hand-over, Take control, a pause): the message is a normal chat turn
     (the chat model knows Saga is waiting and can explain it), except the few words that drive Saga: "continue",
     "login", "try again", "I've saved it"… give the browser back (return_to_ai); "stop" / "cancel" stop it.
   - Saga is working: the message steers its next step (guide), and the thread says so.
   Pure and DOM-free: unit-tested in packages/ui/test/saga-route.test.js.

   routeTyped(text, ctx) -> null (no live task: the usual path) | { kind: 'resume', note } | { kind: 'stop' } |
     { kind: 'chat', waiting } | { kind: 'guide' }
   ctx: { task: the live task's id (or null), waiting: null | { kind: 'login' | 'user' | 'paused', site } }
   waitingOf(run, polled) -> what Saga waits for, from the app's card state (run: browser('state').run) and the
     server's task status (polled: { status, kind, site } from GET /browser/agent/:id), whichever knows first. */

import { clean } from './browser-intent.js';

function whole(list) { return new RegExp('^(?:' + list.join('|') + ')$'); }
var RESUME = whole(['continue', 'carry on', 'go on', 'go ahead', 'keep going', 'resume', 'proceed', 'try again',
  'retry', 'again', 'return to ai', 'back to you', 'your turn', 'done', 'i\'?m done', 'all done', 'ok,? continue',
  'you can continue', 'log ?in', 'login', 'sign ?in', 'log me in', 'sign me in', 'log ?in now', 'sign ?in now',
  '(?:log|sign) ?in (?:again|with (?:it|my (?:saved )?login))', 'use (?:it|my (?:saved )?login|the saved login)',
  'saved', 'it\'?s saved', 'login saved', '(?:i(?:\'ve| have)? )?saved (?:it|the login|my login|the password|it now)',
  'i(?:\'ve| have) (?:saved|added|entered) (?:it|the login|my login|my details)', 'signed in', 'logged in',
  'i(?:\'m| am) (?:signed|logged) in', 'i(?:\'ve| have) (?:signed|logged) in', 'entered', 'i(?:\'ve| have) entered it',
  '(?:i(?:\'ve| have) )?(?:saved|signed in|logged in),? (?:continue|carry on|go on|go ahead)']);
var STOP = whole(['stop', 'stop it', 'stop saga', 'stop browsing', 'stop the task', 'cancel', 'cancel it',
  'cancel that', 'cancel the task', 'cancel the login', 'never ?mind', 'forget it', 'quit', 'abort']);
var WAITING = ['handoff', 'user_control', 'paused'];

/** "Login n" (a stray letter at the end, a typo on a phone keyboard) reads as "login". */
function words(text) {
  var t = clean(text);
  return { t: t, loose: t.replace(/\s+\S$/, '') };
}

function routeTyped(text, ctx) {
  ctx = ctx || {};
  if (!ctx.task) return null;
  var w = words(text);
  if (!w.t) return null;
  if (!ctx.waiting) return { kind: 'guide' };
  if (STOP.test(w.t)) return { kind: 'stop' };
  if (RESUME.test(w.t) || (w.loose !== w.t && RESUME.test(w.loose))) return { kind: 'resume',
    note: String(text || '').trim().slice(0, 300) };
  return { kind: 'chat', waiting: ctx.waiting };
}

function waitingOf(run, polled) {
  run = run || {}; polled = polled || {};
  var req = run.request || {};
  if (run.state === 'needs_user' || (run.state === 'user_control' && run.resumes)) {
    return { kind: req.kind === 'login' || polled.kind === 'login' ? 'login' : 'user', site: polled.site || '' };
  }
  if (run.state === 'paused') return { kind: 'paused', site: '' };
  if (WAITING.indexOf(polled.status) >= 0) {
    return { kind: polled.status === 'paused' ? 'paused' : polled.kind === 'login' ? 'login' : 'user',
      site: polled.site || '' };
  }
  return null;
}

/** The thread's line for a message sent while Saga works (not only a toast). */
function guideNote() { return '_Saga will take this into account at its next step._'; }

export { RESUME, STOP, guideNote, routeTyped, waitingOf };
