// Unit tests for the Crash Predictor round collector API (v0.35.0, step 3): cleaning multipliers and times,
// dedupe (round id, derived id, the collector's 2-second window), CSV import, the collector session and the
// dashboard's collector status. In-memory store.
const test = require('node:test');
const assert = require('node:assert/strict');
const crash = require('../../src/modules/crash');
const R = crash.rounds;

const ada = { id: 1, name: 'Ada Obi', email: 'ada@example.com' };
const NOW = new Date(Date.UTC(2026, 10, 25, 12, 0, 0));
const ms = (s) => NOW.getTime() - s * 1000;   // s seconds ago
const make = (seed) => {
  const store = crash.memoryStore(seed);
  return { store, e: crash.create({ store, clock: () => NOW }) };
};

test('multiplierOf: 1.00x to 1,000,000x, at most 2 decimals, x suffix and comma decimals allowed', () => {
  const ok = [[1, 1], [1.3, 1.3], ['1.53', 1.53], ['1,53', 1.53], ['2.5x', 2.5], ['12.00 ×', 12], ['1000000', 1e6]];
  for (const [v, want] of ok) assert.equal(R.multiplierOf(v), want, String(v));
  for (const v of [0.99, '0.5', 1.234, '1.234', 1000000.01, '1e3', 'abc', '', null, true, NaN, Infinity, -2]) {
    assert.equal(R.multiplierOf(v), null, String(v));
  }
});

test('timeOf: ISO or epoch (ms or s); none -> null; too old, far future or junk -> NaN', () => {
  assert.equal(R.timeOf(undefined, NOW), null);
  assert.equal(R.timeOf('', NOW), null);
  assert.equal(R.timeOf(ms(10), NOW), ms(10));
  assert.equal(R.timeOf(Math.floor(ms(10) / 1000), NOW), Math.floor(ms(10) / 1000) * 1000);
  assert.equal(R.timeOf('2026-11-25 11:59:00', NOW), Date.parse('2026-11-25T11:59:00'));
  assert.ok(Number.isNaN(R.timeOf('2010-01-01T00:00:00Z', NOW)));
  assert.ok(Number.isNaN(R.timeOf(NOW.getTime() + 3600e3, NOW)));
  assert.ok(Number.isNaN(R.timeOf('yesterday', NOW)));
});

test('clean: bad rows say why; a round without an id gets a stable one from its time and multiplier', () => {
  assert.equal(R.clean({ multiplier: '0.9' }, { now: NOW }).reason, 'bad_multiplier');
  assert.equal(R.clean({ multiplier: 2, ended_at: 'soon' }, { now: NOW }).reason, 'bad_time');
  assert.equal(R.clean({ multiplier: 2, round_id: 'a b' }, { now: NOW }).reason, 'bad_round_id');
  assert.equal(R.clean({ multiplier: 2, round_id: 'x'.repeat(65) }, { now: NOW }).reason, 'bad_round_id');
  assert.equal(R.clean([1], { now: NOW }).reason, 'not_a_round');
  const a = R.clean({ multiplier: 1.53, seen_at: ms(5) }, { now: NOW }).round;
  const b = R.clean({ multiplier: '1.53x', seen_at: ms(5) }, { now: NOW }).round;
  assert.equal(a.round_id, b.round_id);
  assert.equal(a.round_id, `~t${ms(5)}x153`);
  assert.equal(a.given, false);
  const c = R.clean({ multiplier: 3, round_id: 'R-12345' }, { now: NOW, source: 'manual' }).round;
  assert.deepEqual([c.round_id, c.given, c.source, c.observed_at.getTime()], ['R-12345', true, 'manual',
    NOW.getTime()]);
});

test('POST /crash/rounds: stores, dedupes by round id and derived id, rejects bad rows, counts each', async () => {
  const { store, e } = make();
  const rounds = [{ multiplier: 1.53, seen_at: ms(30) }, { multiplier: 2.1, seen_at: ms(20), round_id: 'r2' },
    { multiplier: 'nope' }, { multiplier: 1.53, seen_at: ms(30) }, { multiplier: 1.02, seen_at: ms(10) }];
  const r1 = await e.addRounds(ada, { rounds, source: 'collector' });
  assert.deepEqual([r1.inserted, r1.duplicates, r1.rejected], [3, 1, 1]);
  assert.deepEqual(r1.errors, [{ index: 2, reason: 'bad_multiplier' }]);
  const r2 = await e.addRounds(ada, { rounds: rounds.slice(0, 2), source: 'collector' });   // a retry
  assert.deepEqual([r2.inserted, r2.duplicates, r2.rejected], [0, 2, 0]);
  assert.equal(store._s.rounds.length, 3);
  const other = await crash.create({ store, clock: () => NOW }).addRounds({ id: 2 }, { rounds: rounds.slice(0, 1) });
  assert.equal(other.inserted, 1, 'another user’s identical round is theirs');
});

test('collector window: the same multiplier within 2 s with no round id is one round (two frames)', async () => {
  const { e } = make();
  const a = await e.addRounds(ada, { rounds: [{ multiplier: 4.2, seen_at: ms(60) }] });
  const b = await e.addRounds(ada, { rounds: [{ multiplier: 4.2, seen_at: ms(60) + 800 },
    { multiplier: 4.2, seen_at: ms(50) }, { multiplier: 1.1, seen_at: ms(60) + 500 }] });
  assert.equal(a.inserted, 1);
  assert.deepEqual([b.inserted, b.duplicates], [2, 1]);
  const csv = await e.addRounds(ada, { rounds: [{ multiplier: 4.2, seen_at: ms(60) + 300 }], source: 'manual' });
  assert.equal(csv.inserted, 1, 'only the collector’s loose rounds use the window');
});

