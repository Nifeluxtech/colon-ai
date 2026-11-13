// Who drives a chat's browser (Phases 8-10): the control-owner rules of the WebSocket bridge, pure so they are
// tested on their own (tests/unit/browser-control.test.js). Modes: manual (the user), ai (Saga drives, the user
// watches: the owner's "AI only") and shared (both act at once and Saga sees the user's changes: "AI + me").
// Exactly one owner; ai/shared only after the phone's consent on this socket; the user's take_control, handoff,
// pause, stop and declined win at once.
//
// next(reason, row, { mode, consented }) -> { next: { control, control_owner, paused, task? } | null, consented,
//   cancel (pending Saga commands end with manual_control), error? }
const MODES = ['ai', 'shared'];
const owner = (control) => (control === 'manual' ? 'user' : 'saga');

function next(reason, row, o = {}) {
  const r = row || { control: 'manual', paused: 0 };
  const mode = MODES.includes(o.mode) ? o.mode : 'ai';
  const was = Boolean(o.consented);
  const out = (n, consented = was, cancel = false) => ({ next: n, consented, cancel });
  switch (reason) {
    case 'consent': return out({ control: mode, control_owner: 'saga', paused: false }, true);
    case 'return_to_ai':
      if (!was) return { next: null, consented: was, cancel: false, error: 'needs_consent' };
      return out({ control: mode, control_owner: 'saga', paused: false });
    case 'declined': case 'stop':
      return out({ control: 'manual', control_owner: 'user', paused: false, task: '' }, false, true);
    // handoff (Phase 10): Saga reached a password, code, card or sign-in field and handed the page to the user. Like
    // take_control, consent is kept so the user's Return to AI resumes the same task.
    case 'take_control': case 'handoff':
      return out({ control: 'manual', control_owner: 'user', paused: Boolean(r.paused) }, was, true);
    case 'pause': return out({ control: r.control, control_owner: owner(r.control), paused: true }, was, true);
    case 'resume': return out({ control: r.control, control_owner: owner(r.control), paused: false });
    // mode (Phase 10): the user switched this chat between "AI only" and "AI + me" while Saga had control. It never
    // gives Saga control it didn't have: in manual (or without consent) only the preference changes on the phone.
    case 'mode':
      if (!was || r.control === 'manual' || !MODES.includes(o.mode)) return out(null);
      return out({ control: mode, control_owner: 'saga', paused: Boolean(r.paused) });
    default: return { next: null, consented: was, cancel: false, error: 'bad_control' };
  }
}

module.exports = { next, owner, MODES };
