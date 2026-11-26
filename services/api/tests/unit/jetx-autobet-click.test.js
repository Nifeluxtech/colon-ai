// Colon JetX auto-bet (v0.38.0, Crash Predictor step 5): the isolated click script and the read-only manual-bet
// watcher the Android app injects into the game pane (apps/android/app/src/colonjetx/assets/jetx/: bet-find.js,
// autobet-click.js, manual-watch.js), plus static checks that the click only happens behind the app's gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const DIR = path.resolve(__dirname, '../../../../apps/android/app/src/colonjetx/assets/jetx');
const KT = path.resolve(__dirname, '../../../../apps/android/app/src/main/kotlin/ng/nifelux/colonai');
const Click = require(path.join(DIR, 'autobet-click.js'));
const Watch = require(path.join(DIR, 'manual-watch.js'));
const F = require(path.join(DIR, 'bet-find.js'));

// A tiny DOM: tag, children, own text, attributes; parent links; inputs keep a value; clicks are counted.
let clicks = 0;
function el(tag, kids = [], text = '', attrs = {}) {
  const node = { tagName: tag, children: kids, shadowRoot: null, parentElement: null, value: attrs.value || '',
    checked: attrs.checked, disabled: false, hidden: false, getAttribute: (a) => (attrs[a] ?? null),
    click() { clicks += 1; }, dispatchEvent() { return true; } };
  kids.forEach((k) => { k.parentElement = node; });
  Object.defineProperty(node, 'textContent', { get: () => text + node.children.map((k) => k.textContent).join('') });
  return node;
}
const input = (label, value, extra = {}) => el('INPUT', [], '', { 'aria-label': label, type: 'text', value, ...extra });
function game({ bet = true, auto = true, stake = true, autoToggle = null } = {}) {
  const panel = [];
  if (stake) panel.push(el('DIV', [input('Bet amount', '50')]));
  if (auto) {
    const row = [input('Auto cash out', '2.00')];
    if (autoToggle !== null) row.push(el('INPUT', [], '', { type: 'checkbox', checked: autoToggle }));
    panel.push(el('DIV', row));
  }
  panel.push(el('BUTTON', [], 'Cash out'));
  if (bet) panel.push(el('BUTTON', [el('SPAN', [], 'BET')], ''));
  return { body: el('BODY', [el('DIV', panel)]) };
}
const win = { HTMLInputElement: null, Event: function Event() {} };

test('probe touches nothing; bet sets the auto cash-out and stake, then presses Bet once', () => {
  clicks = 0;
  const doc = game();
  assert.deepEqual(Click.act(win, doc, { cmd: 'probe', nonce: '7' }), { ok: true, reason: 'ok' });
  assert.equal(clicks, 0);
  assert.equal(F.findAuto(doc).value, '2.00');
  const r = Click.act(win, doc, { cmd: 'bet', nonce: '7', target: 1.3, stake: 100 });
  assert.deepEqual(r, { ok: true, reason: 'ok' });
  assert.equal(F.findAuto(doc).value, '1.30');
  assert.equal(F.findStake(doc).value, '100');
  assert.equal(clicks, 1, 'one click on Bet, never on Cash out');
});

test('fail closed: missing Bet button, auto cash-out, stake field, auto off, or a bad command -> no click', () => {
  clicks = 0;
  const bet = { cmd: 'bet', nonce: '8', target: 1.3, stake: 100 };
  assert.equal(Click.act(win, game({ bet: false }), bet).reason, 'no_bet_button');
  assert.equal(Click.act(win, game({ auto: false }), bet).reason, 'no_auto_cashout');
  assert.equal(Click.act(win, game({ stake: false }), bet).reason, 'no_stake_input');
  assert.equal(Click.act(win, game({ autoToggle: false }), bet).reason, 'auto_cashout_off');
  assert.equal(Click.act(win, { body: el('BODY', [el('CANVAS')]) }, bet).reason, 'no_bet_button', 'a canvas game');
  for (const bad of [{ ...bet, nonce: 'x' }, { ...bet, target: 0.9 }, { ...bet, stake: 0 }, { ...bet, cmd: 'click' },
    null, 'bet']) {
    assert.equal(Click.act(win, game(), bad).reason, 'bad_command', JSON.stringify(bad));
  }
  assert.equal(clicks, 0);
});

