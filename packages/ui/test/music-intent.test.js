// Unit tests for apps/chat/src/lib/music-intent.js (Colon OS Assistant, Step 3): which chat messages are Colon Music
// commands. "play music" / "next song" stay Step 2 media keys; chat stays chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const { dockWord, parseMusic, musicError, playLast } = require('../../../apps/chat/src/lib/music-intent.js');

const play = (query, source) => ({ action: 'play', query, source: source || 'any' });

test('"what song is this?" in its usual forms', () => {
  for (const t of ['What song is this?', 'what\'s this song', 'Hey Colon, what is this song playing?',
    'whats playing', 'shazam this song', 'who sings this', 'identify this track', 'what song is playing now?',
    'what\'s the name of this song?']) {
    assert.deepEqual(parseMusic(t), { action: 'identify' }, t);
  }
});

test('play a song: phone, then the YouTube player; or a service by name', () => {
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
  assert.match(musicError('handed_off'), /Shazam/);
});

test('player words while Colon\'s YouTube player is open', () => {
  assert.equal(dockWord('Pause'), 'pause');
  assert.equal(dockWord('pause the music.'), 'pause');
  assert.equal(dockWord('Hey Colon, resume'), 'resume');
  assert.equal(dockWord('forward'), 'forward');
  assert.equal(dockWord('Skip ahead.'), 'forward');
  assert.equal(dockWord('fast forward'), 'forward');
  assert.equal(dockWord('back'), 'back');
  assert.equal(dockWord('Rewind'), 'back');
  assert.equal(dockWord('go back'), 'back');
  assert.equal(dockWord('stop the music'), 'stop');
  assert.equal(dockWord('close the player'), 'stop');
  for (const t of ['play Essence', 'stop talking about it', 'what is next?', 'next', 'next song', 'skip this one',
    'go back to the last topic', '']) assert.equal(dockWord(t), null, t);
});

test('watch a video (0.22.0): any YouTube video, never the phone', () => {
  const watch = (query) => ({ action: 'watch', query });
  assert.deepEqual(parseMusic('watch Davido live at the O2'), watch('davido live at the o2'));
  assert.deepEqual(parseMusic('Hey Colon, watch how to tie a tie on YouTube'), watch('how to tie a tie'));
  assert.deepEqual(parseMusic('show me the video of Last Last'), watch('last last'));
  assert.deepEqual(parseMusic('play the video of Calm Down'), watch('calm down'));
  assert.deepEqual(parseMusic('play the music video for Essence'), watch('essence'));
  assert.deepEqual(parseMusic('can you watch Rema interview'), watch('rema interview'));
  for (const t of ['watch out', 'Watch out!', 'what should I watch?', 'watch my back', 'watch it', 'watch over me',
    'watch yourself', 'can I watch this later?', 'show me how to cook rice', 'watch', 'what to watch tonight',
    'watch the kids for me', 'watch a movie']) {
    assert.equal(parseMusic(t), null, t);
  }
  assert.deepEqual(parseMusic('play Essence'), play('essence'));
});

test('"play it" after Colon named a song', () => {
  for (const t of ['play it', 'Play that.', 'play that song', 'Hey Colon, play it now', 'put it on']) {
    assert.equal(playLast(t), t !== 'put it on', t);
  }
  for (const t of ['play it safe', 'play that game', 'play it?', 'play Essence', '']) {
    assert.equal(playLast(t), false, t);
  }
});
