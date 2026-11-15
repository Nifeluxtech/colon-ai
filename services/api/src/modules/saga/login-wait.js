// 0.11.6 (owner's report, Android 0.11.5): Saga asked for a login (signIn answered no_login, loop.js / saved-login.js
// hand the Colon Secured Login form over, kind 'login'); the user filled and SAVED the form, yet Saga stayed stuck
// for SAGA_HANDOFF_TIMEOUT_MS because the phone's Give back never left it. The phone now always gives back after the
// form; this is the server's safety net: while the task waits on the form, a login saved on the phone through any
// path the bridge sees (control `login_saved {site}`, or a "Login saved for …" note on any control frame, also one
// that arrived just before the wait began) ends the wait. When Saga lost control meanwhile it asks for it again the
// usual way (control request; the phone's consent stands for this chat's own task).
//   saved(link, since, task, L) -> 'return_to_ai' (the wait ends) | null (keep waiting)
const { frames } = require('../browser');

const EARLY_MS = 60000;                     // a save this long before the wait began still counts

async function saved(link, since, task, L) {
  const st = (link.bridge && link.bridge.state) || {};
  if (!since || !(st.loginSaved >= since - EARLY_MS)) return null;
  st.loginSaved = 0;
  // The note the loop reads (saved-login.js SAVED_NOTE): the phone's own, else a generic one.
  if (!frames.SAVED.test(st.note || '')) st.note = 'Login saved for this site in Colon Secured Login';
  if (await link.bridge.hasControl()) return 'return_to_ai';
  const answered = link.waitControl(L.approvalTimeoutMs);
  const asked = await link.bridge.askControl(task.mode === 'shared' ? 'shared' : 'ai', task.goal,
    { conversation: task.conversation_id || null });
  if (!asked) return null;
  const r = await answered;
  return ['consent', 'return_to_ai', 'login_saved'].includes(r) ? 'return_to_ai' : null;
}

/** After a login wait ends (any way): a saved flag it didn't use must not end the next one. */
function done(link) { if (link.bridge && link.bridge.state) link.bridge.state.loginSaved = 0; }

module.exports = { saved, done, EARLY_MS };
