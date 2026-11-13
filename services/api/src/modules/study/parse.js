// CBT practice test: turns a model's reply into checked questions.
// Models wrap JSON in fences or prose, forget to double LaTeX backslashes ("\frac" is a form feed in JSON) and leave
// trailing commas, so the reply is repaired before parsing; then every item is checked and bad ones are dropped.
const LETTERS = ['A', 'B', 'C', 'D'];
const MAX_Q = 1200;
const MAX_OPTION = 400;
const MAX_EXPLANATION = 600;
const { fingerprint, nearAny } = require('./similar');

// LaTeX commands that start with a valid JSON escape letter (b f n r t u): "\frac" must stay a backslash + "frac".
const LATEX = new Set(('frac,dfrac,tfrac,forall,flat,frown,times,theta,tau,tan,tanh,text,textbf,textit,textrm,to,top,'
  + 'triangle,therefore,tilde,triangleq,beta,bar,binom,bmod,big,bigg,Big,boxed,bullet,because,bot,bigcup,bigcap,'
  + 'backslash,ne,neq,nu,nabla,not,neg,ni,notin,nleq,ngeq,newline,nearrow,rho,right,rightarrow,rangle,rm,rceil,'
  + 'rfloor,rbrace,Rightarrow,uparrow,underline,underbrace,upsilon,unit,cup,cap,lfloor').split(','));

// Repairs the JSON-ish text: LaTeX backslashes, invalid escapes and raw newlines inside strings, trailing commas.
function repair(src) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
    if (c === '"') { inStr = false; out += c; continue; }
    if (c === '\n') { out += '\\n'; continue; }
    if (c === '\r' || c === '\t') { out += ' '; continue; }
    if (c !== '\\') { out += c; continue; }
    const n = src[i + 1];
    if (n === undefined) { out += '\\\\'; continue; }
    if (n === '"' || n === '\\' || n === '/') { out += c + n; i++; continue; }
    if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) { out += c; continue; }
    if ('bfnrtu'.includes(n)) {
      const word = (/^[a-zA-Z]+/.exec(src.slice(i + 1)) || [''])[0];
      out += LATEX.has(word) ? '\\\\' : c;
      continue;
    }
    out += '\\\\';   // "\alpha", "\sqrt", "\(": not a JSON escape, so it was meant as a literal backslash
  }
  return out.replace(/,\s*([\]}])/g, '$1');
}

