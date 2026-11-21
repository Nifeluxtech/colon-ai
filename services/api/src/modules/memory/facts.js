// Personal facts in a chat message (0.24.0): what Colon saves on its own when the user turned memory on, so
// "My nickname is Elijah" or "Always call me Elijah" is remembered without "remember that …". Pure, no database.
//
//   extract(text)   -> [{ kind, content }]: one note per fact, in a stable first-person wording ("My nickname is
//                      Elijah"). Deterministic patterns only, English and simple Pidgin; each sentence (or
//                      "… and I …" clause) must start with the fact, so requests ("write a poem that says my
//                      name is …") and questions are never read as facts.
//   kindOf(content) -> the kind of a saved note ('name', 'nickname', …) or null. A newer note of the same kind
//                      replaces the older one (index.js), also for notes saved before kinds existed.
//   IDENTITY        kinds that are always in a reply's context (retrieve.js), whatever the question's words.
// Never saved: questions, anything with a secret in it (safety redact: card numbers, PINs, OTPs, passwords, BVN/NIN)
// or a word like "password".
const { redact } = require('../safety');

const IDENTITY = new Set(['name', 'nickname', 'call_me']);
const MAX_SENTENCE = 220;
const MAX_VALUE = 120;

const NAME = "([\\p{L}][\\p{L}'’.-]*(?: [\\p{L}][\\p{L}'’.-]*){0,3}?)";
const REST = '(.{2,' + MAX_VALUE + '}?)';
const END = '\\s*(?:from now on|going forward|for short|abeg|please|ok(?:ay)?)?\\s*[.!]*$';
const SECRET_WORDS = /\b(password|passcode|pin|otp|cvv|cvc|bvn|nin|card number|account number|secret|token)\b/i;
const NOT_A_NAME = new Set(['not', 'a', 'an', 'the', 'very', 'so', 'too', 'also', 'still', 'now', 'just', 'here',
  'back', 'fine', 'ok', 'okay', 'tired', 'sad', 'happy', 'done', 'ready', 'sure', 'busy', 'hungry', 'sick', 'what',
  'who', 'how', 'why', 'that', 'this', 'it', 'him', 'her', 'them', 'you', 'me', 'anything', 'something', 'nothing']);
// "I like how you …", "I like to know …" (Nigerian English for "I'd like to know"), "I love you": not preferences.
const NOT_A_LIKE = new RegExp('^(?:you|your|it|this|that|these|those|how|what|when|where|why|the way|to (?:know|'
  + 'ask|learn|find|get|see|understand|have|be|make|start|buy|check|go|try|talk|chat)\\b)', 'i');

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[.!,;:]+$/, '').trim();
function nameOk(v) {
  const first = v.split(' ')[0].toLowerCase();
  return v.length <= 60 && !NOT_A_NAME.has(first);
}
const named = (kind, prefix) => (m) => (nameOk(clean(m[1])) ? { kind, content: `${prefix} ${cap(clean(m[1]))}` }
  : null);
const place = (kind, prefix) => (m) => ({ kind, content: `${prefix} ${clean(m[1])}` });
function pref(verb) {
  return (m) => {
    const what = clean(m[1]);
    if (NOT_A_LIKE.test(what) || what.split(' ').length > 12) return null;
    return { kind: `pref:${what.toLowerCase().slice(0, 58)}`, content: `${verb} ${what}` };
  };
}
function rule(word) {
  return (m) => {
    const what = clean(m[1]);
    if (what.split(' ').length < 2) return null;
    return { kind: null, content: `${word} ${what}` };
  };
}

