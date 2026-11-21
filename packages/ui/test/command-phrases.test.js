// Table-driven tests for apps/chat/src/lib/command-phrases.js (0.22.1): the one phrase matcher for watch, play and
// player commands, typed or spoken. Each row: what the user says -> what Colon does (null = normal chat).
const test = require('node:test');
const assert = require('node:assert/strict');
const { dockWord, matchCommand, normalize, playLast } = require('../../../apps/chat/src/lib/command-phrases.js');
const { parseMusic } = require('../../../apps/chat/src/lib/music-intent.js');

const W = (query) => ({ action: 'watch', query });
const P = (query, source) => ({ action: 'play', query, source: source || 'any' });

const WATCH = [
  ['watch Davido live', W('davido live')],
  ['Watch Burna Boy at the O2.', W('burna boy at the o2')],
  ["let's watch Funke Akindele comedy", W('funke akindele comedy')],
  ['lets watch the Super Eagles highlights', W('the super eagles highlights')],
  ['I want to watch Last Last', W('last last')],
  ['I wanna watch Rema live', W('rema live')],
  ['Can I watch Calm Down?', W('calm down')],
  ['can you show me Wizkid Essence', W('wizkid essence')],
  ['show me the video of Ojuelegba', W('ojuelegba')],
  ['Show me Unavailable video', W('unavailable')],
  ['show me the Love Nwantiti music video', W('love nwantiti')],
  ['put on Mr Bean', W('mr bean')],
  ['play the video of Calm Down', W('calm down')],
  ['play Essence video', W('essence')],
  ['play the music video for Essence', W('essence')],
  ['open Davido interview on YouTube', W('davido interview')],
  ['find how to make jollof rice on youtube', W('how to make jollof rice')],
  ["I'd like to watch Nollywood movies 2026", W('nollywood movies 2026')],
  ['let me watch Arsenal highlights', W('arsenal highlights')],
  ['search YouTube for Asake Lonely at the Top', W('asake lonely at the top')],
  ['Hey Colon, watch how to tie a tie on YouTube', W('how to tie a tie')],
  ['Um, can you watch Rema interview, please?', W('rema interview')],
  ['WATCH TIWA SAVAGE LIVE', W('tiwa savage live')],
  ['watch the video of Kizz Daniel Buga', W('kizz daniel buga')],
  ['could you show me the Shallipopi video', W('shallipopi')],
  ['ok colon let me watch Davido, thanks', W('davido')],
];

const PLAY = [
  ['play Last Last by Burna Boy', P('last last by burna boy')],
  ["let's play Essence", P('essence')],
  ['I want to listen to Ojuelegba', P('ojuelegba')],
  ['put on Calm Down song', P('calm down')],
  ['can you play Unavailable', P('unavailable')],
  ['Can you play Unavailable?', P('unavailable')],
  ['please play Water by Tyla', P('water by tyla')],
  ['listen to Asake', P('asake')],
  ['play calm down on YouTube', P('calm down', 'youtube')],
  ['play Ojuelegba on Audiomack.', P('ojuelegba', 'audiomack')],
  ['play the song Unavailable from my phone', P('unavailable', 'phone')],
  ['play my music', P('*', 'phone')],
  ['shuffle my songs', P('*', 'phone')],
  ['Hey Colon, play Essence', P('essence')],
  ['uh play, um, Rush by Ayra Starr', P('rush by ayra starr')],
  ['I wanna hear Mnike', P('mnike')],
];

const CHAT = [
  'watch out', 'Watch out!', 'what should I watch?', 'watch your words', 'I watched Davido yesterday',
  'watch my back', 'watch it', 'watch over me', 'watch yourself', 'can I watch this later?',
  'show me how to cook rice', 'watch', 'what to watch tonight', 'watch the kids for me', 'watch a movie',
  'play music', 'play the song', 'next song', 'pause', 'play', 'play a game with me', 'play chess',
  'can you play the guitar?', 'how do I play football?', 'tell me about this song', 'play it safe',
  'what is a song?', '', 'play the video', 'listen to me', 'watch your step', 'can you show me wifi settings',
  'is it ok to watch tv at night?', 'I was watching Netflix', 'who watches the watchmen',
];

test('normalize: lower case, no punctuation, no wake word or filler', () => {
  assert.equal(normalize('Um, Hey Colon, can you PLAY Essence, please?'), 'can you play essence');
  assert.equal(normalize("Let's watch... Davido!!"), 'lets watch davido');
  assert.equal(normalize('  uh   play  it  now '), 'play it');
});

test('watch phrases (typed or spoken) play a YouTube video in the card', () => {
  for (const [said, want] of WATCH) assert.deepEqual(parseMusic(said), want, said);
});

test('music phrases play a song (the phone first, then the card)', () => {
  for (const [said, want] of PLAY) assert.deepEqual(parseMusic(said), want, said);
});

test('non-intents stay normal chat', () => {
  for (const said of CHAT) assert.equal(parseMusic(said), null, said);
});

test('identify phrases', () => {
  for (const said of ["what's this song?", 'Whats playing', 'who is singing this', 'shazam this', 'what song is this',
    'Hey Colon, what is this song playing?']) assert.deepEqual(matchCommand(said), { action: 'identify' }, said);
});

test('player words while the card plays', () => {
  const rows = [['Pause.', 'pause'], ['pause the video', 'pause'], ['resume', 'resume'], ['keep playing', 'resume'],
    ['skip forward', 'forward'], ['fast forward', 'forward'], ['rewind', 'back'], ['go back', 'back'],
    ['stop the video', 'stop'], ['Stop the music, please', 'stop'], ['what is next?', null], ['next', null],
    ['stop talking about it', null]];
  for (const [said, want] of rows) assert.equal(dockWord(said), want, said);
});

test('"play it" after Colon named a song', () => {
  for (const said of ['play it', 'Play that.', 'play that song', 'Hey Colon, play it now']) {
    assert.equal(playLast(said), true, said);
  }
  for (const said of ['put it on', 'play it safe', 'play that game', 'play it?', 'play Essence']) {
    assert.equal(playLast(said), false, said);
  }
});

test('the table covers at least 60 cases', () => {
  assert.ok(WATCH.length + PLAY.length + CHAT.length >= 60);
});
