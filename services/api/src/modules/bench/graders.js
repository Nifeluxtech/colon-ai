// Colon benchmark (Phase 5): automatic graders. Each grader takes the model's reply and a grading spec
// from bench/sets/*.json and returns { pass, score (0..1), detail }. Pure functions, no network.
//
// Spec types:
//   mc        { answer: 'B' }                         multiple-choice letter
//   number    { answer: 42, tol?: 0.01, abs?: true }  "Answer: <number>" line, else the last number
//   keywords  { all?: [], any?: [], none?: [] }       accent- and case-insensitive word/phrase match
//   regex     { pattern, flags? }
//   json      { schema?, match? }                     JSON (bare or fenced) checked against a small JSON-schema subset
//   code      { fn, tests: [{ args, expect }] }       JavaScript run in a sandboxed child process (see sandbox.js)
//   lang      { lang: 'pcm'|'yo'|'ha'|'ig' }          the reply is written in the target language
//   all       { of: [spec, ...] }                     every part must pass; score is the mean
const { runCode } = require('./sandbox');

/* ---------- Text helpers ---------- */
// Lower-case and drop tone marks and subdots (ẹ→e, ọ→o, ṣ→s, ụ→u, ị→i, ṅ→n) and Hausa hooked letters,
// so "Ẹ káàrọ̀" matches "e kaaro".
function fold(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[ɗƊ]/g, 'd').replace(/[ƙƘ]/g, 'k').replace(/[ɓƁ]/g, 'b').replace(/[ƴƳ]/g, 'y')
    .replace(/[’‘`]/g, "'").toLowerCase();
}
const stripMd = (s) => String(s || '').replace(/[*_#>`]/g, '');
const words = (s) => fold(s).match(/[a-z0-9']+/g) || [];

function hasPhrase(text, phrase) {
  const t = ` ${words(text).join(' ')} `;
  const p = words(phrase).join(' ');
  return p ? t.includes(` ${p} `) : false;
}

/* ---------- mc ---------- */
function extractChoice(text) {
  const s = stripMd(text).trim();
  const firstLine = s.split('\n')[0].trim();
  // 1. The reply starts with the letter ("B", "(C)", "C. Mitochondrion"), but not the article "A fair die…".
  let m = /^\(?([A-E])(?:[).:]|$)/.exec(firstLine) || (firstLine.length <= 40 ? /^\(?([A-E])\s+(?![a-z])/.exec(firstLine) : null);
  if (m) return m[1];
  // 2. "The answer is B", "Answer: (B)", "correct option is C".
  m = /\b(?:answer|correct (?:option|choice))\s*(?:is|:|-|=)?\s*(?:option\s*)?\(?([A-E])\b(?![a-z])/i.exec(s);
  if (m) return m[1].toUpperCase();
  // 3. The last stand-alone letter.
  const solo = s.match(/(?:^|[\s(])([A-E])(?=[).:,\s]|$)/g);
  if (solo && solo.length) return solo[solo.length - 1].replace(/[^A-E]/g, '');
  return null;
}
function mc(text, spec) {
  const got = extractChoice(text);
  const pass = got === String(spec.answer).toUpperCase();
  return { pass, score: pass ? 1 : 0, detail: `chose ${got || 'nothing'}, expected ${spec.answer}` };
}

/* ---------- number ---------- */
const NUM_RE = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/g;
function toNumber(raw) { return Number(String(raw).replace(/,/g, '')); }
function extractNumber(text) {
  const s = stripMd(text).replace(/₦|\$|NGN|N(?=\d)/g, '');
  const lines = s.split('\n').reverse();
  for (const line of lines) {
    const m = /answer\s*[:=]\s*(.*)$/i.exec(line);
    if (m) {
      const frac = /(-?\d+)\s*\/\s*(\d+)/.exec(m[1]);
      const n = m[1].match(NUM_RE);
      if (frac && (!n || m[1].indexOf(frac[0]) <= m[1].indexOf(n[0]))) return Number(frac[1]) / Number(frac[2]);
      if (n) return toNumber(n[0]);
    }
  }
  // No "Answer:" line: Study mode often ends with a practice question, so ignore everything from such a section on.
  const cut = s.search(/^.*(check[- ]yourself|quick check|practice question|try (this|these|it)|quiz|exercise|your turn)/im);
  const body = cut > 0 ? s.slice(0, cut) : s;
  const all = body.match(NUM_RE);
  return all ? toNumber(all[all.length - 1]) : null;
}
function number(text, spec) {
  let got = extractNumber(text);
  const want = Number(spec.answer);
  const tol = spec.tol !== undefined ? Number(spec.tol) : Math.max(1e-6, Math.abs(want) * 1e-4);
  if (got !== null && spec.abs) got = Math.abs(got);
  const pass = got !== null && Number.isFinite(got) && Math.abs(got - want) <= tol;
  return { pass, score: pass ? 1 : 0, detail: `got ${got}, expected ${want}` };
}

/* ---------- keywords / regex ---------- */
function keywords(text, spec) {
  const missing = (spec.all || []).filter(k => !hasPhrase(text, k));
  const anyOk = !spec.any || !spec.any.length || spec.any.some(k => hasPhrase(text, k));
  const banned = (spec.none || []).filter(k => hasPhrase(text, k));
  const parts = (spec.all || []).length + (spec.any && spec.any.length ? 1 : 0);
  const got = (spec.all || []).length - missing.length + (spec.any && spec.any.length && anyOk ? 1 : 0);
  const pass = !missing.length && anyOk && !banned.length;
  const score = banned.length ? 0 : parts ? got / parts : 1;
  return { pass, score: pass ? 1 : score, detail: pass ? 'ok' : `missing ${[...missing, ...(anyOk ? [] : [`one of ${spec.any.join('/')}`])].join(', ') || '-'}${banned.length ? `; banned ${banned.join(', ')}` : ''}` };
}
function regex(text, spec) {
  const re = new RegExp(spec.pattern, spec.flags || 'i');
  const pass = re.test(stripMd(text)) || re.test(fold(stripMd(text)));
  return { pass, score: pass ? 1 : 0, detail: pass ? 'ok' : `no match for /${spec.pattern}/` };
}

/* ---------- json ---------- */
function extractJson(text) {
  const s = String(text || '').trim();
  const tries = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) tries.push(fence[1]);
  tries.push(s);
  const first = s.search(/[[{]/);
  if (first >= 0) {
    const close = s[first] === '{' ? '}' : ']';
    tries.push(s.slice(first, s.lastIndexOf(close) + 1));
  }
  for (const t of tries) { try { return { ok: true, value: JSON.parse(t.trim()), bare: t === s }; } catch { /* next */ } }
  return { ok: false };
}
function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v; }
// A small JSON-schema subset: type, enum, const, required, properties, additionalProperties:false, items, minItems, maxItems, minimum, maximum, pattern.
function validate(v, schema, at = '$') {
  const errs = [];
  if (!schema) return errs;
  if (schema.type) {
    const t = typeOf(v);
    const types = [].concat(schema.type);
    if (!types.some(x => x === t || (x === 'number' && t === 'integer'))) return [`${at} should be ${types.join('|')}, got ${t}`];
  }
  if (schema.enum && !schema.enum.some(e => e === v || (typeof e === 'string' && typeof v === 'string' && fold(e) === fold(v)))) errs.push(`${at} not in enum`);
  if (schema.const !== undefined && !looseEqual(v, schema.const)) errs.push(`${at} should be ${JSON.stringify(schema.const)}`);
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) errs.push(`${at} < ${schema.minimum}`);
    if (schema.maximum !== undefined && v > schema.maximum) errs.push(`${at} > ${schema.maximum}`);
  }
  if (typeof v === 'string' && schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(`${at} does not match ${schema.pattern}`);
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) errs.push(`${at} has ${v.length} items (< ${schema.minItems})`);
    if (schema.maxItems !== undefined && v.length > schema.maxItems) errs.push(`${at} has ${v.length} items (> ${schema.maxItems})`);
    if (schema.uniqueItems && new Set(v.map(x => fold(JSON.stringify(x)))).size !== v.length) errs.push(`${at} has duplicates`);
    if (schema.items) v.forEach((x, i) => errs.push(...validate(x, schema.items, `${at}[${i}]`)));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of schema.required || []) if (!(k in v)) errs.push(`${at}.${k} is missing`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in v) errs.push(...validate(v[k], s, `${at}.${k}`));
    if (schema.additionalProperties === false) for (const k of Object.keys(v)) if (!(schema.properties || {})[k]) errs.push(`${at}.${k} is not allowed`);
  }
  return errs;
}
// Strings compare accent/case/space-insensitively; numbers exactly; objects as a subset (every expected key must match).
function looseEqual(got, want) {
  if (typeof want === 'string') return typeof got === 'string' && fold(got).replace(/\s+/g, ' ').trim() === fold(want).replace(/\s+/g, ' ').trim();
  if (typeof want === 'number') return typeof got === 'number' ? Math.abs(got - want) < 1e-9 : (typeof got === 'string' && Number(got.replace(/[,₦]/g, '')) === want);
  if (Array.isArray(want)) return Array.isArray(got) && got.length === want.length && want.every((w, i) => looseEqual(got[i], w));
  if (want && typeof want === 'object') return got && typeof got === 'object' && Object.entries(want).every(([k, w]) => looseEqual(got[k], w));
  return got === want;
}
function json(text, spec) {
  const j = extractJson(text);
  if (!j.ok) return { pass: false, score: 0, detail: 'no valid JSON' };
  const errs = validate(j.value, spec.schema);
  if (spec.match !== undefined && !looseEqual(j.value, spec.match)) errs.push('values differ from expected');
  const pass = !errs.length;
  return { pass, score: pass ? 1 : 0.25, detail: pass ? (j.bare ? 'ok' : 'ok (JSON wrapped in text/fence)') : errs.slice(0, 3).join('; ') };
}

