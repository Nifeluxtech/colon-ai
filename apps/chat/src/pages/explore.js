/* Colon AI · Explore screen: starter prompts by topic. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { CW } from '../core/cw.js';

var C = Colon, icon = C.icon, esc = C.esc;

var EXPLORE = {
  study: [['WAEC Chemistry', 'Quiz me on moles and molar mass, one question at a time'], ['JAMB Use of English',
    'Explain concord with five examples, then test me'], ['Explain like a teacher',
    'Teach me photosynthesis step by step'], ['Revision plan', 'Make a 2-week revision timetable for my exams']],
  developer: [['REST API in Node.js', 'Write a small REST API with MySQL and input validation'], ['Fix my code',
    'Help me debug a JavaScript error step by step'], ['Paystack webhook',
    'Explain how to verify a Paystack webhook signature'], ['SQL report', 'Write SQL for monthly sales by state']],
  research: [['Agritech in Nigeria', 'Research key players and trends with sources'], ['Compare fintech apps',
    'Compare Opay vs Palmpay'], ['History of Lagos', 'Research the history of Lagos and its economy'],
    ['Solar for small businesses', 'Research solar costs and payback for small businesses']],
  general: [['Plan my week', 'Help me plan a balanced week of work, rest and exercise'], ['Write a message',
    'Write a polite message to my landlord about repairs'], ['Explain inflation',
    'Explain inflation in simple Nigerian terms'], ['Quick maths', 'What is 15% of 85000?']]
};
// v0.5.7: the timed CBT practice test has its own screen (pages/cbt.js).
function cbtCard() { return '<a class="explore-card cbt-explore" href="#/cbt"><b>' + icon('target')
  + 'CBT practice test</b><span>10 WAEC, NECO or JAMB-style questions in 5 minutes, marked instantly</span></a>'; }
CW.pages.explore = function (page) {
  page.innerHTML = (
    '<div class="cw-screen"><header class="cw-screen-head"><div><h1 class="h1">Explore</h1><p class="lead">Ideas '
    + 'to get you started in each mode. Tap one to load it into the message box.</p></div></header>') +
    Object.keys(EXPLORE).map(function (k) {
      var m = CW.MODES[k];
      return '<div class="section-title">' + icon(m.icon) + ' ' + esc(m.label) + '</div><div class="explore-grid">'
        + (k === 'study' ? cbtCard() : '') + EXPLORE[k].map(function (x) {
        return '<button type="button" class="explore-card" data-ex-mode="' + k + '" data-ex="' + esc(x[1]) + '"><b>'
          + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></button>';
      }).join('') + '</div>';
    }).join('') + '</div>';
  page.querySelectorAll('[data-ex]').forEach(function (b) { b.addEventListener('click', function () { CW.startWith(
    b.getAttribute('data-ex'), b.getAttribute('data-ex-mode')); }); });
};
