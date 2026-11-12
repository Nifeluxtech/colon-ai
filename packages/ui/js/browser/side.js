/* ColonBrowser · the side panel: browser control and AI Browse (task, steps, approvals, summary). */

import { Colon } from '../colon.js';
import { ColonMarkdown } from '../markdown/index.js';
import { ColonURL } from '../url.js';
import { MODES } from './shared.js';

var C = Colon, U = ColonURL, icon = C.icon, esc = C.esc;

export function installSide(ctx) {
  function renderSide() {
    var m = ctx.session.control, t = ctx.runner.state(), tab = ctx.active();
    ctx.el.classList.toggle('side-open', ctx.sideOpen);
    var running = t && /planning|running|awaiting_approval|paused/.test(t.status);
    var html = ('<div class="cb-panel"><div class="cb-panel-head"><b>Browser Control</b><button class="icon-btn sm" '
      + 'data-a="side-close" aria-label="Close panel">') + icon('x') + '</button></div>' +
      '<div class="cb-modes" role="radiogroup" aria-label="Control mode">' +
      ['ai', 'manual', 'shared'].map(function (k) { return '<button type="button" role="radio" aria-checked="'
        + (m === k) + '" class="cb-mode-btn m-' + k + (m === k ? ' on' : '') + '" data-mode="' + k + '">' + icon(MODES[
        k].icon) + MODES[k].label + '</button>'; }).join('') + '</div>' +
      '<p class="tiny muted" style="margin:8px 2px 0">' + esc(MODES[m].desc) + '</p>' +
      '<div class="cb-session"><span class="status-dot' + (running ? ' live' : '')
        + '"></span><div><b>Active session</b><div class="tiny muted cb-ellipsis">' + esc(/^colon:/.test(tab.url)
        ? 'New tab' : tab.url) + '</div></div></div>' +
      '<div class="cb-ctl-btns">' +
      '<button class="btn sm ' + (m !== 'manual' ? 'primary' : '') + '" data-a="take"' + (m === 'manual'
        ? ' disabled' : '') + '>' + icon('hand') + 'Take Control</button>' +
      '<button class="btn sm" data-a="return"' + (m === 'ai' ? ' disabled' : '') + '>' + icon('sparkles')
        + 'Return to AI</button>' +
      '<button class="btn sm" data-a="pause"' + (!running || m === 'manual' ? ' disabled' : '') + '>' + icon(t
        && t.status === 'paused' ? 'play' : 'pause') + (t && t.status === 'paused' ? 'Resume AI' : 'Pause AI')
        + '</button>' +
      '<button class="btn sm danger" data-a="stop"' + (!running ? ' disabled' : '') + '>' + icon('stop')
        + 'Stop task</button>' +
      '<button class="btn sm" data-a="fullscreen">' + icon('maximize') + 'Full Screen</button></div></div>';
    html += '<div class="cb-panel cb-ai"><div class="cb-panel-head"><b>' + icon('sparkles') + ' AI Browse</b>' + (t
      ? '<span class="badge ' + ctx.statusBadge(t.status) + '">' + ctx.statusLabel(t.status) + '</span>' : '')
        + '</div>';
    var formHtml = '';
    if (!t || /done|stopped|error/.test(t.status)) {
      formHtml = '<form class="cb-task-form"' + (t ? ' style="margin-top:14px"' : '')
        + '><label class="label" for="cb-goal-' + ctx.variant + '">What should Saga find?</label>' +
        '<textarea class="textarea" id="cb-goal-' + ctx.variant
          + '" rows="2" maxlength="300" placeholder="e.g. Research the history of Lagos and its economy"></textarea>' +
        '<button class="btn primary sm block" type="submit">' + icon('sparkles') + 'Start AI Browse</button>' +
        ('<p class="tiny muted" style="margin:0">Saga searches and reads pages in reader preview and logs every '
          + 'action. ') + (m === 'shared' ? 'Shared mode: you approve each step.' :
          'Switch to Shared to approve each step.') + '</p></form>';
    }
    if (!t) html += formHtml;
    if (t) {
      var cur = t.steps.filter(function (s) { return /running|awaiting/.test(s.status); })[0];
      html += '<div class="cb-task"><div class="tiny muted">Current task</div><div class="cb-task-goal">' + esc(t.goal)
        + '</div>' +
        '<div class="cb-kv"><span>Website</span><b class="cb-ellipsis">' + esc(t.site || '—') + '</b></div>' +
        '<div class="cb-kv"><span>Progress</span><b>' + t.progress
          + '%</b></div><div class="progress"><i style="width:' + t.progress + '%"></i></div>';
      if (t.status === 'awaiting_approval' && cur) {
        html += ('<div class="cb-approve" role="alertdialog" aria-label="Approval needed"><div class="tiny" '
          + 'style="font-weight:700;color:var(--cyan)">Saga wants to</div><div>') + esc(cur.label) + (cur.url
          ? '<div class="tiny muted cb-ellipsis">' + esc(cur.url) + '</div>' : '') + '</div>' +
          '<div class="cb-approve-btns"><button class="btn xs primary" data-a="approve">' + icon('check')
            + 'Approve</button><button class="btn xs" data-a="skip">Skip</button><button class="btn xs" data-a="take">'
            + icon('hand') + 'Take control</button></div></div>';
      }
      html += '<ol class="cb-steps">' + t.steps.map(function (s) { return '<li class="st-' + s.status
        + '"><span class="cb-step-ico">' + ctx.stepIcon(s.status) + '</span><span>' + esc(s.label) + (s.error
        ? '<span class="tiny" style="display:block;color:var(--bad)">' + esc(s.error) + '</span>' : '')
        + '</span></li>'; }).join('') + '</ol>';
      if (t.error) html += '<div class="banner bad" style="margin:10px 0 0">' + icon('alert') + '<span>' + esc(t.error)
        + '</span></div>';
      if (t.summary) {
        html += '<div class="cb-summary md">' + ColonMarkdown.render(t.summary, { sources: t.sources }) + '</div>' +
          (ctx.opts.onSummary ? '<button class="btn sm secondary block" data-a="send-summary" style="margin-top:8px">'
            + icon('send') + 'Add to chat</button>' : '');
      }
      if (t.sources.length) html += '<div class="cb-sub">Sources discovered (' + t.sources.length
        + ')</div><div class="cb-sources">' + t.sources.map(function (s) { return '<a href="' + esc(s.url)
        + '" data-nav="' + esc(s.url) + '"><span class="cb-src-n">' + s.n + '</span><span><b>' + esc(s.title)
        + '</b><span class="tiny muted cb-ellipsis">' + esc(U.hostOf(s.url)) + '</span></span></a>';
        }).join('') + '</div>';
      html += '<div class="cb-sub">Actions performed (' + t.actions.length + ')</div><ol class="cb-log">'
        + t.actions.slice().reverse().map(function (a) { return '<li class="lg-' + a.kind + '"><time>' + new Date(
        a.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</time>'
        + esc(a.text) + '</li>'; }).join('') + '</ol>';
      if (running) html += '<div class="cb-ctl-btns two"><button class="btn sm" data-a="pause">' + icon(
        t.status === 'paused' ? 'play' : 'pause') + (t.status === 'paused' ? 'Resume' : 'Pause')
        + '</button><button class="btn sm danger" data-a="stop">' + icon('stop') + 'Stop</button></div>';
      else html += '<button class="btn sm ghost block" data-a="clear-task" style="margin-top:8px">Clear task</button>';
      html += '</div>' + formHtml;
    }
    html += '</div>';
    var keep = ctx.side.querySelector('textarea'), kv = keep ? keep.value : '', focus = keep
      && document.activeElement === keep;
    ctx.side.innerHTML = html;
    var ta = ctx.side.querySelector('textarea'); if (ta) { ta.value = kv; if (focus) ta.focus(); }
  }
  ctx.renderSide = renderSide;
}
