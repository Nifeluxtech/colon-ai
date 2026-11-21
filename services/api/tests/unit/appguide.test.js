// Unit tests for the app guide (0.24.0): docs/app-guide.md parses into sections with keys, app-help questions are
// told apart from everyday ones, the right sections are picked, the client's platform and version reach the
// context, and a chat reply's extra context carries it.
const test = require('node:test');
const assert = require('node:assert/strict');
const guide = require('../../src/modules/appguide');
const extra = require('../../src/modules/chat/extra-context');

const titles = (text) => guide.pick(text).map((s) => s.title);

test('docs/app-guide.md: every section has keys and a body; the settings paths are there', () => {
  guide.load(null);
  const all = guide.sections();
  assert.ok(all.length >= 15, `${all.length} sections`);
  for (const s of all) {
    assert.ok(s.keys.length > 0, `${s.title} has keys`);
    assert.doesNotMatch(s.body, /<!--/);
  }
  const body = all.map((s) => s.body).join('\n');
  assert.match(body, /Settings › Voice › \*\*Hey Colon\*\*/);
  assert.match(body, /Settings › Memory and projects › \*\*Memory\*\*/);
  assert.match(body, /Display over other apps/);
  assert.match(body, /Auto-start management/);
});

test('app-help detection: questions about Colon itself, not everyday how-tos', () => {
  for (const t of ['How do I turn on Hey Colon?', 'where is the setting for memory', 'Hey Colon no dey work',
    'how do i stop infinix from killing colon in the background', 'How do I update the app?',
    'how to turn on dark mode', 'Why is the voice pill not showing over other apps?', 'where do I find saga routines',
    'How can I make Colon call me Elijah', 'how do I delete my account']) {
    assert.equal(guide.isAppHelp(t), true, t);
  }
  for (const t of ['How do I cook jollof rice?', 'How do I improve my memory for exams?',
    'What is the capital of Kenya?', 'how do I solve 2x + 3 = 7', 'My nickname is Elijah', '']) {
    assert.equal(guide.isAppHelp(t), false, t);
  }
});

test('section selection: the best matches, the settings map only when nothing else fits', () => {
  assert.deepEqual(titles('How do I turn on Hey Colon?'), ['Hey Colon (wake word)']);
  assert.deepEqual(titles('where is the setting for memory'), ['Memory']);
  assert.deepEqual(titles('how to turn on dark mode'), ['Language, theme and text size']);
  assert.match(titles('my tecno phone keeps killing colon, how do I allow auto-start')[0], /^Auto-start/);
  assert.deepEqual(titles('where are the settings in this app?'), ['Settings: where things are']);
  assert.ok(guide.pick('how do I turn on voice mode, hey colon, music, memory and projects').length <= 3);
});

test('context: the guide sections, exact-path instructions and the client\'s platform and version', () => {
  const block = guide.contextFor({ text: 'How do I turn on Hey Colon?', client: { platform: 'android',
    version: '0.23.0', web_version: '0.24.0' } });
  assert.match(block, /^The user is asking how to use the Colon AI app/);
  assert.match(block, /exact path/);
  assert.match(block, /Android app v0\.23\.0 \(chat v0\.24\.0\)/);
  assert.match(block, /### Hey Colon \(wake word\)\nAndroid app only/);
  assert.equal(guide.contextFor({ text: 'How do I cook jollof rice?' }), '');
  assert.match(guide.contextFor({ text: 'how do I turn on memory' }), /app and version are unknown/);
  assert.deepEqual(guide.client({ platform: 'android', version: '1.0<script>' }), { platform: 'android',
    version: null, web_version: null });
  assert.equal(guide.client({ platform: 'toaster' }), null);
});

test('a missing guide is never fatal', () => {
  guide.load('');
  assert.equal(guide.contextFor({ text: 'How do I turn on Hey Colon?' }), '');
  guide.load('## Only\n<!-- keys: hey colon -->\nSettings › Voice › Hey Colon.');
  assert.match(guide.contextFor({ text: 'How do I turn on Hey Colon?' }), /### Only\nSettings › Voice/);
  guide.load(null);
});

test('a reply\'s extra context adds the guide for signed-in chats and guests', async () => {
  const mem = { contextFor: async () => ({ block: '', ids: [] }) };
  const r = await extra.build({ user: { id: 1 }, conv: { id: 'c1', project_id: null }, text: 'How do I turn on Hey '
    + 'Colon?', client: { platform: 'web', version: '0.24.0' }, deps: { memory: mem, projects: { contextFor:
    async () => null } } });
  assert.match(r.block, /Colon web app v0\.24\.0[\s\S]*### Hey Colon/);
  const g = await extra.build({ user: null, conv: null, text: 'where is the setting for memory' });
  assert.match(g.block, /### Memory/);
  const none = await extra.build({ user: { id: 1 }, conv: { id: 'c1' }, text: 'Tell me a joke', deps: { memory: mem,
    projects: { contextFor: async () => null } } });
  assert.equal(none.block, '');
});
