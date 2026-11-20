// Unit tests for apps/chat/src/lib/phone-intent.js (Colon OS Assistant, Step 2): which chat messages are phone
// commands. Narrow on purpose: questions, chat and browser instructions stay null.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePhone, parseTime, parseDuration, phoneNumber } = require('../../../apps/chat/src/lib/phone-intent.js');

const app = (name, extra) => Object.assign({ action: 'open_app', name, soft: true }, extra || {});

test('open an app by name; "app" is remembered; settings pages win over app names', () => {
  assert.deepEqual(parsePhone('open WhatsApp'), app('whatsapp'));
  assert.deepEqual(parsePhone('Hey Colon, launch the Opay app'), app('opay', { app: true }));
  assert.deepEqual(parsePhone('please open my calculator'), app('calculator'));
  assert.deepEqual(parsePhone('open settings'), { action: 'settings', page: 'main' });
  assert.deepEqual(parsePhone('open wifi settings'), { action: 'settings', page: 'wifi' });
  assert.deepEqual(parsePhone('bluetooth settings'), { action: 'settings', page: 'bluetooth' });
  assert.deepEqual(parsePhone('open bluetooth'), { action: 'settings', page: 'bluetooth' });
  assert.deepEqual(parsePhone('open the camera'), { action: 'camera' });
  assert.deepEqual(parsePhone('take a selfie'), { action: 'camera' });
});

test('browser, chat and questions are not phone commands', () => {
  for (const t of ['open the browser', 'open google.com', 'open a new chat', 'open this page',
    'open the second result', 'open it', 'how do I open WhatsApp?', 'what is the volume of a sphere',
    'next', 'continue', 'stop', 'stop it', 'open whatsapp and send hi to tunde', 'write me an essay about music',
    'call me maybe the best song ever written by anyone']) {
    assert.equal(parsePhone(t), null, t);
  }
});

test('torch, toggles and volume', () => {
  assert.deepEqual(parsePhone('turn on the torch'), { action: 'torch', on: true });
  assert.deepEqual(parsePhone('flashlight off'), { action: 'torch', on: false });
  assert.deepEqual(parsePhone('switch the flash light off'), { action: 'torch', on: false });
  assert.deepEqual(parsePhone('turn on wifi'), { action: 'settings', page: 'wifi', toggle: 'on' });
  assert.deepEqual(parsePhone('disable bluetooth'), { action: 'settings', page: 'bluetooth', toggle: 'off' });
  assert.deepEqual(parsePhone('turn off mobile data'), { action: 'settings', page: 'data', toggle: 'off' });
  assert.deepEqual(parsePhone('volume up'), { action: 'volume', op: 'up' });
  assert.deepEqual(parsePhone('turn it down'), { action: 'volume', op: 'down' });
  assert.deepEqual(parsePhone('set the volume to 40%'), { action: 'volume', op: 'set', level: 40 });
  assert.deepEqual(parsePhone('volume 70 percent'), { action: 'volume', op: 'set', level: 70 });
  assert.equal(parsePhone('volume 400'), null);
  assert.deepEqual(parsePhone('max volume'), { action: 'volume', op: 'max' });
  assert.deepEqual(parsePhone('mute'), { action: 'volume', op: 'mute' });
  assert.deepEqual(parsePhone('unmute the phone'), { action: 'volume', op: 'unmute' });
});

test('music controls', () => {
  assert.deepEqual(parsePhone('pause the music'), { action: 'media', op: 'pause' });
  assert.deepEqual(parsePhone('pause'), { action: 'media', op: 'pause' });
  assert.deepEqual(parsePhone('resume the song'), { action: 'media', op: 'play' });
  assert.deepEqual(parsePhone('next song'), { action: 'media', op: 'next' });
  assert.deepEqual(parsePhone('skip this track'), { action: 'media', op: 'next' });
  assert.deepEqual(parsePhone('previous song'), { action: 'media', op: 'previous' });
});

test('calls and texts open the dialler or Messages with the number; names are not supported yet', () => {
  assert.deepEqual(parsePhone('call 0803 123 4567'), { action: 'dial', number: '08031234567' });
  assert.deepEqual(parsePhone('dial +234-803-123-4567'), { action: 'dial', number: '+2348031234567' });
  assert.equal(parsePhone('call mum').action, 'unsupported');
  assert.deepEqual(parsePhone('text 08031234567 saying I am on my way'),
    { action: 'sms', number: '08031234567', body: 'i am on my way' });
  assert.deepEqual(parsePhone('send a message to 0803 123 4567'), { action: 'sms', number: '08031234567', body: '' });
});

test('alarms, timers and directions', () => {
  assert.deepEqual(parsePhone('set an alarm for 6:30 am'), { action: 'alarm', hour: 6, minute: 30 });
  assert.deepEqual(parsePhone('wake me up at 7pm'), { action: 'alarm', hour: 19, minute: 0 });
  assert.deepEqual(parsePhone('set alarm for 12 am'), { action: 'alarm', hour: 0, minute: 0 });
  assert.equal(parsePhone('set an alarm for whenever').action, 'unsupported');
  assert.deepEqual(parsePhone('set a timer for 5 minutes'), { action: 'timer', seconds: 300 });
  assert.deepEqual(parsePhone('timer for 1 hour and 30 minutes'), { action: 'timer', seconds: 5400 });
  assert.deepEqual(parsePhone('ten minute timer'), { action: 'timer', seconds: 600 });
  assert.deepEqual(parsePhone('navigate to Ikeja City Mall'), { action: 'navigate', place: 'ikeja city mall' });
  assert.deepEqual(parsePhone('get me directions to the airport'), { action: 'navigate', place: 'the airport' });
});

test('time, duration and number helpers', () => {
  assert.deepEqual(parseTime('6.30pm'), { hour: 18, minute: 30 });
  assert.deepEqual(parseTime('19:05'), { hour: 19, minute: 5 });
  assert.deepEqual(parseTime('noon'), { hour: 12, minute: 0 });
  assert.equal(parseTime('25:00'), null);
  assert.equal(parseTime('13 pm'), null);
  assert.equal(parseDuration('half an hour'), 1800);
  assert.equal(parseDuration('90 seconds'), 90);
  assert.equal(parseDuration('two minutes'), 120);
  assert.equal(parseDuration('a while'), null);
  assert.equal(phoneNumber('0803 123 4567'), '08031234567');
  assert.equal(phoneNumber('mum'), null);
});