// The first JSON object or array in the text (fences and prose around it ignored) -> parsed value, or null.
function extractJson(text) {
  const s = String(text || '').replace(/```(?:json|JSON)?/g, '');
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const close = s[start] === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  const body = s.slice(start, end + 1);
  // Repaired first: a raw parse would "succeed" on "\frac" by turning it into a form feed.
  for (const candidate of [repair(body), body]) {
    try { return JSON.parse(candidate); } catch { /* try the next form */ }
  }
  return salvage(s.slice(s.indexOf('[') > -1 ? s.indexOf('[') : start));
}

// A cut-off or broken reply: keeps every complete {…} item of the first array that parses on its own.
function salvage(s) {
  const items = [];
  let depth = 0, inStr = false, from = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) from = i; depth++; }
    else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && from > -1) {
        try { items.push(JSON.parse(repair(s.slice(from, i + 1)))); } catch { /* skip a broken item */ }
        from = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return items.length ? items : null;
}

function listOf(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.questions)) return data.questions;
  const arr = Object.values(data).find(Array.isArray);
  return arr || [];
}

const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\u0000/g, '').trim();
const stripLabel = (s) => s.replace(/^\(?\s*[A-Da-d]\s*[).:\]-]\s+/, '').trim();
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function optionsOf(raw) {
  let list = raw;
  if (raw && !Array.isArray(raw) && typeof raw === 'object') list = LETTERS.map(l => raw[l] ?? raw[l.toLowerCase()]);
  if (!Array.isArray(list) || list.length !== 4) return null;
  const out = list.map(o => stripLabel(str(o && typeof o === 'object' ? o.text : o)));
  if (out.some(o => !o || o.length > MAX_OPTION)) return null;
  if (new Set(out.map(norm)).size !== 4) return null;
  return out;
}

function answerOf(raw, options) {
  const s = str(raw);
  const byText = options.map(norm).indexOf(norm(stripLabel(s)));
  if (byText > -1 && s.length > 1) return LETTERS[byText];   // "A decrease in price" is an option, not the letter A
  const m = /^(?:option|answer|choice)?\s*\(?\s*([A-Da-d])\s*\)?\s*[.:)]?(?:\s|$)/i.exec(s);
  if (m) return m[1].toUpperCase();
  if (/^[0-3]$/.test(s)) return LETTERS[Number(s)];
  return null;
}

// Numeric answers: when the explanation's working ends on a value that is exactly one option and the key points
// elsewhere, the working is trusted (fast models sometimes pick the letter before working the sum out).
const squash = (s) => s.toLowerCase().replace(/\s+/g, '').replace(/[.。]+$/, '');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function reconcile(item) {
  const marks = [...item.explanation.matchAll(/=|→|≈|⇒/g)];
  if (!marks.length) return item;
  const tail = squash(item.explanation.slice(marks[marks.length - 1].index + 1));
  const core = (o) => squash(o.includes('=') ? o.slice(o.lastIndexOf('=') + 1) : o);
  const hits = item.options.map((o, i) => {
    const c = core(o);
    return /\d/.test(c) && new RegExp(`(?<![0-9.])${escRe(c)}(?![0-9])`).test(tail) ? i : -1;
  }).filter(i => i > -1);
  const key = LETTERS.indexOf(item.answer);
  if (hits.length !== 1 || hits[0] === key) return item;
  return { ...item, answer: LETTERS[hits[0]] };
}

// One raw item -> { q, options[4], answer:'A'..'D', explanation } or null.
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const q = str(raw.q ?? raw.question ?? raw.stem);
  if (!q || q.length > MAX_Q) return null;
  const options = optionsOf(raw.options ?? raw.choices);
  if (!options) return null;
  const answer = answerOf(raw.answer ?? raw.correct ?? raw.correct_answer, options);
  if (!answer) return null;
  const explanation = str(raw.explanation ?? raw.explain ?? raw.reason).slice(0, MAX_EXPLANATION);
  return reconcile({ q, options, answer, explanation });
}

// Moves the options into a random order (models favour "A"), unless the explanation names an option letter.
const NAMES_LETTER = /\b(?:option|choice|answer)\s*\(?[A-D]\b|\([A-D]\)/i;
function shuffleItem(item, rng = Math.random) {
  if (NAMES_LETTER.test(item.explanation)) return item;
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const correct = LETTERS.indexOf(item.answer);
  return { ...item, options: order.map(k => item.options[k]), answer: LETTERS[order.indexOf(correct)] };
}

// Model reply -> valid, de-duplicated questions (at most `max`). `seen` carries exact question keys across attempts;
// `accepted` (fingerprints, see ./similar.js) the questions already in this test, so near-duplicates within the test
// are dropped; `avoid` (fingerprints of questions from the student's earlier tests) drops near-repeats of those too.
// Items dropped only because of `avoid` go to `held` (when given): the handler's last resort when a test is short.
function parseQuestions(text, { max = 10, seen = new Set(), rng, accepted = [], avoid = [], held } = {}) {
  const out = [];
  for (const raw of listOf(extractJson(text))) {
    const item = normalizeItem(raw);
    if (!item) continue;
    const key = norm(item.q);
    if (seen.has(key)) continue;
    const fp = fingerprint(item);
    if (nearAny(fp, accepted)) continue;
    seen.add(key);
    if (avoid.length && nearAny(fp, avoid)) { if (held) held.push({ item: shuffleItem(item, rng), fp }); continue; }
    accepted.push(fp);
    out.push(shuffleItem(item, rng));
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { parseQuestions, normalizeItem, extractJson, repair, shuffleItem, reconcile, LETTERS };