/* ---------- code ---------- */
function extractCode(text) {
  const blocks = [...String(text || '').matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)].map(m => m[1]);
  if (!blocks.length) return String(text || '');
  const js = blocks.filter(b => !/^\s*(\$|npm |node )/.test(b));
  return (js.length ? js : blocks).join('\n\n');
}
function code(text, spec) {
  const r = runCode(extractCode(text), spec.fn, spec.tests || [], spec.timeoutMs);
  const pass = r.passed === r.total && r.total > 0;
  return { pass, score: r.total ? r.passed / r.total : 0, detail: pass ? `${r.passed}/${r.total} tests` : `${r.passed}/${r.total} tests${r.error ? `; ${r.error}` : ''}` };
}

/* ---------- lang: is the reply written in the target language? ---------- */
const LEX = {
  pcm: 'na dey di wetin abeg una wey don pikin sabi wahala chop oga comot sef sha abi wan dem im dis dat tori shey oya jare ehn wella belle waka wan fit kuku sotey yarn gist ova pesin person no be e don dey go',
  yo: 'mo o won awon ati ni ti ki se ko si fun re mi wa yii naa je n lati omi ile omo ojo gbogbo pe bi nitori eyi ilu ola lo dara pupo kan nla ninu sugbon tabi fe a ba oun yin wonyi meji meta ewa owo iwe oja',
  ha: 'da na ya ta su ba ne ce ina yana tana suna kuma amma don saboda wannan wanda akwai babu ruwa gida mutane sosai za zai zata domin shi ita mu ku ga cikin kan daga har lokacin yi abin ake an kasa rana yara makaranta lafiya sannu nagode ilimi ke kai mai masu wani wata goma biyu hannu yatsu',
  ig: 'na nke bu ka o m ha anyi unu ya di mmiri ihe ndi maka nihi ma nwere ga ime iga onye oma nne nna nwa ulo ahu ji gi mere otu ubochi ndu ahuike nyere ebe ugbu a ozo kwa ruo kwesiri no aka iri abuo ato ano ise akwukwo ahia echi taa',
};
const EN = new Set('the is are was were and of to in it that this for with you your have has be on as by at from or an will can not they their there what which would should we he she my me our do does about into because very also if but more than then these those been being its'.split(' '));
const LEXSET = Object.fromEntries(Object.entries(LEX).map(([k, v]) => [k, new Set(v.split(' '))]));
// Special letters (counted on NFC text) and tone marks (combining accents, counted on NFD text).
const ORTHO = { yo: [/[ẹọṣẸỌṢ]/g, /[\u0300\u0301]/g], ig: [/[ịọụṅỊỌỤṄ]/g, null], ha: [/[ɗƙɓƴƊƘƁƳ]/g, null] };
const ORTHO_WORD = { yo: /[ẹọṣẸỌṢ]/, ig: /[ịọụṅỊỌỤṄ]/, ha: /[ɗƙɓƴƊƘƁƳ]/ };
const THRESH = { pcm: 0.3, yo: 0.5, ha: 0.5, ig: 0.5 };
// Naijá shares most of its words with English, so its grammar gives it away: "you go pay", "if you no count",
// "e still remain", "Nigeria get 36 states". These count as Pidgin markers; "for/if/no/so" are neutral for Pidgin.
const PCM_PATTERNS = [/\b(i|you|we|e|dem|una|im|e no) go [a-z]+/g, /\b(you|i|we|dem|una|e|im) no [a-z]+/g, /\be (still|go|dey|don|be|no|fit|wan|get)\b/g, /\b[a-z]+ get \d+/g, /\bfor (market|house|road|lokoja|lagos|abuja|school|work)\b/g];
const PCM_NEUTRAL = new Set(['for', 'if', 'no', 'so']);