test('install: says hello and does nothing else until the app sends a command', () => {
  clicks = 0;
  const sent = [];
  const port = { postMessage: (m) => sent.push(JSON.parse(m)), onmessage: null };
  Click.install({ ColonJetXBet: port, document: game(), HTMLInputElement: null, Event: function E() {} });
  assert.deepEqual(sent, [{ ready: true }]);
  assert.equal(clicks, 0);
  port.onmessage({ data: 'not json' });
  port.onmessage({ data: JSON.stringify({ cmd: 'bet', target: 1.3, stake: 100 }) }); // no nonce: ignored
  assert.equal(sent.length, 1);
  assert.equal(clicks, 0);
  port.onmessage({ data: JSON.stringify({ cmd: 'probe', nonce: '9' }) });
  assert.deepEqual(sent[1], { nonce: '9', ok: true, reason: 'ok', step: 'probe' });
  assert.equal(clicks, 0);
  port.onmessage({ data: JSON.stringify({ cmd: 'bet', nonce: '9', target: 1.3, stake: 100 }) });
  assert.deepEqual(sent[2], { nonce: '9', ok: true, reason: 'ok', step: 'bet' });
  assert.equal(clicks, 1);
});

test('manual watcher: reads stake and auto cash-out only, for a trusted tap on Bet', () => {
  const doc = game();
  assert.deepEqual(Watch.read(doc, 1000), { stake: 50, target: 2, at: 1000 });
  assert.deepEqual(Watch.read(game({ autoToggle: false }), 5), { stake: 50, target: null, at: 5 });
  assert.equal(Watch.read(game({ stake: false }), 5), null, 'no stake, nothing sent');
  const betBtn = el('BUTTON', [], 'Bet');
  assert.equal(Watch.betButtonOf([el('SPAN', [], 'Bet'), betBtn]), betBtn);
  assert.equal(Watch.betButtonOf([el('BUTTON', [], 'Cash out 130.00')]), null);
  let listener = null;
  const sent = [];
  const d2 = game();
  d2.addEventListener = (type, fn) => { listener = fn; };
  Watch.install({ ColonJetXManual: { postMessage: (m) => sent.push(JSON.parse(m)) }, document: d2 });
  listener({ isTrusted: false, composedPath: () => [betBtn] });
  assert.equal(sent.length, 0, 'a script click (Colon’s own auto-bet) is not a manual bet');
  listener({ isTrusted: true, composedPath: () => [betBtn] });
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0].manual).sort(), ['at', 'stake', 'target']);
});

test('static: the click script and watcher read no secrets; only act() clicks; watcher never clicks', () => {
  const click = fs.readFileSync(path.join(DIR, 'autobet-click.js'), 'utf8');
  const watch = fs.readFileSync(path.join(DIR, 'manual-watch.js'), 'utf8');
  const find = fs.readFileSync(path.join(DIR, 'bet-find.js'), 'utf8');
  for (const src of [click, watch, find]) {
    assert.doesNotMatch(src, /document\.cookie|localStorage|sessionStorage|indexedDB|type=["']?password/i);
    assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  }
  assert.equal((click.match(/\.click\(\)/g) || []).length, 1, 'exactly one click');
  const actBody = click.slice(click.indexOf('function act('), click.indexOf('function install('));
  assert.match(actBody, /\.click\(\)/);
  assert.ok(actBody.indexOf("cmd.cmd === 'probe'") < actBody.indexOf('.click()'), 'probe returns before any click');
  assert.doesNotMatch(watch, /\.click\(|setValue|\.value\s*=[^=]/);
  assert.doesNotMatch(find, /\.click\(|\.value\s*=[^=]/);
});

test('static: the app sends the bet command only right after its mayClick gate', () => {
  const kt = fs.readFileSync(path.join(KT, 'JetxAutobet.kt'), 'utf8');
  const uses = [...kt.matchAll(/clickJson\(/g)].map((m) => m.index);
  assert.equal(uses.length, 1, 'one place sends the bet command');
  const before = kt.slice(Math.max(0, uses[0] - 400), uses[0]);
  assert.match(before, /JetxAutobetRules\.mayClick\(c\.decision, prefs\.realMoney, prefs\.mode, prefs\.stopped\)/);
  const placed = kt.slice(kt.indexOf('private fun placed('), kt.indexOf('private fun onBetMessage('));
  assert.ok(placed.indexOf('if (d.demo)') < placed.indexOf('probeJson'), 'a demo bet returns before any probe');
  assert.ok(placed.indexOf('mayClick(') < placed.indexOf('probeJson'), 'the gate comes before the probe');
  const rules = fs.readFileSync(path.join(KT, 'JetxAutobetRules.kt'), 'utf8');
  assert.ok(rules.includes('d != null && d.allow && !d.demo && d.betId != null && realMoneyOn && !stopped && '
    + 'mode != JetxRules.Mode.MANUAL'));
});
