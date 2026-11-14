// Unit tests for apps/chat/src/lib/card-chrome.js (0.11.2): what the browser card in the thread shows around the
// page (header, buttons, status line), a finished run's summary row and its steps; and that past runs keep their
// cards (lib/saga-card.js layout and webCard).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ch = require('../../../apps/chat/src/lib/card-chrome.js');
const { layout, webCard } = require('../../../apps/chat/src/lib/saga-card.js');

test('domainOf and faviconOf: the site itself, no www, never a third-party icon service', () => {
  assert.equal(ch.domainOf('https://www.Jumia.com.ng/catalog?q=x'), 'jumia.com.ng');
  assert.equal(ch.domainOf('http://yolotask.com.ng:8080/a'), 'yolotask.com.ng');
  assert.equal(ch.domainOf('about:blank'), '');
  assert.equal(ch.domainOf(null), '');
  assert.equal(ch.faviconOf('https://www.jumia.com.ng/x/y'), 'https://www.jumia.com.ng/favicon.ico');
  assert.equal(ch.faviconOf('http://example.com/'), '');      // only https: no mixed content in the chat page
  assert.equal(ch.faviconOf(''), '');
});

test('titleOf: a short, one-line, capitalised task title; a fallback when there is no goal', () => {
  assert.equal(ch.titleOf('search for  yolotask\nearners'), 'Search for yolotask earners');
  const long = ch.titleOf('compare the prices of '.repeat(10));
  assert.ok(long.length <= 60 && long.endsWith('…'), long);
  assert.equal(ch.titleOf(''), 'Saga’s browser');
});

test('statusOf: every run state maps to one live status', () => {
  const m = { running: 'working', needs_user: 'waiting', paused: 'paused', user_control: 'yours', done: 'done',
    error: 'error', stopped: 'error', idle: 'idle' };
  for (const [state, want] of Object.entries(m)) assert.equal(ch.statusOf({ state }), want, state);
  assert.equal(ch.statusOf(null), 'idle');
});

test('liveChrome: the header, one status line and only the buttons that apply now', () => {
  const st = { url: 'https://www.jumia.com.ng/p', run: { state: 'running', goal: 'find a phone', pill: { text:
    'Opening  the\nsearch page' } } };
  assert.deepEqual(ch.liveChrome(st), { domain: 'jumia.com.ng', favicon: 'https://www.jumia.com.ng/favicon.ico',
    title: 'Find a phone', status: 'working', line: 'Opening the search page',
    controls: ['expand', 'take', 'pause', 'stop'] });
  // Full screen: minimise instead of expand.
  assert.deepEqual(ch.liveChrome({ ...st, focus: true }).controls, ['minimise', 'take', 'pause', 'stop']);
  // The user holds the page: give it back; paused: resume; waiting on the user: no take (the card asks already).
  assert.deepEqual(ch.liveChrome({ run: { state: 'user_control' } }).controls, ['expand', 'give', 'stop']);
  assert.deepEqual(ch.liveChrome({ run: { state: 'paused' } }).controls, ['expand', 'take', 'resume', 'stop']);
  assert.deepEqual(ch.liveChrome({ run: { state: 'needs_user' } }).controls, ['expand', 'stop']);
  // Finished: no pause or stop; the step line falls back to run.step.
  const done = ch.liveChrome({ run: { state: 'done', step: 'Found 3 phones' } });
  assert.deepEqual([done.controls, done.line, done.status], [['expand', 'take'], 'Found 3 phones', 'done']);
});

test('liveChrome: an idle browser invites a task; nothing known still draws a card', () => {
  const idle = ch.liveChrome({});
  assert.equal(idle.status, 'idle');
  assert.equal(idle.line, 'Tell Saga what to do in this browser.');
  assert.equal(idle.domain, '');
  assert.equal(idle.title, 'Saga’s browser');
  assert.equal(ch.liveChrome({ run: { state: 'running' } }).line, '');   // working, no step yet: an empty line
});

