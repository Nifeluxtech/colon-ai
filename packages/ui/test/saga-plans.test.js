// 0.11.0: schedules and routines from chat messages (apps/chat/src/lib/saga-plans.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { planIntent, tzOffset } = require('../../../apps/chat/src/lib/saga-plans.js');

const ROUTINES = [{ id: 3, name: 'Daily update' }];

test('scheduled checks need a time and a browsing verb', () => {
  const s = 'check yolotask every morning and tell me about new tasks';
  assert.deepEqual(planIntent(s, []), { kind: 'schedule', text: s });
  assert.equal(planIntent('look at jumia deals daily', []).kind, 'schedule');
  assert.equal(planIntent('I wake up every morning', []), null);
  assert.equal(planIntent('what is a routine?', []), null);
});

test('routines: save, run by name or by command, list', () => {
  assert.deepEqual(planIntent('save this as a routine called daily update', []),
    { kind: 'save_routine', name: 'daily update' });
  assert.deepEqual(planIntent('Daily update', ROUTINES), { kind: 'run_routine', routine: ROUTINES[0] });
  assert.deepEqual(planIntent('run my daily update routine', ROUTINES), { kind: 'run_routine', routine: ROUTINES[0] });
  assert.equal(planIntent('run the dishwasher', ROUTINES), null);
  assert.deepEqual(planIntent('show my routines', []), { kind: 'list' });
});

test('time zone offset is minutes east of UTC', () => {
  assert.equal(tzOffset({ getTimezoneOffset: () => -60 }), 60);
});