// -> { score 0..1 (target words vs English function words), ortho 0..1 (special letters/tone marks used), pass }
function langScore(text, lang) {
  const toks = words(stripMd(String(text || '').replace(/```[\s\S]*?```/g, ''))).filter(w => w.length > 1);
  const lex = LEXSET[lang];
  if (!lex) return { score: 0, ortho: 0, pass: false };
  let t = 0, en = 0;
  for (const w of toks) { if (lex.has(w)) t++; else if (EN.has(w) && !(lang === 'pcm' && PCM_NEUTRAL.has(w))) en++; }
  if (lang === 'pcm') { const f = toks.join(' '); for (const re of PCM_PATTERNS) t += (f.match(re) || []).length; }
  // Words written with the language's own letters (ẹ ọ ṣ, ị ọ ụ ṅ, ɗ ƙ ɓ) count as target words too.
  if (ORTHO[lang]) {
    const raw = String(text || '').normalize('NFC').replace(/```[\s\S]*?```/g, '').split(/[^\p{L}\p{M}']+/u).filter(Boolean);
    for (const w of raw) if (ORTHO_WORD[lang].test(w) && !lex.has(fold(w))) t++;
  }
  const ratio = t / (t + en || 1);
  const thr = THRESH[lang];
  const minHits = toks.length < 25 ? 1 : 2;     // a one-line answer can only show one or two markers
  const score = t < minHits ? 0 : Math.min(1, ratio / thr);
  let ortho = 1;
  if (ORTHO[lang]) {
    const [letters, tones] = ORTHO[lang];
    const marks = (String(text).normalize('NFC').match(letters) || []).length + (tones ? (String(text).normalize('NFD').match(tones) || []).length : 0);
    ortho = Math.min(1, marks / Math.max(2, toks.length * 0.1));
  }
  return { score, ortho, pass: score >= 1 };
}
function lang(text, spec) {
  const r = langScore(text, spec.lang);
  return { pass: r.pass, score: r.score, detail: `${spec.lang} ${(r.score * 100).toFixed(0)}%, orthography ${(r.ortho * 100).toFixed(0)}%`, lang: 0.75 * r.score + 0.25 * r.ortho };
}

/* ---------- all ---------- */
function all(text, spec) {
  const parts = (spec.of || []).map(s => grade(text, s));
  const pass = parts.length > 0 && parts.every(p => p.pass);
  const score = parts.length ? parts.reduce((a, p) => a + p.score, 0) / parts.length : 0;
  const langPart = parts.find(p => p.lang !== undefined);
  return { pass, score: pass ? 1 : score, detail: parts.map(p => p.detail).join(' | '), ...(langPart ? { lang: langPart.lang } : {}) };
}

const GRADERS = { mc, number, keywords, regex, json, code, lang, all };
function grade(text, spec) {
  const g = GRADERS[spec && spec.type];
  if (!g) return { pass: false, score: 0, detail: `unknown grader ${spec && spec.type}` };
  try { return g(text, spec); } catch (e) { return { pass: false, score: 0, detail: `grader error: ${e.message}` }; }
}

module.exports = { grade, fold, extractChoice, extractNumber, extractJson, extractCode, validate, looseEqual, langScore, GRADERS };
