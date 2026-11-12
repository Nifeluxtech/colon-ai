// Unit tests for the Colon benchmark graders (Phase 5): multiple choice, numbers, keywords/regex, JSON, code in
// the sandbox, the language check, and the benchmark sets themselves (every coding item solvable).
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const { grade, extractChoice, extractNumber, extractJson, langScore, fold } = require('../../src/modules/bench/graders');
const { runCode } = require('../../src/modules/bench/sandbox');
const runner = require('../../src/modules/bench/runner');
/* ---------- graders ---------- */
test('mc: finds the chosen letter in the usual answer shapes', () => {
  for (const [text, want] of [['B', 'B'], ['**C**', 'C'], ['C. Mitochondrion', 'C'], ['The answer is (B).', 'B'], ['Answer: A', 'A'], ['(D) 1999 Constitution', 'D']]) {
    assert.equal(extractChoice(text), want, text);
  }
  assert.equal(grade('B. plentiful', { type: 'mc', answer: 'B' }).pass, true);
  assert.equal(extractChoice('B\n\nWhy: Option A is too small and option D is sound.'), 'B', 'a leading letter beats later "Option A"');
  assert.equal(extractChoice('A fair die has six faces, so the answer is B.'), 'B', 'the article "A" is not a choice');
  assert.equal(grade('A', { type: 'mc', answer: 'B' }).pass, false);
});
test('number: prefers the "Answer:" line, handles ₦, commas, fractions and tolerance', () => {
  assert.equal(extractNumber('3 × 1,200 = 3,600\n5,000 − 3,600 = 1,400\nAnswer: ₦1,400'), 1400);
  assert.equal(extractNumber('Step 1: 2x = 12\nAnswer: x = 6'), 6);
  assert.equal(extractNumber('Answer: 1/2'), 0.5);
  assert.equal(extractNumber('so the total is 26,250'), 26250);
  assert.equal(extractNumber('2^7 ÷ 2^5 = 2^2 = 4\n\n**Check-yourself question:** simplify 3^5 ÷ (3^2 × 3^1)'), 4, 'a closing practice question is ignored');
  assert.equal(grade('Answer: 2.4 Ω', { type: 'number', answer: 2.4, tol: 0.01 }).pass, true);
  assert.equal(grade('Answer: -2', { type: 'number', answer: 2, abs: true }).pass, true);
  assert.equal(grade('Answer: 41', { type: 'number', answer: 42 }).pass, false);
  assert.equal(grade('no digits here', { type: 'number', answer: 1 }).pass, false);
});
test('keywords and regex: accent- and case-insensitive whole-phrase matching', () => {
  assert.equal(fold('Ẹ káàrọ̀ ọ̀rẹ́ mi, ɗaya'), 'e kaaro ore mi, daya');
  assert.equal(grade('Ọ̀la a ó lọ sí ọjà', { type: 'keywords', all: ['ola', 'oja'] }).pass, true);
  assert.equal(grade('Mahaifiyata tana dafa abinci', { type: 'keywords', all: ['abinci'] }).pass, true);
  const partial = grade('The capital is Lagos', { type: 'keywords', all: ['Abuja', 'capital'] });
  assert.equal(partial.pass, false);
  assert.equal(partial.score, 0.5);
  assert.equal(grade('omission', { type: 'keywords', all: ['omi'] }).pass, false, 'whole words only');
  assert.equal(grade('Ẹ ṣé, ọ̀rẹ́ mi', { type: 'regex', pattern: '\\b(e|o)\\s?se\\b' }).pass, true);
});
test('json: bare or fenced JSON, schema subset and loose value match', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```').value, { a: 1 });
  assert.deepEqual(extractJson('Here you go: [1,2]').value, [1, 2]);
  const spec = { type: 'json', schema: { type: 'object', required: ['tool', 'arguments'] }, match: { tool: 'send_money', arguments: { recipient: 'Musa', amount_naira: 5000 } } };
  assert.equal(grade('{"tool":"send_money","arguments":{"recipient":"musa","amount_naira":5000}}', spec).pass, true);
  assert.equal(grade('{"tool":"send_money","arguments":{"recipient":"Musa","amount_naira":500}}', spec).pass, false);
  assert.equal(grade('not json', spec).score, 0);
  const states = { type: 'json', schema: { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: { type: 'string', enum: ['Lagos', 'Ogun', 'Akwa Ibom'] } } };
  assert.equal(grade('["Lagos","akwa ibom"]', states).pass, true);
  assert.equal(grade('["Lagos","Lagos"]', states).pass, false);
  assert.equal(grade('["Lagos","Texas"]', states).pass, false);
  assert.equal(grade('{"states":["Lagos"],"extra":1}', { type: 'json', schema: { type: 'object', properties: { states: { type: 'array' } }, additionalProperties: false } }).pass, false);
});
test('code: runs in a sandboxed child process with tests and a timeout', () => {
  const tests = [{ args: [2, 3], expect: 5 }, { args: [2, 0], expect: 2 }];
  assert.deepEqual(runCode('function add(a, b) { return a + b; }', 'add', tests).passed, 2);
  assert.equal(runCode('const add = (a, b) => a + b;', 'add', tests).passed, 2);
  assert.equal(runCode('export function add(a, b) { return a + b; }', 'add', tests).passed, 2);
  assert.equal(runCode('function add(a, b) { return a - b; }', 'add', tests).passed, 1);
  const loop = runCode('function add() { while (true) {} }', 'add', tests, 300);
  assert.equal(loop.passed, 0);
  const escape = runCode('function add() { return typeof require + typeof process; }', 'add', [{ args: [], expect: 'undefinedundefined' }]);
  assert.equal(escape.passed, 1, 'no require or process inside the sandbox');
  assert.match(runCode('function other() {}', 'add', tests).error, /not found/);
  const g = grade('Here:\n```javascript\nfunction add(a,b){return a+b}\n```\nDone.', { type: 'code', fn: 'add', tests });
  assert.equal(g.pass, true);
});
test('lang: tells the target language from English, and rewards proper orthography', () => {
  const yo = langScore('Omi mímọ́ ṣe pàtàkì nítorí pé ó ń dáàbò bo ara wa lọ́wọ́ àìsàn. Gbogbo ènìyàn ní láti mu omi tó mọ́.', 'yo');
  assert.equal(yo.pass, true);
  assert.ok(yo.ortho > 0.5);
  const yoBare = langScore('Omi mimo se pataki nitori pe o n dabo bo ara wa. Gbogbo eniyan ni lati mu omi to mo.', 'yo');
  assert.equal(yoBare.pass, true);
  assert.ok(yoBare.ortho < yo.ortho, 'no tone marks scores lower orthography');
  assert.equal(langScore('Clean water is important because it keeps the body healthy and free from disease.', 'yo').pass, false);
  assert.equal(langScore('Yara su je makaranta domin ilimi yana da muhimmanci sosai. Za su sami aiki mai kyau.', 'ha').pass, true);
  assert.equal(langScore('Mmiri dị ọcha dị mkpa maka ahụike anyị. Ọ na-egbochi ọrịa.', 'ig').pass, true);
  assert.equal(langScore('Water is a liquid.', 'ig').pass, false, 'an English line is not Igbo');
  assert.equal(langScore("Mkpịsị aka iri nọ n'aka abụọ.", 'ig').pass, true, 'words in Igbo letters count');
  assert.equal(langScore('Abeg, di capital of Nigeria na Abuja. Na dia government dey sit.', 'pcm').pass, true);
  assert.equal(langScore('The capital of Nigeria is Abuja, which is where the government sits.', 'pcm').pass, false);
  assert.equal(langScore('Na River Benue join River Niger for Lokoja.', 'pcm').pass, true, 'short Naijá answer');
  assert.equal(langScore('Nigeria get 36 states plus one FCT (Abuja). So if you no count the FCT, e still remain 36 states.', 'pcm').pass, true);
  assert.equal(langScore('If you buy two plates of rice for 1,500 naira each, you will pay 3,000 naira.', 'pcm').pass, false, 'plain English stays English');
  const both = grade('Olú ìlú Nàìjíríà ni Abuja. Ìlú náà wà ní àárín gbùngbùn orílẹ̀-èdè wa.', { type: 'all', of: [{ type: 'lang', lang: 'yo' }, { type: 'keywords', all: ['Abuja'] }] });
  assert.equal(both.pass, true);
  assert.ok(both.lang > 0.5);
});
test('every benchmark set loads: unique ids, valid graders, about 120–150 items, all eleven sets', () => {
  const sets = runner.loadSets();
  const names = sets.map(s => s.set).sort();
  assert.deepEqual(names, ['coding', 'everyday', 'hausa', 'igbo', 'jamb', 'pidgin', 'reasoning', 'tooluse', 'university', 'waec', 'yoruba']);
  const items = sets.flatMap(s => s.items);
  assert.ok(items.length >= 120 && items.length <= 150, `${items.length} items`);
  for (const s of sets) assert.ok(s.items.length >= 10 && s.items.length <= 15, `${s.set} has ${s.items.length}`);
  const types = new Set(Object.keys(require('../../src/modules/bench/graders').GRADERS));
  const walk = (g) => { assert.ok(types.has(g.type), `grader ${g.type}`); (g.of || []).forEach(walk); };
  for (const it of items) walk(it.grade);
  assert.ok(items.find(i => i.id === 'waec-08').prompt.endsWith(runner.FORMAT.mc));
  assert.equal(items.find(i => i.id === 'yo-01').language, 'yo');
});
test('the coding items are solvable: a reference solution passes every test', () => {
  const ref = {
    isPalindrome: 's => { const t = s.toLowerCase().replace(/[^a-z0-9]/g, ""); return t === [...t].reverse().join(""); }',
    sumEven: 'a => a.filter(x => x % 2 === 0).reduce((x, y) => x + y, 0)',
    fizzBuzz: 'n => Array.from({ length: n }, (_, i) => { const k = i + 1; return k % 15 === 0 ? "FizzBuzz" : k % 3 === 0 ? "Fizz" : k % 5 === 0 ? "Buzz" : String(k); })',
    formatNaira: 'n => "₦" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })',
    isNigerianMobile: 's => /^(0|\\+234)[789][01]\\d{8}$/.test(s)',
    wordCount: 't => { const o = {}; for (const w of t.toLowerCase().match(/[a-z]+/g) || []) o[w] = (o[w] || 0) + 1; return o; }',
    fib: 'n => { let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; }',
    chunk: '(a, s) => { const o = []; for (let i = 0; i < a.length; i += s) o.push(a.slice(i, i + s)); return o; }',
    flatten: 'v => v.flat(Infinity)',
    romanToInt: 's => { const m = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let t = 0; for (let i = 0; i < s.length; i++) t += m[s[i]] < (m[s[i + 1]] || 0) ? -m[s[i]] : m[s[i]]; return t; }',
    gcd: '(a, b) => { while (b) [a, b] = [b, a % b]; return a; }',
    average: 'a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0',
  };
  const coding = runner.loadSets(runner.SETS_DIR, ['coding'])[0].items;
  for (const it of coding) {
    const src = `const ${it.grade.fn} = ${ref[it.grade.fn]};`;
    const r = runCode(src, it.grade.fn, it.grade.tests);
    assert.equal(r.passed, r.total, `${it.id}: ${r.error}`);
  }
});