test('summaryOf: "Done · N steps", the outcome, the site and the result', () => {
  const s = ch.summaryOf({ state: 'done', steps: 5, url: 'https://www.jumia.com.ng/x', goal: 'buy rice',
    result: 'Added rice to the cart' });
  assert.deepEqual(s, { domain: 'jumia.com.ng', favicon: 'https://www.jumia.com.ng/favicon.ico',
    text: 'Done · 5 steps', status: 'done', title: 'Buy rice', result: 'Added rice to the cart' });
  assert.equal(ch.summaryOf({ state: 'done', steps: 1 }).text, 'Done · 1 step');
  assert.equal(ch.summaryOf({ state: 'done' }).text, 'Done');
  assert.equal(ch.summaryOf({ state: 'stopped', steps: 2 }).text, 'Stopped · 2 steps');
  assert.equal(ch.summaryOf({ state: 'stopped' }).status, 'error');
  assert.deepEqual([ch.summaryOf({ state: 'error' }).text, ch.summaryOf({ state: 'error' }).status],
    ['Couldn’t finish', 'error']);
  assert.deepEqual([ch.summaryOf({ state: 'running' }).text, ch.summaryOf({ state: 'running' }).status],
    ['Working', 'working']);
  assert.equal(ch.summaryOf(null).domain, 'Saga’s browser');
  assert.ok(ch.summaryOf({ state: 'done', result: 'x '.repeat(200) }).result.length <= 120);
});

test('stepsOf: only actions and reads, numbered, with their site and outcome', () => {
  const steps = ch.stepsOf([
    { kind: 'plan', say: 'Thinking' },
    { kind: 'action', say: 'Open jumia', url: 'https://www.jumia.com.ng/', ok: 1 },
    { kind: 'extract', tool: 'read_page', url: 'https://www.jumia.com.ng/p', ok: 0 },
    { kind: 'action', approved: 'user' }, null]);
  assert.deepEqual(steps, [
    { n: 1, text: 'Open jumia', host: 'jumia.com.ng', ok: true, approved: null },
    { n: 2, text: 'read_page', host: 'jumia.com.ng', ok: false, approved: null },
    { n: 3, text: 'Step', host: '', ok: true, approved: 'user' }]);
  assert.deepEqual(ch.stepsOf(null), []);
});

test('past runs keep their cards: a long chat keeps every run, the newest live one hides only its own', () => {
  const msgs = Array.from({ length: 50 }, (_, i) => ({ id: 'm' + i }));
  const cards = Array.from({ length: 200 }, (_, i) => ({ id: String(i), anchor: 'm' + (i % 50), at: i + 1 }));
  const all = layout(msgs, cards, null, null).flatMap((g) => g.items);
  assert.equal(all.length, 200);
  // The live browser takes over the newest run's message: that run's picture goes, every older one stays.
  const live = layout(msgs, cards, { anchor: 'm49', at: 500, replaces: true }, 'new').flatMap((g) => g.items);
  assert.equal(live.filter((i) => i.kind === 'snap').length, 199);
  assert.ok(!live.some((i) => i.kind === 'snap' && i.card.id === '199'));
  assert.ok(live.some((i) => i.kind === 'snap' && i.card.id === '149'));      // an older run under the same message
});

test('webCard carries the server\'s step count for the summary row', () => {
  assert.equal(webCard({ id: 4, status: 'done', steps: 6 }, 'ok').steps, 6);
  assert.equal(webCard({ id: 4, status: 'done' }, 'ok').steps, 0);
});

test('the chat page styles every part of the card chrome', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../apps/chat/public/assets/css/chat-saga-card.css'), 'utf8');
  for (const cls of ['cw-saga-head', 'cw-saga-fav', 'cw-saga-ico', 'cw-saga-dot', 'cw-saga-domain', 'cw-saga-title',
    'cw-saga-btns', 'cw-saga-btn', 'cw-saga-line', 'cw-saga-row', 'cw-saga-sum', 'cw-saga-shot', 'cw-saga-steps']) {
    assert.ok(css.includes('.' + cls), cls);
  }
  // Nothing floats over the page any more: the old dark pill and corner button are gone.
  assert.ok(!css.includes('.cw-saga-pill') && !css.includes('.cw-saga-open'));
  // The favicon is not stretched to the picture's size (only the shot is 16:10).
  assert.ok(!/\.cw-saga-card img\b/.test(css));
});
