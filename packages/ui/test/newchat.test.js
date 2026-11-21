// Unit tests for the 0.24.0 new chat page: the intro animation's play-or-poster choice
// (apps/chat/src/lib/welcome-intro.js), the attach sheet's items and file-input settings
// (apps/chat/src/lib/attach-options.js), and that the assets and styles they need ship.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { WelcomeIntro } = require('../../../apps/chat/src/lib/welcome-intro.js');
const { AttachOptions } = require('../../../apps/chat/src/lib/attach-options.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const keys = (o) => AttachOptions.attachItems(o).map((i) => i.key);

test('the intro plays once per new chat; reduced motion, a replay or data saver show the poster', () => {
  assert.equal(WelcomeIntro.introMode({}), 'play');
  assert.equal(WelcomeIntro.introMode(), 'play');
  assert.equal(WelcomeIntro.introMode({ reducedMotion: true }), 'poster');
  assert.equal(WelcomeIntro.introMode({ played: true }), 'poster', 'a re-render never replays it');
  assert.equal(WelcomeIntro.introMode({ saveData: true }), 'poster');
});

test('the intro assets ship as WebP under 300 KB (no GIF), and the poster is the small first paint', () => {
  const dir = 'apps/chat/public/';
  const anim = fs.statSync(path.join(ROOT, dir, WelcomeIntro.SRC)).size;
  const poster = fs.statSync(path.join(ROOT, dir, WelcomeIntro.POSTER)).size;
  assert.ok(anim < 300 * 1024, 'animation ' + anim + ' bytes');
  assert.ok(poster < 60 * 1024, 'poster ' + poster + ' bytes');
  const head = fs.readFileSync(path.join(ROOT, dir, WelcomeIntro.SRC)).subarray(0, 40).toString('latin1');
  assert.match(head, /^RIFF....WEBPVP8X/s);
  assert.equal(fs.readdirSync(path.join(ROOT, dir, 'assets/img')).filter((f) => /\.gif$/i.test(f)).length, 0);
  assert.ok(WelcomeIntro.PLAY_MS >= 3000 && WelcomeIntro.PLAY_MS <= 5000);
});

test('the attach sheet lists Camera, Photos, Files; Repository only in a project chat with a hook', () => {
  assert.deepEqual(keys(), ['camera', 'photos', 'files']);
  assert.deepEqual(keys({ project: true }), ['camera', 'photos', 'files'], 'no hook, no Repository');
  assert.deepEqual(keys({ repoHook: () => {} }), ['camera', 'photos', 'files'], 'not a project chat');
  assert.deepEqual(keys({ project: true, repoHook: () => {} }), ['camera', 'photos', 'files', 'repository']);
  AttachOptions.attachItems({ project: true, repoHook: () => {} }).forEach((it) => {
    assert.ok(it.label && it.icon, it.key + ' has a label and an icon');
  });
});

test('each item sets up the file input: camera captures, photos are images, files keep the accepted list', () => {
  const accept = 'image/png,application/pdf,.docx';
  assert.deepEqual(AttachOptions.pickerAttrs('camera', accept),
    { accept: 'image/*', capture: 'environment', multiple: false });
  assert.deepEqual(AttachOptions.pickerAttrs('photos', accept), { accept: 'image/*', capture: null, multiple: true });
  assert.deepEqual(AttachOptions.pickerAttrs('files', accept), { accept, capture: null, multiple: true });
  assert.deepEqual(AttachOptions.pickerAttrs(undefined, accept), { accept, capture: null, multiple: true });
  const input = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  AttachOptions.apply(input, 'camera', accept);
  assert.deepEqual([input.accept, input.multiple, input.attrs.capture], ['image/*', false, 'environment']);
  AttachOptions.apply(input, 'files', accept);
  assert.deepEqual([input.accept, input.multiple, input.attrs.capture], [accept, true, undefined],
    'Files after Camera no longer captures');
});

test('the new chat page: animation instead of the flame, the shortcut list above the message box', () => {
  const chat = read('apps/chat/src/components/welcome.js'), composer = read('apps/chat/src/components/composer.js');
  const css = read('apps/chat/public/assets/css/chat-layout.css');
  assert.ok(!/cw-hero-mark|cw-prompts/.test(chat), 'the flame and the four cards are gone');
  assert.match(chat, /What can we explore today\?/);
  assert.match(composer, /cw-start-list[\s\S]*cw-welcome-modes[\s\S]*cw-input/, 'list, then chips, then the box');
  assert.match(css, /\[data-view="welcome"\] \.cw-starters\{display:flex\}/, 'only a new chat shows the list');
  assert.match(css, /\.cw-intro\{[^}]*mask-image/, 'the animation fades into the page');
  assert.match(icons(), /camera:/);
});
function icons() { return read('packages/ui/js/colon/icons.js'); }
