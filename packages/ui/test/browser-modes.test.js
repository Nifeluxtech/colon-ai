// Phase 10: a chat's browser mode (AI only / AI + me / Manual), the card's chip and menu, and one browser session
// per conversation (apps/chat/src/lib/browser-modes.js), plus a small model of the app's side (ChatBrowserPanel's
// showChat / forgetChat with ChatSessionRules) to check a chat's browser survives switching and dies with the chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../../apps/chat/src/lib/browser-modes.js');

test('chatMode: the chat\'s own mode, else the Settings default, else AI only', () => {
  assert.equal(M.chatMode({ id: 'c1', browser_mode: 'shared' }, { browserMode: 'ai' }), 'shared');
  assert.equal(M.chatMode({ id: 'c1', browser_mode: null }, { browserMode: 'shared' }), 'shared');
  assert.equal(M.chatMode({ id: 'c1', browser_mode: 'nonsense' }, {}), 'ai');
  assert.equal(M.chatMode(null, null), 'ai');
  assert.equal(M.modeLabel('ai'), 'AI only');
  assert.equal(M.modeLabel('shared'), 'AI + me');
});

test('chip: Saga\'s mode, Manual after Take control, "Your turn" with the handoff prompt, else the chat\'s', () => {
  assert.deepEqual(M.chip({ control: 'ai' }, 'shared'), { state: 'ai', label: 'AI only', paused: false, prompt: '',
    canReturn: false });
  assert.equal(M.chip({ control: 'shared', paused: true }, 'ai').label, 'AI + me · paused');
  const h = M.chip({ control: 'manual', resumable: 'ai', handoff: { kind: 'password',
    message: 'Enter your password here, then tap Return to AI.' } }, 'ai');
  assert.equal(h.state, 'manual');
  assert.equal(h.label, 'Your turn');
  assert.equal(h.prompt, 'Enter your password here, then tap Return to AI.');
  assert.equal(h.canReturn, true);
  assert.deepEqual(M.chip({ control: 'manual', resumable: 'shared' }, 'ai'), { state: 'manual', label: 'Manual',
    paused: false, prompt: '', canReturn: true });
  assert.equal(M.chip({ control: 'manual' }, 'shared').label, 'AI + me');
  // The app's own record of the chat's mode wins over the page's (it may have been changed in the panel).
  assert.equal(M.chip({ control: 'manual', chatMode: 'shared' }, 'ai').label, 'AI + me');
});

test('menu: both modes (current checked), Take control while Saga drives, Return to AI when it can', () => {
  const idle = M.menu({ control: 'manual' }, 'shared');
  assert.deepEqual(idle.map((i) => [i.op, i.mode || '', !!i.checked]), [['mode', 'ai', false],
    ['mode', 'shared', true]]);
  assert.deepEqual(M.menu({ control: 'ai' }, 'shared').map((i) => i.op), ['mode', 'mode', 'take_control']);
  assert.equal(M.menu({ control: 'ai' }, 'shared').find((i) => i.checked).mode, 'ai');
  assert.deepEqual(M.menu({ control: 'manual', resumable: 'ai' }, 'ai').map((i) => i.op), ['mode', 'mode',
    'return_to_ai']);
});

test('sessionKey: a conversation\'s own browser; a new chat (or one still loading a temp id) has none', () => {
  assert.equal(M.sessionKey({ id: 'k3Jd9' }), 'k3Jd9');
  assert.equal(M.sessionKey(null), null);
  assert.equal(M.sessionKey({ id: 'tmp-1' }), null);
  assert.equal(M.sessionKey({}), null);
});

test('chatCall: tells the app only when the chat changes; a just-created chat adopts its browser', () => {
  assert.deepEqual(M.chatCall(undefined, null), { conversation_id: '', adopt: false });
  assert.equal(M.chatCall(null, null), null);
  assert.deepEqual(M.chatCall(null, 'c1', { created: true }), { conversation_id: 'c1', adopt: true });
  assert.deepEqual(M.chatCall(null, 'c1', { created: false }), { conversation_id: 'c1', adopt: false });
  assert.equal(M.chatCall('c1', 'c1'), null);
  assert.deepEqual(M.chatCall('c1', 'c2', { created: true }), { conversation_id: 'c2', adopt: false });
  assert.deepEqual(M.chatCall('c2', null), { conversation_id: '', adopt: false });
});

/* ---- A model of the app (ChatBrowserPanel 0.10.0: showChat / forgetChat, LRU of ChatSessionRules) ---- */
function app(max = 3) {
  const s = { key: 'draft-1', n: 1, order: [], tabs: {}, profiles: new Set(['draft-1']) };
  const draft = () => `draft-${++s.n}`;
  const touch = (k) => { s.order = [k, ...s.order.filter((x) => x !== k)];
    for (const gone of s.order.slice(max)) { delete s.tabs[gone]; s.profiles.delete(gone); }
    s.order = s.order.slice(0, max); };
  const switchTo = (k) => { if (s.key.startsWith('draft-')) { delete s.tabs[s.key]; s.profiles.delete(s.key); }
    s.key = k; s.profiles.add(k); touch(k); };
  return {
    s,
    open(url) { (s.tabs[s.key] = s.tabs[s.key] || []).push(url); },
    chat({ conversation_id: id, adopt }) {
      const k = id || null;
      if (k && k === s.key) return;
      if (k && adopt && s.key.startsWith('draft-')) { s.tabs[k] = s.tabs[s.key]; delete s.tabs[s.key];
        s.profiles.delete(s.key); s.profiles.add(k); s.key = k; touch(k); return; }
      if (!k && s.key.startsWith('draft-') && !(s.tabs[s.key] || []).length) return;
      switchTo(k || draft());
    },
    forget(id) { if (id === s.key) switchTo(draft()); delete s.tabs[id]; s.profiles.delete(id);
      s.order = s.order.filter((x) => x !== id); },
  };
}

test('model: each chat keeps its own tabs; a new chat is clean; its first message adopts the browser', () => {
  const a = app();
  let sent;
  const show = (id, created) => { const c = M.chatCall(sent, id, { created }); if (c) { sent = id || null;
    a.chat(c); } };
  show(null);
  a.open('https://www.jumia.com.ng/');               // "open jumia" on a new chat: the chat is created first
  show('c1', true);
  assert.deepEqual(a.s.tabs.c1, ['https://www.jumia.com.ng/']);
  show('c2');                                         // another chat from the sidebar: its own (empty) browser
  assert.equal(a.s.tabs.c2, undefined);
  a.open('https://punchng.com/');
  show('c1');
  assert.deepEqual(a.s.tabs.c1, ['https://www.jumia.com.ng/']);
  show(null);                                         // New chat: clean
  assert.ok(a.s.key.startsWith('draft-'));
  assert.equal(a.s.tabs[a.s.key], undefined);
  show('c2');
  assert.deepEqual(a.s.tabs.c2, ['https://punchng.com/']);
  a.forget('c2');                                     // deleting the chat deletes its browser
  assert.equal(a.s.tabs.c2, undefined);
  assert.ok(!a.s.profiles.has('c2'));
  assert.ok(a.s.key.startsWith('draft-'));
});

test('model: only the most recently used chats keep a browser', () => {
  const a = app(2);
  for (const id of ['c1', 'c2', 'c3']) { a.chat({ conversation_id: id }); a.open(`https://${id}.ng/`); }
  assert.deepEqual(a.s.order, ['c3', 'c2']);
  assert.equal(a.s.tabs.c1, undefined);
  assert.ok(!a.s.profiles.has('c1'));
});
