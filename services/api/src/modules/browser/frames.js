// What Saga says to the user on the phone's page (0.10.2, docs/android-bridge.md "Notices"). In "AI + me" the app
// shows Saga's one-line explanation of each step (the command frame's `say`) and the server's `notice` frames
// ("Done. Saga's answer is in the chat.") as a pill at the top of the browser that fades by itself. Pure.
// 0.10.3: `error` and `stopped` end a task that did not finish (the phone's status pill shows them as such; older
// apps read any unknown kind as `step`). note(): the user's words when they give the browser back to Saga.
const MAX = 160;
const KINDS = ['step', 'ask', 'done', 'error', 'stopped'];
const MAX_NOTE = 500;
// Secrets the user might mention while handing back ("the code was 552019", "password: hunter2"): never kept.
const SECRET_WORD = new RegExp(String.raw`\b(password|passcode|passwd|pin|otp|one[- ]time code|code|cvv|cvc|token)\b`
  + String.raw`(\s*(?:is|was|:|=)?\s*)\S+`, 'gi');

/** One short line for a phone screen: no control characters, spaces collapsed, at most 160 characters. */
const line = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, MAX);

/** The command frame's extra field: { say } or {} when there is nothing to say. */
function say(v) {
  const t = line(v);
  return t ? { say: t } : {};
}

/** The notice frame (kind step · ask · done), or null for an empty line. conv: the chat's id, if any. */
function notice(text, kind, conv) {
  const t = line(text);
  if (!t) return null;
  return { type: 'notice', text: t, kind: KINDS.includes(kind) ? kind : 'step', ...(conv ? { conversation_id: conv }
    : {}) };
}

/** The user's hand-back message, for the model: one line, at most 500 characters, secrets and long digit runs
 *  (codes, card numbers) hidden. '' when there is nothing. */
function note(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, MAX_NOTE)
    .replace(SECRET_WORD, '$1$2[hidden]').replace(/\d[\d -]{3,}\d/g, (m) => (m.replace(/\D/g, '').length >= 6
      ? '[number hidden]' : m));
}

module.exports = { line, say, notice, note, KINDS, MAX, MAX_NOTE };
