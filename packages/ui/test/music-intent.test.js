// Unit tests for apps/chat/src/lib/music-intent.js (Colon OS Assistant, Step 3): which chat messages are Colon Music
// commands. "play music" / "next song" stay Step 2 media keys; chat stays chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMusic, musicError } = require('../../../apps/chat/src/lib/music-intent.js');

const play = (query, source) => ({ action: 'play', query, source: source || 'any' });

test('"what song is this?" in its usual forms', () => {
  for (const t of ['What song is this?', 'what\'s this song', 'Hey Colon, what is this song playing?',
    'whats playing', 'shazam this song', 'who sings this', 'identify this track', 'what song is playing now?',
    'what\'s the name of this song?']) {
    assert.deepEqual(parseMusic(t), { action: 'identify' }, t);
  }
});

test('play a song: phone, then Jamendo, then YouTube; or a service by name', () => {
  assert.deepEqual(parseMusic('play Last Last by Burna Boy'), play('last last by burna boy'));
  assert.deepEqual(parseMusic('Hey Colon, play Essence'), play('essence'));
  assert.deepEqual(parseMusic('play calm down on YouTube'), play('calm down', 'youtube'));
  assert.deepEqual(parseMusic('play Ojuelegba on Audiomack.'), play('ojuelegba', 'audiomack'));
  assert.deepEqual(parseMusic('play the song Unavailable from my phone'), play('unavailable', 'phone'));
  assert.deepEqual(parseMusic('play my music'), play('*', 'phone'));
  assert.deepEqual(parseMusic('shuffle my songs'), play('*', 'phone'));
});

test('media keys, questions and chat are not music commands', () => {
  for (const t of ['play music', 'play the song', 'next song', 'pause', 'play', 'play a game with me',
    'play chess', 'can you play the guitar?', 'how do I play football?', 'tell me about this song',
    'play it safe', 'what is a song?', '']) {
    assert.equal(parseMusic(t), null, t);
  }
});

test('error codes have words', () => {
  assert.match(musicError('no_match'), /recognise/);
  assert.match(musicError('whatever'), /didn’t work/);
});
