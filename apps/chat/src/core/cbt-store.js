/* Colon AI · CBT practice test state (v0.5.7): the test in progress or just finished, kept in sessionStorage so a
   refresh resumes with the right time left (the timer counts down to an absolute end time). Nothing goes to the
   server after the questions arrive: marking happens here. Also the last exam and subject (localStorage). */

var KEY = 'colon.cbt';
var PREFS = 'colon.cbt.prefs';
var LETTERS = ['A', 'B', 'C', 'D'];
var EXAMS = [['waec', 'WAEC'], ['neco', 'NECO'], ['jamb', 'JAMB'], ['university', 'University'],
  ['general', 'General']];
var SUBJECTS = ['Mathematics', 'English', 'Physics', 'Chemistry', 'Biology', 'Economics', 'Government', 'Literature'];

function read(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }
function write(store, key, v) { try { store.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode: skip */ } }

// A test as the API sent it -> a fresh session: { test, startedAt, endAt, answers, flags, current, phase }.
function start(test, now) {
  now = now || Date.now();
  var s = { v: 1, phase: 'exam', test: test, startedAt: now, endAt: now + (test.durationSec || 300) * 1000,
    answers: {}, flags: {}, current: 0 };
  save(s);
  return s;
}
function valid(s) {
  return !!(s && s.v === 1 && s.test && Array.isArray(s.test.questions) && s.test.questions.length && s.endAt);
}
function load() { var s = read(sessionStorage, KEY); return valid(s) ? s : null; }
function save(s) { write(sessionStorage, KEY, s); }
function clear() { try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

// Seconds left (never below 0), from the absolute end time.
function remaining(s, now) { return Math.max(0, Math.ceil((s.endAt - (now || Date.now())) / 1000)); }
function fmt(sec) { sec = Math.max(0, sec | 0); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

// Marks the test: -> { score, total, pct, used (seconds), items:[{ i, q, given, correct, ok, skipped }] }
function score(s) {
  var qs = s.test.questions, right = 0;
  var items = qs.map(function (q, i) {
    var given = s.answers[i] || null, ok = given === q.answer;
    if (ok) right++;
    return { i: i, q: q, given: given, correct: q.answer, ok: ok, skipped: !given };
  });
  var end = Math.min(s.submittedAt || Date.now(), s.endAt);
  return { score: right, total: qs.length, pct: Math.round(right * 100 / qs.length), items: items,
    used: Math.max(0, Math.round((end - s.startedAt) / 1000)) };
}
function answeredCount(s) { return Object.keys(s.answers).filter(function (k) { return s.answers[k]; }).length; }

function prefs() { return read(localStorage, PREFS) || {}; }
function savePrefs(p) { write(localStorage, PREFS, p); }

var CbtStore = { start: start, load: load, save: save, clear: clear, remaining: remaining, fmt: fmt, score: score,
  answeredCount: answeredCount, prefs: prefs, savePrefs: savePrefs, LETTERS: LETTERS, EXAMS: EXAMS,
  SUBJECTS: SUBJECTS };

export { CbtStore };
