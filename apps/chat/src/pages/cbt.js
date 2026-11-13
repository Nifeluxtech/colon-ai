/* Colon AI · CBT practice test screen (v0.5.7) at #/cbt: setup → loading → exam → results.
   10 objective questions written by Colon Saga (POST /study/cbt through ColonChatData) and a 5-minute countdown
   for the whole test. The exam and results are components (cbt-exam.js, cbt-results.js); the session is kept in
   sessionStorage (core/cbt-store.js) so a refresh resumes. Preview (no connection) shows a friendly notice. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { mountExam } from '../components/cbt-exam.js';
import { renderResults } from '../components/cbt-results.js';
import { CbtStore } from '../core/cbt-store.js';
import { CW } from '../core/cw.js';
import { ColonChatData } from '../core/data.js';

var C = Colon, icon = C.icon, esc = C.esc;
var cur = { destroy: null, token: null };
var TIPS = ['The 5-minute timer starts only when the questions appear.', 'Tap a chosen option again to clear it.',
  'Flag a question to come back to it before you submit.', 'Unanswered questions score zero, so answer every one.',
  'At 0:00 the test submits itself, like the real CBT.'];

function here(page) { return document.body.contains(page) && /^#?\/cbt$/.test(location.hash || ''); }
function top(page) { var sc = page.closest('.cw-scroll'); if (sc) sc.scrollTop = 0; }
function stop() { if (cur.destroy) cur.destroy(); cur.destroy = null; cur.token = null; }
function paramsOf(t) { return { exam: t.exam, subject: t.subject, topic: t.topic || '' }; }
function examLabel(id) { var e = CbtStore.EXAMS.filter(function (x) { return x[0] === id; })[0]; return e ? e[1] : ''; }
function head(title, lead) { return '<header class="cw-screen-head"><div><h1 class="h1">' + esc(title) + '</h1>'
  + (lead ? '<p class="lead">' + esc(lead) + '</p>' : '') + '</div></header>'; }

CW.pages.cbt = function (page) {
  stop();
  var s = CbtStore.load();
  if (s && s.phase === 'exam') return showExam(page, s);
  if (s && s.phase === 'done') return showResults(page, s);
  showSetup(page);
};

/* ---------- Setup ---------- */
function showSetup(page, prefill) {
  stop();
  var p = Object.assign({ exam: 'waec', subject: '', topic: '' }, CbtStore.prefs(), prefill || {});
  if (ColonChatData.get().kind === 'local') {
    page.innerHTML = '<div class="cw-screen">' + head('CBT practice test', '') + '<div class="card cbt-msg">'
      + icon('wifiOff') + '<div class="h3">CBT practice needs a connection</div><p class="small">Colon Saga writes '
      + 'each test fresh, so it needs to reach Colon. Check your connection, then try again. Chat keeps working '
      + 'in Preview meanwhile.</p><div class="cbt-actions center"><button type="button" class="btn primary" '
      + 'data-cbt="reload">' + icon('refresh') + 'Try again</button><a class="btn" href="#/">Back to chat</a></div>'
      + '</div></div>';
    page.querySelector('[data-cbt=reload]').addEventListener('click', function () { location.reload(); });
    return;
  }
  page.innerHTML = '<div class="cw-screen cbt-setup">' + head('CBT practice test',
    '10 objective questions, 5 minutes, marked instantly. Like the real CBT.') +
    '<form class="form card cbt-form" novalidate>' +
      '<div class="field"><label for="cbt-exam">Exam</label><select class="select" id="cbt-exam">' + CbtStore.EXAMS
        .map(function (e) { return '<option value="' + e[0] + '"' + (e[0] === p.exam ? ' selected' : '') + '>'
          + esc(e[1]) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field" data-f="subject"><label for="cbt-subject">Subject</label>' +
        '<input class="input" id="cbt-subject" maxlength="80" autocomplete="off" placeholder="e.g. Mathematics" '
          + 'value="' + esc(p.subject) + '">' +
        '<div class="chips cbt-subjects" role="group" aria-label="Quick subjects">' + CbtStore.SUBJECTS.map(
          function (x) { return '<button type="button" class="chip sm" data-subj="' + esc(x) + '" aria-pressed="'
            + (x === p.subject) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
        '<div class="msg" id="cbt-subject-msg" role="alert"></div></div>' +
      '<div class="field"><label for="cbt-topic">Topic <span class="muted">(optional)</span></label>' +
        '<input class="input" id="cbt-topic" maxlength="120" autocomplete="off" '
          + 'placeholder="e.g. Quadratic equations" value="' + esc(p.topic) + '">' +
        '<div class="help">Leave it empty for a mix of topics from the syllabus.</div></div>' +
      '<ul class="cbt-rules small muted">' + TIPS.slice(0, 3).map(function (t) { return '<li>' + icon('check')
        + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<button type="submit" class="btn primary block cbt-start">' + icon('play')
        + 'Start test <span class="cbt-start-sub">10 questions · 5 minutes</span></button>' +
    '</form></div>';
  var form = page.querySelector('form'), subj = page.querySelector('#cbt-subject');
  function syncChips() { page.querySelectorAll('[data-subj]').forEach(function (b) { b.setAttribute('aria-pressed',
    String(b.getAttribute('data-subj').toLowerCase() === subj.value.trim().toLowerCase())); }); }
  page.querySelectorAll('[data-subj]').forEach(function (b) { b.addEventListener('click', function () {
    subj.value = b.getAttribute('data-subj'); syncChips(); clearErr(); }); });
  subj.addEventListener('input', function () { syncChips(); clearErr(); });
  function clearErr() { page.querySelector('[data-f=subject]').classList.remove('err');
    page.querySelector('#cbt-subject-msg').textContent = ''; }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = { exam: page.querySelector('#cbt-exam').value, subject: subj.value.trim(),
      topic: page.querySelector('#cbt-topic').value.trim() };
    if (q.subject.length < 2) {
      page.querySelector('[data-f=subject]').classList.add('err');
      page.querySelector('#cbt-subject-msg').textContent = 'Choose or type a subject.';
      subj.focus(); return;
    }
    CbtStore.savePrefs(q);
    generate(page, q);
  });
}

/* ---------- Loading and errors ---------- */
function generate(page, q) {
  stop();
  var token = cur.token = {}, started = Date.now(), tip = 0;
  page.innerHTML = '<div class="cw-screen"><div class="card cbt-msg cbt-loading" role="status" aria-live="polite">' +
    '<span class="spin dark" aria-hidden="true"></span><div class="h3">Setting your ' + esc(examLabel(q.exam)) + ' '
      + esc(q.subject) + ' test…</div>' +
    '<p class="small muted">Colon Saga is writing 10 questions and checking every answer. This usually takes 10 to '
      + '40 seconds.</p><div class="cbt-load-bar" aria-hidden="true"><i></i></div>' +
    '<p class="small cbt-tip" data-tip>' + icon('bulb') + '<span>' + esc(TIPS[0]) + '</span></p>' +
    '<p class="tiny muted" data-elapsed></p>' +
    '<button type="button" class="btn ghost" data-cbt="cancel">Cancel</button></div></div>';
  top(page);
  var timer = setInterval(function () {
    if (cur.token !== token || !here(page)) { clearInterval(timer); return; }
    var sec = Math.round((Date.now() - started) / 1000);
    page.querySelector('[data-elapsed]').textContent = sec + ' s';
    if (sec && sec % 6 === 0) { tip = (tip + 1) % TIPS.length; page.querySelector('[data-tip] span').textContent =
      TIPS[tip]; }
  }, 1000);
  page.querySelector('[data-cbt=cancel]').addEventListener('click', function () { clearInterval(timer);
    showSetup(page, q); });
  ColonChatData.get().cbt({ exam: q.exam, subject: q.subject, topic: q.topic, avoid: CbtStore.avoidFor(q),
    language: (C.user && C.user.language) || 'en' }).then(function (test) {
    clearInterval(timer);
    if (cur.token !== token || !here(page)) return;   // cancelled, or the user left the page
    if (!test || !Array.isArray(test.questions) || !test.questions.length) throw new Error(
      'Colon couldn’t put a full test together just now. Please try again in a moment.');
    CbtStore.remember(q, test.questions);   // the next test for this subject steers clear of these (v0.5.8)
    showExam(page, CbtStore.start(test));
  }).catch(function (e) {
    clearInterval(timer);
    if (cur.token !== token || !here(page)) return;
    showError(page, q, e);
  });
}

function showError(page, q, e) {
  var code = e.code || '';
  var title = { quota: 'Daily limit reached', offline: 'No connection', refused: 'Let’s pick another subject',
    rate_limited: 'Too many tests at once', invalid: 'Check the subject' }[code] || 'Couldn’t set your test';
  var guest = !C.user;
  page.innerHTML = '<div class="cw-screen"><div class="card cbt-msg" role="alert">' + icon(code === 'offline'
    ? 'wifiOff' : 'alert') + '<div class="h3">' + esc(title) + '</div><p class="small">' + esc(e.message) + '</p>'
    + '<div class="cbt-actions center">' +
    (code === 'quota' && guest ? '<button type="button" class="btn primary" data-cbt="login">Log in</button>'
      : code === 'refused' || code === 'invalid' ? '' : '<button type="button" class="btn primary" data-cbt="retry">'
      + icon('refresh') + 'Try again</button>') +
    '<button type="button" class="btn" data-cbt="change">Change subject</button></div></div></div>';
  var r = page.querySelector('[data-cbt=retry]');
  if (r) r.addEventListener('click', function () { generate(page, q); });
  var l = page.querySelector('[data-cbt=login]');
  if (l) l.addEventListener('click', function () { CW.login('login'); });
  page.querySelector('[data-cbt=change]').addEventListener('click', function () { showSetup(page, q); });
}

/* ---------- Exam and results ---------- */
function showExam(page, s) {
  stop();
  page.innerHTML = '<div class="cw-screen cbt-screen"></div>';
  top(page);
  cur.destroy = mountExam(page.firstChild, s, { onSubmit: function (done) { cur.destroy = null;
    showResults(page, done); } });
}

function showResults(page, s) {
  stop();
  page.innerHTML = '<div class="cw-screen cbt-screen"></div>';
  top(page);
  var q = paramsOf(s.test);
  renderResults(page.firstChild, s, {
    onRetake: function () { CbtStore.clear(); generate(page, q); },
    onNew: function () { CbtStore.clear(); showSetup(page, q); },
    onDiscuss: function (text) { CW.startWith(text, 'study'); }
  });
}
