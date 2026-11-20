// Colon Music (OS Assistant Step 3): Jamendo search keeps only real matches on jamendo.com, and is off without a
// client id. No network: fetch is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const music = require('../../src/modules/music');

const track = (o) => Object.assign({ id: 1, name: 'Night Drive', artist_name: 'Lagos Lights', album_name: 'Roads',
  audio: 'https://prod-1.storage.jamendo.com/?trackid=1&format=mp32', image: '',
  shareurl: 'https://jamendo.com/t/1' }, o);
const fetchOf = (results, seen) => async (url) => {
  if (seen) seen.push(url);
  return { ok: true, json: async () => ({ results }) };
};

test('off without JAMENDO_CLIENT_ID', async () => {
  delete process.env.JAMENDO_CLIENT_ID;
  await assert.rejects(music.search('night drive', { fetch: fetchOf([]) }), { code: 'music_off', status: 503 });
});

test('every word must match; only jamendo.com streams; client id sent', async () => {
  process.env.JAMENDO_CLIENT_ID = 'abc';
  const seen = [];
  const out = await music.search('Night Drive by Lagos Lights', { fetch: fetchOf([
    track(),
    track({ id: 2, name: 'Night Walk' }),
    track({ id: 3, audio: 'https://evil.example/a.mp3' }),
  ], seen) });
  assert.deepEqual(out.map((t) => t.id), ['1']);
  assert.equal(out[0].artist, 'Lagos Lights');
  assert.match(seen[0], /client_id=abc/);
  assert.match(seen[0], /search=Night\+Drive/);
  delete process.env.JAMENDO_CLIENT_ID;
});

test('a mainstream song with no real Jamendo match comes back empty', async () => {
  process.env.JAMENDO_CLIENT_ID = 'abc';
  const out = await music.search('last last burna boy', { fetch: fetchOf([track({ name: 'Last Dance' })]) });
  assert.deepEqual(out, []);
  assert.equal(music.matches('beyonce halo', { name: 'Halo', artist_name: 'Beyoncé' }), true);
  await assert.rejects(music.search('  ', { fetch: fetchOf([]) }), { code: 'bad_query' });
  delete process.env.JAMENDO_CLIENT_ID;
});