// [pattern, (match) -> fact | null]. Order matters: the first pattern that matches a clause wins.
const RULES = [
  [new RegExp(`^(?:my )?(?:nick ?name|nickname) (?:is|na) ${NAME}${END}`, 'iu'), named('nickname', 'My nickname is')],
  [new RegExp(`^(?:my )?(?:preferred name|pet name) (?:is|na) ${NAME}${END}`, 'iu'), named('call_me', 'Call me')],
  [new RegExp(`^(?:(?:please|abeg|you can|you fit|make you|una fit|just) )?(?:always )?(?:dey )?call me ${NAME}${END}`,
    'iu'), named('call_me', 'Call me')],
  [new RegExp(`^(?:i go by|i prefer to be called|i(?:'d| would) like to be called|address me as|refer to me as|`
    + `people call me|everyone calls me|dem dey call me|people dey call me) ${NAME}${END}`, 'iu'),
  named('call_me', 'Call me')],
  [new RegExp(`^(?:my (?:full |first )?name (?:is|na)|i am called|i'm called|na me be) ${NAME}${END}`, 'iu'),
    named('name', 'My name is')],
  [new RegExp(`^(?:i (?:live|stay|reside) in|i (?:dey )?(?:live|stay) for|i'm based in|i am based in) ${REST}${END}`,
    'iu'), place('home', 'I live in')],
  [new RegExp(`^(?:i(?:'m| am) from|i come from|i (?:be|come) from) ${REST}${END}`, 'iu'), place('from', 'I am from')],
  [new RegExp(`^(?:i (?:study|school|attend|go to school) (?:at|in)|i (?:dey )?school (?:for|at|in)|`
    + `i(?:'m| am) (?:a )?(?:student|studying) (?:at|in)|i attend) ${REST}${END}`, 'iu'),
  place('school', 'I study at')],
  [new RegExp(`^(?:i work as|i dey work as|my job is|my work is) ${REST}${END}`, 'iu'), place('job', 'I work as')],
  [new RegExp(`^i(?:'m| am) (an? .{2,60}?) by profession${END}`, 'iu'), place('job', 'I work as')],
  [new RegExp(`^(?:i work (?:at|for|in)|i dey work (?:for|at|with)) ${REST}${END}`, 'iu'), place('work', 'I work at')],
  [new RegExp(`^my (favou?rite [\\p{L} ]{2,30}?) (?:is|na) ${REST}${END}`, 'iu'),
    (m) => ({ kind: `fav:${m[1].toLowerCase().replace(/favou?rite /, '')}`, content: `My ${m[1].toLowerCase()} is `
      + clean(m[2]) })],
  [new RegExp(`^(?:i (?:don't|do not|dont|no) (?:really )?like|i (?:hate|dislike|can't stand|cannot stand)) `
    + `${REST}${END}`, 'iu'), pref("I don't like")],
  [new RegExp(`^(?:i (?:really )?(?:like|love|enjoy|prefer)) ${REST}${END}`, 'iu'), pref('I like')],
  [new RegExp(`^(?:(?:please|abeg|make you) )?always ${REST}${END}`, 'iu'), rule('Always')],
  [new RegExp(`^(?:(?:please|abeg) )?(?:never|don't ever|do not ever|no ever) ${REST}${END}`, 'iu'), rule('Never')],
];

const FILLER = new RegExp('^(?:(?:hi|hello|hey|ok(?:ay)?|so|also|and|btw|by the way|fyi|just so you know|note '
  + 'that|for your info(?:rmation)?|abeg|oya|well|colon)[\\s,!.:-]+)+', 'i');

// Sentences, and "… and I …" / "… but my …" clauses, each one a candidate fact.
function clauses(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+|;\s*/)
    .flatMap((s) => s.split(/,?\s+(?:and|but|plus)\s+(?=(?:i|my|i'm)\b)/i))
    .map((s) => s.trim().replace(FILLER, '').trim()).filter(Boolean);
}

/** extract(text) -> [{ kind, content }], each kind at most once (the last wins), no duplicates. */
function extract(text) {
  const t = String(text || '');
  if (!t.trim() || t.length > 2000) return [];
  const out = new Map();
  for (const c of clauses(t)) {
    if (c.length > MAX_SENTENCE || /\?\s*$/.test(c) || SECRET_WORDS.test(c)) continue;
    if (/^(?:what|who|where|when|why|how|do|does|did|can|could|is|are|will|would|should|abi)\b/i.test(c)) continue;
    if (redact(c).count) continue;
    for (const [re, make] of RULES) {
      const m = re.exec(c);
      if (!m) continue;
      const f = make(m);
      if (f && f.content.length <= MAX_VALUE + 30) out.set(f.kind || `=${f.content.toLowerCase()}`, f);
      break;
    }
  }
  return [...out.values()];
}

/** kindOf(content) -> the kind of a note whose whole text is one fact, else null. */
function kindOf(content) {
  const f = extract(content);
  return f.length === 1 ? f[0].kind : null;
}

const isIdentity = (m) => IDENTITY.has(m && m.kind ? m.kind : kindOf(m && m.content));

module.exports = { extract, kindOf, isIdentity, clauses, IDENTITY };
