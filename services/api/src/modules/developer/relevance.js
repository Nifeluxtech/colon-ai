// Developer mode (v0.24.0): which files of a large project (a connected repository) matter for this message.
//   traces    file:line pairs from a pasted stack trace or error (Node/JS, Python, PHP, Java/Kotlin, Go, Rust, C#)
//   locate    the project path a trace's file is (absolute paths and other machines' prefixes are matched by suffix)
//   keywords  identifiers and words in the message, scored against each file's path and contents
//   window    the lines around a traced line, when the whole file does not fit
const rules = require('./rules');

const TRACE = [
  /File "([^"\n]{1,300})", line (\d{1,7})/g,                                   // Python
  /([\w@~.\-/\\:]{1,300}\.php)(?: on line |\()(\d{1,7})\)?/g,                  // PHP
  /((?:[A-Za-z]:)?[\w@~.\-/\\]{0,300}[\w-]\.[A-Za-z][\w]{0,9}):(\d{1,7})(?::\d{1,5})?/g,   // path:line(:col)
];
const STOP = new Set(('this that with from have what when where which there their about would could should into '
  + 'your mine just like does doesnt dont work working error errors file files code line lines please help fix '
  + 'make change some more than then them they were been being also only here very much need want using used '
  + 'function return true false null undefined const shows show getting gets every after before').split(' '));

/** traces(message) -> [{ file, line }] in the order they appear (at most 20). */
function traces(message) {
  const m = String(message || '');
  const hits = [];
  for (const re of TRACE) {
    re.lastIndex = 0;
    for (let x; (x = re.exec(m)) && hits.length < 40;) {
      const file = x[1].replace(/\\/g, '/').replace(/^file:\/\//, '');
      if (/^https?:/i.test(file) || file.startsWith('//') || /node:internal|^internal\//.test(file)) continue;
      hits.push({ file, line: Number(x[2]), at: x.index });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set();
  return hits.filter((h) => { const k = `${h.file}:${h.line}`; if (seen.has(k)) return false; seen.add(k);
    return true; }).slice(0, 20).map(({ file, line }) => ({ file, line }));
}

/** locate(paths, file) -> the project path with the longest matching tail (same file name), or null. */
function locate(paths, file) {
  const want = String(file).split('/').filter(Boolean);
  const name = want[want.length - 1];
  let best = null, bestLen = 0;
  for (const p of paths) {
    if (rules.base(p) !== name) continue;
    const have = p.split('/');
    let n = 0;
    while (n < have.length && n < want.length && have[have.length - 1 - n] === want[want.length - 1 - n]) n++;
    if (n > bestLen || (n === bestLen && best && p.length < best.length)) { best = p; bestLen = n; }
  }
  return best;
}

/** keywords(message) -> lower-case words worth looking for (identifiers first, at most 16). */
function keywords(message) {
  const words = String(message || '').match(/[A-Za-z_$][\w$]{3,40}/g) || [];
  const out = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (STOP.has(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length >= 16) break;
  }
  return out;
}

/** score(path, text, words) -> a relevance number (0 = nothing in common). */
function score(path, text, words) {
  if (!words.length) return 0;
  const p = path.toLowerCase();
  const t = String(text || '').slice(0, 60000).toLowerCase();
  let s = 0;
  for (const w of words) {
    if (p.includes(w)) s += 6;
    let n = 0, i = t.indexOf(w);
    while (i > -1 && n < 5) { n++; i = t.indexOf(w, i + w.length); }
    s += n;
  }
  return s;
}

/** window(text, line, cap) -> { text, from, to, total } the lines around `line`, within cap characters. */
function window(text, line, cap) {
  const lines = String(text).split('\n');
  const at = Math.min(Math.max(1, line), lines.length) - 1;
  let from = at, to = at, size = lines[at].length + 1;
  while (size < cap && (from > 0 || to < lines.length - 1)) {
    if (to < lines.length - 1 && (to - at <= (at - from) / 2 || from === 0)) { to++; size += lines[to].length + 1; }
    else if (from > 0) { from--; size += lines[from].length + 1; }
    if (size >= cap) break;
  }
  const out = lines.slice(from, to + 1).map((l, i) => `${String(from + i + 1).padStart(5)}| ${l}`).join('\n');
  return { text: out.slice(0, cap + 4000), from: from + 1, to: to + 1, total: lines.length };
}

module.exports = { traces, locate, keywords, score, window };
