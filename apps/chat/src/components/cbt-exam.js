/* Colon AI · CBT exam screen (v0.5.7), laid out like the JAMB CBT: countdown, one question at a time with options
   A–D, Previous/Next, a 1–10 navigator with flags, and Submit. The timer counts down to the session's absolute end
   time, so a refresh resumes correctly; at 0:00 the test submits itself. Keys (desktop): A–D choose, N or → next,
   P or ← previous, F flag. State lives in core/cbt-store.js; the page (pages/cbt.js) shows the results. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonMarkdown } from '../../../../packages/ui/js/markdown/index.js';
import { CbtStore } from '../core/cbt-store.js';

var C = Colon, icon = C.icon, esc = C.esc, L = CbtStore.LETTERS;

// Question text is Markdown with LaTeX. "$12$" (a bare number in maths dollars) is shown as plain 12: ColonMarkdown
// leaves "$5"-style money alone, so it would otherwise show its dollar signs.
function plain(t) { return String(t || '').replace(/\$(-?\d+(?:[.,]\d+)?)\$/g, '$1'); }
function md(t) { return ColonMarkdown.render(plain(t), { citations: false }); }
function mdInline(t) { return ColonMarkdown.inline(plain(t), { citations: false }); }

// mountExam(root, session, { onSubmit(session) }) -> destroy()
function mountExam(root, s, o) {
  var t = s.test, n = t.questions.length, finished = false, timer = null, lastSec = -1, said = {};
  root.innerHTML =
    '<div class="cbt-exam">' +
    '<header class="cbt-bar"><div class="cbt-bar-t"><b>' + esc(t.subject) + '</b><small>' + esc(t.examLabel
      || 'CBT') + (t.topic ? ' · ' + esc(t.topic) : '') + '</small></div>' +
      '<div class="cbt-timer" role="timer" aria-label="Time left" data-timer>' + icon('clock') + '<span></span></div>'
      + '</header>' +
    '<div class="cbt-progress" aria-hidden="true"><i data-prog></i></div>' +
    '<div class="sr-only" aria-live="assertive" data-live></div>' +
    '<section class="cbt-q" data-q></section>' +
    '<div class="cbt-move"><button type="button" class="btn" data-cbt="prev">' + icon('left') + 'Previous</button>' +
      '<button type="button" class="btn primary" data-cbt="next">Next' + icon('right') + '</button></div>' +
    '<div class="section-title">Questions</div>' +
    '<div class="cbt-grid" role="group" aria-label="Go to question" data-grid></div>' +
    '<div class="cbt-legend tiny muted"><span><i class="ans"></i>Answered</span><span><i class="flag"></i>Flagged'
      + '</span><span><i></i>Not answered</span></div>' +
    '<button type="button" class="btn primary block cbt-submit" data-cbt="submit">' + icon('check')
      + 'Submit test</button>' +
    '<p class="tiny muted cbt-keys cw-hide-touch">Keys: <span class="kbd">A</span>–<span class="kbd">D</span> '
      + 'choose · <span class="kbd">N</span> or <span class="kbd">→</span> next · <span class="kbd">P</span> or '
      + '<span class="kbd">←</span> previous · <span class="kbd">F</span> flag</p>' +
    '</div>';
  var $ = function (sel) { return root.querySelector(sel); };

  function renderQuestion(focus) {
    var i = s.current, q = t.questions[i], given = s.answers[i];
    $('[data-q]').innerHTML =
      '<div class="cbt-q-head"><span class="cbt-q-n">Question ' + (i + 1) + ' <span class="muted">of ' + n
        + '</span></span><button type="button" class="chip sm cbt-flag" data-cbt="flag" aria-pressed="' + !!s.flags[i]
        + '">' + icon('bookmark') + (s.flags[i] ? 'Flagged' : 'Flag for review') + '</button></div>' +
      '<div class="md cbt-q-text" id="cbt-q-text">' + md(q.q) + '</div>' +
      '<div class="cbt-opts" role="radiogroup" aria-labelledby="cbt-q-text">' + q.options.map(function (opt, k) {
        var on = given === L[k];
        return '<button type="button" class="cbt-opt' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on
          + '" data-opt="' + L[k] + '"><span class="cbt-letter">' + L[k] + '</span><span class="cbt-opt-t">'
          + mdInline(opt) + '</span></button>';
      }).join('') + '</div>';
    $('[data-cbt=prev]').disabled = i === 0;
    var next = $('[data-cbt=next]');
    next.innerHTML = i === n - 1 ? 'Review' + icon('grid') : 'Next' + icon('right');
    renderGrid();
    if (focus) { var f = root.querySelector('.cbt-opt.on') || root.querySelector('.cbt-opt'); if (f) f.focus(); }
  }
  function renderGrid() {
    $('[data-grid]').innerHTML = t.questions.map(function (q, i) {
      var cls = (s.answers[i] ? ' ans' : '') + (s.flags[i] ? ' flag' : '') + (i === s.current ? ' cur' : '');
      return '<button type="button" class="cbt-cell' + cls + '" data-go="' + i + '" aria-label="Question ' + (i + 1)
        + (s.answers[i] ? ', answered ' + s.answers[i] : ', not answered') + (s.flags[i] ? ', flagged' : '') + '"'
        + (i === s.current ? ' aria-current="step"' : '') + '>' + (i + 1) + '</button>';
    }).join('');
    $('[data-prog]').style.width = (CbtStore.answeredCount(s) * 100 / n) + '%';
  }
  function go(i, focus) { if (i < 0 || i >= n) return; s.current = i; CbtStore.save(s); renderQuestion(focus); }
  function choose(letter) {
    s.answers[s.current] = s.answers[s.current] === letter ? null : letter;  // tapping the chosen option clears it
    CbtStore.save(s); renderQuestion(true);
  }
  function flag() { s.flags[s.current] = !s.flags[s.current]; CbtStore.save(s); renderQuestion(); }

  function tick() {
    if (finished) return;
    if (!document.body.contains(root)) { destroy(); return; }  // the user left the page (the test stays saved)
    var sec = CbtStore.remaining(s);
    if (sec !== lastSec) {
      lastSec = sec;
      var el = $('[data-timer]');
      el.querySelector('span').textContent = CbtStore.fmt(sec);
      el.classList.toggle('warn', sec <= 60 && sec > 30);
      el.classList.toggle('danger', sec <= 30);
      if (sec <= 60 && sec > 30 && !said[60]) { said[60] = 1; live('1 minute left.'); }
      if (sec <= 30 && sec > 0 && !said[30]) { said[30] = 1; live('30 seconds left.'); }
    }
    if (sec <= 0) finish(true);
  }
  function live(msg) { var el = $('[data-live]'); el.textContent = ''; setTimeout(function () { el.textContent = msg;
    }, 30); }

  function submit() {
    var left = n - CbtStore.answeredCount(s);
    C.confirm({ title: 'Submit your test?', confirm: 'Submit', cancel: 'Keep going',
      body: (left ? 'You have ' + left + ' unanswered question' + (left === 1 ? '' : 's') + '. Unanswered questions '
        + 'score zero. ' : 'You have answered all ' + n + ' questions. ') + 'Time left: '
        + CbtStore.fmt(CbtStore.remaining(s)) + '.' }).then(function (yes) { if (yes) finish(false); });
  }
  function finish(timeUp) {
    if (finished) return;
    finished = true;
    var open = document.querySelector('.sheet [data-close]'); if (open) open.click();  // close the confirm dialog
    s.phase = 'done'; s.timeUp = !!timeUp; s.submittedAt = Math.min(Date.now(), s.endAt);
    CbtStore.save(s);
    destroy();
    if (timeUp) C.toast('Time up — submitted');
    o.onSubmit(s);
  }

  function onKey(e) {
    if (finished || e.ctrlKey || e.metaKey || e.altKey || !document.body.contains(root)) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;
    if (document.querySelector('.sheet')) return;   // a dialog is open
    var k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (L.indexOf(k) > -1) { e.preventDefault(); choose(k); }
    else if (k === 'N' || k === 'ArrowRight') { e.preventDefault(); go(s.current + 1, true); }
    else if (k === 'P' || k === 'ArrowLeft') { e.preventDefault(); go(s.current - 1, true); }
    else if (k === 'F') { e.preventDefault(); flag(); }
  }
  function onUnload(e) { if (finished) return; e.preventDefault(); e.returnValue = ''; return ''; }
  function onClick(e) {
    var b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    var a = b.getAttribute('data-cbt');
    if (b.hasAttribute('data-opt')) choose(b.getAttribute('data-opt'));
    else if (b.hasAttribute('data-go')) go(Number(b.getAttribute('data-go')));
    else if (a === 'prev') go(s.current - 1);
    else if (a === 'next') { if (s.current === n - 1) $('[data-grid]').scrollIntoView({ block: 'center',
      behavior: 'smooth' }); else go(s.current + 1); }
    else if (a === 'flag') flag();
    else if (a === 'submit') submit();
  }
  function destroy() {
    clearInterval(timer); timer = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', onUnload);
  }

  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);
  renderQuestion();
  tick();
  if (!finished) timer = setInterval(tick, 250);
  return destroy;
}

export { mountExam, md, mdInline };
