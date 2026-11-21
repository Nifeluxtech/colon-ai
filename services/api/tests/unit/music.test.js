// Colon Music (YouTube since 0.21.0): the search keeps embeddable videos with real ids, is off without a key, caches
// answers, and reports a used-up quota. No network: fetch is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const music = require('../../src/modules/music');

const thumb = (id) => ({ high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } });
const item = (id, title, channel) => ({ id: { kind: 'youtube#video', videoId: id },
  snippet: { title, channelTitle: channel, thumbnails: thumb(id) } });
const fetchOf = (items, seen, status = 200) => async (url) => {
  if (seen) seen.push(url);
  return { ok: status === 200, status, json: async () => ({ items }) };
};

test('off without YOUTUBE_API_KEY', async () => {
  delete process.env.YOUTUBE_API_KEY;
  await assert.rejects(music.search('last last', { fetch: fetchOf([]) }), { code: 'music_off', status: 503 });
});

test('maps videos, drops bad ids, asks for embeddable music in Nigeria', async () => {
  process.env.YOUTUBE_API_KEY = 'k1';
  music._cache.clear();
  const seen = [];
  const out = await music.search('Last Last Burna Boy', { fetch: fetchOf([
    item('421w1j87fEM', 'Burna Boy - Last Last [Official Music Video]', 'Burna Boy'),
    item('bad id', 'x', 'y'),
    item('abcdefghijk', 'Tom &amp; Jerry&#39;s song', 'Someone - Topic'),
  ], seen) });
  assert.deepEqual(out.map((t) => t.id), ['421w1j87fEM', 'abcdefghijk']);
  assert.equal(out[1].title, 'Tom & Jerry\'s song');
  assert.equal(out[1].channel, 'Someone');
  assert.equal(out[0].link, 'https://www.youtube.com/watch?v=421w1j87fEM');
  assert.match(seen[0], /videoEmbeddable=true/);
  assert.match(seen[0], /videoCategoryId=10/);
  assert.match(seen[0], /regionCode=NG/);
  assert.match(seen[0], /key=k1/);
  delete process.env.YOUTUBE_API_KEY;
});

test('caches by query, quota errors are music_busy, empty query rejected', async () => {
  process.env.YOUTUBE_API_KEY = 'k1';
  music._cache.clear();
  const seen = [];
  await music.search('Calm Down', { fetch: fetchOf([item('abcdefghijk', 'Calm Down', 'Rema')], seen) });
  await music.search('calm  down', { fetch: fetchOf([], seen) });
  assert.equal(seen.length, 1);
  await assert.rejects(music.search('essence', { fetch: fetchOf([], null, 403) }), { code: 'music_busy' });
  await assert.rejects(music.search('  ', { fetch: fetchOf([]) }), { code: 'bad_query' });
  delete process.env.YOUTUBE_API_KEY;
});

test('kind=video drops the music category and caches apart from music', async () => {
  process.env.YOUTUBE_API_KEY = 'k1';
  music._cache.clear();
  const seen = [];
  await music.search('cat videos', { fetch: fetchOf([item('abcdefghijk', 'Cats', 'Pets')], seen), kind: 'video' });
  assert.doesNotMatch(seen[0], /videoCategoryId/);
  assert.match(seen[0], /videoEmbeddable=true/);
  await music.search('cat videos', { fetch: fetchOf([], seen) });
  assert.equal(seen.length, 2);
  assert.match(seen[1], /videoCategoryId=10/);
  await music.search('Cat Videos', { fetch: fetchOf([], seen), kind: 'video' });
  await music.search('cat videos', { fetch: fetchOf([], seen), kind: 'weird' });
  assert.equal(seen.length, 2);
  delete process.env.YOUTUBE_API_KEY;
});
