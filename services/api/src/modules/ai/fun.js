// 0.37.0: Colon's fun side. The tone follows the user (playful when they are, plain when they are not) and Colon
// may answer with one of the app's stickers, written as [sticker:<id>] (apps/chat/src/lib/stickers.js draws them).
// The ids and meanings here must match the app's list (tests/unit/fun.test.js checks that).
const STICKERS = {
  laugh: 'Lmao', rofl: 'I don die', omo: 'Omo!', correct: 'Correct!', wahala: 'Wahala', echoke: 'E choke!',
  sapa: 'Sapa', novex: 'No vex', oya: 'Oya!', gbasgbos: 'Gbas gbos', love: 'Love you die', thanks: 'Thank you',
  welldone: 'Well done', odogwu: 'Odogwu', hmm: 'Hmm', abeg: 'Abeg', sleep: 'I don sleep', chai: 'Chai',
  wemove: 'We move!', hundred: '100%', mindblown: 'Mind blown', sure: 'Shey you sure?', hug: 'Hug', wink: 'You know',
  dead: 'I\'m dead', strong: 'Strong', aww: 'Aww', gist: 'Gist', cashout: 'Cashout', chop: 'Make we chop',
  morning: 'Good morning', night: 'Good night', books: 'Read your book', star: 'Star', eyes: 'I dey look',
  howfar: 'How far', okay: 'Okay', melt: 'I don melt', yessir: 'Yes sir', winner: 'Winner',
};
const TOKEN = /\[sticker:([a-z]+)\]/g;

// Modes and moments where Colon stays plain: Developer, voice replies (read aloud), and Fun set to Off.
function funRule({ mode = 'general', voice = false, fun = true } = {}) {
  if (fun === false || voice || mode === 'developer') return '';
  const list = Object.entries(STICKERS).map(([id, say]) => `${id} (${say})`).join(', ');
  return [
    ('Tone: match the user. When they are playful (jokes, banter, slang, Naijá, emoji, "lol", or a sticker), be '
      + 'playful back: warm, witty, a light joke or Naija expression, celebrate their wins. When they are plain, '
      + 'formal or brief, stay friendly and plain. When the topic is serious (health, money trouble, grief, exams '
      + 'stress, safety) be calm and kind, with no jokes and no stickers. Never let fun make the answer less useful.'),
    ('Stickers: a user message that is only [sticker:<id>] is a sticker they sent; react to what it means. You may '
      + 'add ONE sticker to a reply, on its own line at the end, only when the user is playful or sent a sticker '
      + 'first and it truly fits; most replies have none. Never in code, tables, quizzes or serious topics, and '
      + `never invent an id. Write it exactly as [sticker:<id>]. Stickers: ${list}.`),
  ].join('\n');
}

// Text without sticker tokens (titles, read-aloud, search), or the sticker's meaning when that is all there is.
function plain(text) {
  const s = String(text || '');
  const only = /^\s*\[sticker:([a-z]+)\]\s*$/.exec(s);
  if (only) return STICKERS[only[1]] ? `(sticker: ${STICKERS[only[1]]})` : '';
  return s.replace(TOKEN, '').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { STICKERS, funRule, plain };