test('POST /crash/rounds: source, batch size and shape are checked', async () => {
  const { e } = make();
  await assert.rejects(e.addRounds(ada, { rounds: [{ multiplier: 2 }], source: 'feed' }), (x) => x.field === 'source');
  await assert.rejects(e.addRounds(ada, { rounds: [] }), (x) => x.status === 422 && x.field === 'rounds');
  await assert.rejects(e.addRounds(ada, { rounds: Array(101).fill({ multiplier: 2 }) }),
    (x) => x.code === 'too_many_rounds');
  assert.equal((await e.addRounds(ada, { multiplier: '2.00', source: 'manual' })).inserted, 1);
  await assert.rejects(e.addRounds(null, { multiplier: 2 }), (x) => x.status === 401);
});

test('collector rounds open the session once; start and stop are audited', async () => {
  const { store, e } = make();
  await e.addRounds(ada, { rounds: [{ multiplier: 2, seen_at: ms(5) }] });
  await e.addRounds(ada, { rounds: [{ multiplier: 3, seen_at: ms(1) }] });
  assert.equal(store._s.sessions.filter((s) => !s.ended_at).length, 1);
  const again = await e.startSession(ada);
  assert.equal(again.started, false);
  assert.equal(again.session.demo, true);
  assert.equal((await e.stopSession(ada, { reason: 'app_closed' })).stopped, true);
  assert.equal((await e.stopSession(ada)).stopped, false);
  assert.equal(store._s.sessions[0].end_reason, 'app_closed');
  assert.equal((await e.startSession(ada)).started, true);
  assert.deepEqual(store._s.audit.map((a) => a.event), ['session.started', 'session.stopped', 'session.started']);
  await e.addRounds(ada, { rounds: [{ multiplier: 5 }], source: 'manual' });
  assert.equal(store._s.audit.at(-1).event, 'rounds.manual');
});

test('CSV: header or none, separators, timeless rows dedupe on re-import, row cap', async () => {
  const p = R.parseCsv('1.53\n2.10,2026-11-25T11:00:00Z\n3,2026-11-25T11:01:00Z,R9\n', { now: NOW });
  assert.equal(p.rows.length, 3);
  assert.ok(p.rows[0].id.startsWith('~c'));
  assert.equal(p.rows[1].id, null);
  const h = R.parseCsv('Round ID;Time;Crash\nA1;2026-11-25 10:00:00;1,25\n', { now: NOW });
  assert.deepEqual(h.rows[0].row, { multiplier: '1,25', ended_at: '2026-11-25 10:00:00', round_id: 'A1' });
  assert.throws(() => R.parseCsv('', { now: NOW }), (x) => x.status === 422);
  assert.throws(() => R.parseCsv('time,round\n1,2', { now: NOW }), (x) => /multiplier column/.test(x.message));
  assert.throws(() => R.parseCsv(Array(5001).fill('2.00').join('\n'), { now: NOW }), (x) => x.code === 'too_many_rows');

  const { store, e } = make();
  const text = 'multiplier,time\n1.20\n1.20\n5.55x\nbad\n2.00,2026-11-25T11:30:00Z\n';
  const a = await e.importCsv(ada, { csv: text });
  assert.deepEqual([a.rows, a.inserted, a.duplicates, a.rejected], [5, 4, 0, 1]);
  assert.deepEqual(a.errors, [{ line: 5, reason: 'bad_multiplier' }]);
  const b = await e.importCsv(ada, { csv: text });
  assert.deepEqual([b.inserted, b.duplicates, b.rejected], [0, 4, 1]);
  assert.ok(store._s.rounds.every((r) => r.source === 'csv'));
  assert.equal(store._s.audit.filter((x) => x.event === 'rounds.imported').length, 2);
  await assert.rejects(e.importCsv(ada, {}), (x) => x.status === 422);
});

test('dashboard: collector live, idle or off, with today’s collected rounds and the last multiplier', async () => {
  const { store, e } = make();
  assert.deepEqual((await e.dashboard(ada)).collector, { status: 'off', rounds_today: 0, last_multiplier: null,
    last_round_at: null });
  await e.addRounds(ada, { rounds: [{ multiplier: 1.8, seen_at: ms(30) }, { multiplier: 2.4, seen_at: ms(20) }] });
  await e.importCsv(ada, { csv: '9.99,2026-11-25T11:00:00Z' });
  const d = await e.dashboard(ada);
  assert.deepEqual([d.collector.status, d.collector.rounds_today, d.collector.last_multiplier],
    ['live', 2, 2.4]);
  assert.equal(d.today.hit_rate.rounds, 3);
  assert.ok(d.session);
  assert.equal(d.verdict.action, 'WAIT');
  const later = crash.create({ store, clock: () => new Date(NOW.getTime() + 10 * 60e3) });
  assert.equal((await later.dashboard(ada)).collector.status, 'idle');
  await later.stopSession(ada);
  assert.equal((await later.dashboard(ada)).collector.status, 'off');
});
