// What Saga says to the user on the phone's page (0.10.2, docs/android-bridge.md "Notices"). In "AI + me" the app
// shows Saga's one-line explanation of each step (the command frame's `say`) and the server's `notice` frames
// ("Done. Saga's answer is in the chat.") as a pill at the top of the browser that fades by itself. Pure.
const MAX = 160;
const KINDS = ['step', 'ask', 'done'];

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

module.exports = { line, say, notice, KINDS, MAX };
