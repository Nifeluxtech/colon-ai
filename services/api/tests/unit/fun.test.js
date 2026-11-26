// Unit tests for Colon's fun side (0.37.0): the tone rule, stickers in the prompt and the app's matching list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const prompts = require('../../src/modules/ai/prompts');
const fun = require('../../src/modules/ai/fun');
const store = require('../../src/modules/chat/store');

const APP = path.join(__dirname, '../../../../apps/chat');

test('fun: general prompt follows the user and lists stickers', () => {
  const p = prompts.systemPrompt({ mode: 'general' });
  assert.match(p, /Tone: match the user/);
  assert.match(p, /\[sticker:<id>\]/);
  assert.match(p, /omo \(Omo!\)/);
});

test('fun: plain in Developer mode, voice and when switched off', () => {
  for (const o of [{ mode: 'developer' }, { mode: 'general', voice: true }, { mode: 'general', fun: false }]) {
    assert.doesNotMatch(prompts.systemPrompt(o), /Stickers:/);
  }
});

test('fun: titles and previews read stickers as words', () => {
  assert.equal(store.titleFrom('[sticker:omo]'), 'Sticker: Omo!');
  assert.equal(store.previewFrom('Na so!\n\n[sticker:laugh]'), 'Na so!');
  assert.equal(fun.plain('[sticker:nope]'), '');
});

test('fun: every sticker has its picture and the app list matches the API list', () => {
  const src = fs.readFileSync(path.join(APP, 'src/lib/stickers.js'), 'utf8');
  const app = [...src.matchAll(/\['([a-z]+)', '((?:[^'\\]|\\.)*)'\]/g)].map((m) => [m[1], m[2].replace(/\\'/g, '\'')]);
  assert.deepEqual(app, Object.entries(fun.STICKERS));
  for (const id of Object.keys(fun.STICKERS)) {
    assert.ok(fs.existsSync(path.join(APP, 'public/assets/stickers/fluent', `${id}.webp`)), id);
  }
});
