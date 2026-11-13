/* Colon AI · CBT results screen (v0.5.7): score, time used and a review of every question (your answer, the right
   answer and why), plus Retake (new questions), New test and "Discuss my mistakes" (a Study chat about the ones
   missed). Also builds that chat message. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { md, mdInline } from './cbt-exam.js';
import { CbtStore } from '../core/cbt-store.js';

var C = Colon, icon = C.icon, esc = C.esc, L = CbtStore.LETTERS;

function optText(q, letter) { var k = L.indexOf(letter); return k > -1 ? q.options[k] : ''; }

function verdict(pct) {
  if (pct === 100) return 'Perfect score. Excellent work!';
  if (pct >= 70) return 'Strong result. Review the few you missed.';
  if (pct >= 50) return 'Good effort. Go over the ones you missed, then try again.';
  return 'Keep practising: go through the explanations, then take another test.';
}
function usedText(sec) { var m = Math.floor(sec / 60), r = sec % 60; return (m ? m + ' min ' : '') + r + ' s'; }

// The Study chat message for "Discuss my mistakes" (kept under the 16,000-character message limit).
function mistakesPrompt(s, r) {
  var t = s.test, wrong = r.items.filter(function (it) { return !it.ok; });
  var head = 'I just took a ' + (t.examLabel || '') + ' ' + t.subject + ' CBT practice test' + (t.topic ? ' on '
    + t.topic : '') + ' and scored ' + r.score + '/' + r.total + '.';
  if (!wrong.length) return head + ' I got them all right. Teach me the next, harder ideas in this topic, then give '
    + 'me three tougher practice questions one at a time.';
  var body = wrong.map(function (it, k) {
    var q = it.q;
    return (k + 1) + '. ' + q.q + '\n' + q.options.map(function (o, j) { return L[j] + ') ' + o; }).join('\n') + '\n'
      + (it.skipped ? 'I did not answer this one.' : 'My answer: ' + it.given + ') ' + optText(q, it.given)) + '\n'
      + 'Correct answer: ' + it.correct + ') ' + optText(q, it.correct);
  }).join('\n\n');
  var out = head + ' Please explain the ones I got wrong or skipped, step by step, and point out the mistake I '
    + 'probably made in each:\n\n' + body;
  return out.length > 15000 ? out.slice(0, 15000) : out;
}

// renderResults(root, session, { onRetake, onNew, onDiscuss(text) })
function renderResults(root, s, o) {
  var t = s.test, r = CbtStore.score(s);
  var wrong = r.items.filter(function (it) { return !it.ok && !it.skipped; }).length;
  var skipped = r.items.filter(function (it) { return it.skipped; }).length;
  var tone = r.pct >= 70 ? 'good' : r.pct >= 50 ? 'mid' : 'low';
  root.innerHTML =
    '<div class="cbt-results">' +
    '<section class="card cbt-score ' + tone + '" aria-labelledby="cbt-score-h">' +
      '<div class="cbt-score-ring" style="--p:' + r.pct + '"><b id="cbt-score-h">' + r.score + '/' + r.total
        + '</b><span>' + r.pct + '%</span></div>' +
      '<div class="cbt-score-t"><div class="h3">' + esc(verdict(r.pct)) + '</div>' +
        '<p class="small muted">' + esc((t.examLabel || 'CBT') + ' · ' + t.subject + (t.topic ? ' · ' + t.topic
          : '')) + '</p>' +
        '<div class="cbt-stats small"><span>' + icon('check') + r.score + ' correct</span><span>' + icon('x') + wrong
          + ' wrong</span><span>' + icon('info') + skipped + ' unanswered</span><span>' + icon('clock')
          + esc(usedText(r.used)) + (s.timeUp ? ' (time up)' : '') + '</span></div>' +
      '</div></section>' +
    '<div class="cbt-actions">' +
      '<button type="button" class="btn primary" data-cbt="discuss">' + icon('chat') + (r.score === r.total
        ? 'Go deeper in a chat' : 'Discuss my mistakes') + '</button>' +
      '<button type="button" class="btn" data-cbt="retake">' + icon('refresh') + 'Retake (new questions)</button>' +
      '<button type="button" class="btn ghost" data-cbt="new">' + icon('plus') + 'New test</button>' +
    '</div>' +
    '<div class="section-title">Review</div>' +
    '<ol class="cbt-review">' + r.items.map(function (it) {
      var q = it.q, state = it.ok ? 'ok' : it.skipped ? 'skip' : 'bad';
      var label = it.ok ? 'Correct' : it.skipped ? 'Not answered' : 'Wrong';
      return '<li class="card cbt-rev ' + state + '"><div class="cbt-rev-head"><span class="cbt-q-n">Question '
        + (it.i + 1) + '</span><span class="badge ' + (it.ok ? 'ok' : it.skipped ? 'warn' : 'bad') + '">'
        + icon(it.ok ? 'check' : it.skipped ? 'info' : 'x') + label + '</span></div>' +
        '<div class="md cbt-q-text">' + md(q.q) + '</div>' +
        '<ul class="cbt-rev-opts">' + q.options.map(function (opt, k) {
          var cls = L[k] === it.correct ? ' right' : L[k] === it.given ? ' picked' : '';
          var tag = L[k] === it.correct ? '<span class="sr-only"> (correct answer)</span>' : L[k] === it.given
            ? '<span class="sr-only"> (your answer)</span>' : '';
          return '<li class="cbt-rev-opt' + cls + '"><span class="cbt-letter">' + L[k] + '</span><span>'
            + mdInline(opt) + tag + '</span></li>';
        }).join('') + '</ul>' +
        '<p class="small cbt-rev-line">' + (it.skipped ? '<b>Your answer:</b> none' : '<b>Your answer:</b> '
          + esc(it.given)) + ' · <b>Correct:</b> ' + esc(it.correct) + '</p>' +
        (q.explanation ? '<div class="md cbt-expl">' + md(q.explanation) + '</div>' : '') +
        '</li>';
    }).join('') + '</ol>' +
    '<p class="tiny muted cbt-note">' + icon('info') + 'Practice questions written by Colon Saga in the style of the '
      + 'exam, not real past questions. Colon can make mistakes: check anything that looks wrong.</p>' +
    '</div>';
  root.querySelector('[data-cbt=discuss]').addEventListener('click', function () {
    o.onDiscuss(mistakesPrompt(s, r)); });
  root.querySelector('[data-cbt=retake]').addEventListener('click', o.onRetake);
  root.querySelector('[data-cbt=new]').addEventListener('click', o.onNew);
  var h = root.querySelector('#cbt-score-h'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
}

export { renderResults, mistakesPrompt };
