// 0.22.1: apps/chat/src/lib/command-replies.js, Colon's short replies to commands (shown in the thread, spoken in
// voice mode). Two or three wordings per action; failures have their own.
const test = require('node:test');
const assert = require('node:assert/strict');
const { appName, reply, variants } = require('../../../apps/chat/src/lib/command-replies.js');

test('"take me to WhatsApp" -> "I’ll take you to WhatsApp now."', () => {
  assert.equal(reply('open_app', { name: 'whatsapp' }, 0), 'I’ll take you to WhatsApp now.');
  assert.equal(reply('open_app', { name: 'whatsapp', label: 'WhatsApp Business' }, 1),
    'Opening WhatsApp Business for you.');
  assert.equal(reply('open_app_missing', { name: 'whatsapp' }, 0), 'I couldn’t find WhatsApp on this phone.');
  assert.equal(appName('my bank app'), 'My Bank App');
});

test('every action has 2 or 3 wordings, and they take turns', () => {
  const data = { name: 'x', page: 'wifi', on: true, op: 'pause', number: '0803', hour: 6, minute: 30, seconds: 300,
    place: 'Ikeja', title: 'Essence', service: 'YouTube', what: 'Essence by Wizkid', say: 'Volume at 40%.' };
  for (const k of ['open_app', 'open_app_missing', 'settings', 'camera', 'torch', 'volume', 'media', 'dial', 'sms',
    'alarm', 'timer', 'navigate', 'play', 'watch', 'open_service', 'not_found_video', 'not_found_song',
    'embed_blocked', 'finding', 'pause', 'resume', 'forward', 'back', 'stop', 'identified', 'handed_off', 'miss',
    'give_up']) {
    const n = variants(k, data);
    assert.ok(n >= 2 && n <= 3, k + ' has ' + n);
    const seen = new Set([reply(k, data), reply(k, data), reply(k, data)]);
    assert.ok(seen.size >= 2, k + ' repeats itself');
  }
});

test('details are in the words', () => {
  assert.equal(reply('alarm', { hour: 18, minute: 5 }, 0), 'Alarm set for 6:05 PM.');
  assert.equal(reply('timer', { seconds: 5400 }, 0), 'Timer set for 1 hour 30 minutes.');
  assert.equal(reply('settings', { page: 'bluetooth', toggle: 'on' }, 0),
    'Here’s the Bluetooth switch. Tap it to turn it on.');
  assert.equal(reply('settings', { page: 'main' }, 0), 'Opening settings.');
  assert.equal(reply('identified', { what: 'Essence by Wizkid' }, 1), 'Sounds like Essence by Wizkid.');
  assert.equal(reply('failed', { say: 'Android didn’t allow that.' }), 'Android didn’t allow that.');
});
