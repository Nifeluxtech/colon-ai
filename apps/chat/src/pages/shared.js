/* Colon AI · read-only shared chat screen (#/share/:token) and reporting it. */

import { setView } from './chat.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonMarkdown } from '../../../../packages/ui/js/markdown/index.js';
import { stopStreaming } from '../actions/send-message.js';
import { updateHeader } from '../components/model-picker.js';
import { renderConvs } from '../components/sidebar.js';
import { sourcesHtml } from '../components/sources.js';
import { $, S, modelName } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, MD = ColonMarkdown;

/* ================= Shared chat (read-only, anyone with the link) ================= */
function showShared(token) {
  if (S.streaming) stopStreaming();
  S.current = null; S.messages = []; setView('shared');
  var page = $('#cw-page'); page.className = 'cw-page cw-page-chat cw-page-shared';
  updateHeader(); renderConvs();
  page.innerHTML = '<div class="cw-thread">' + [1, 2].map(function (i) { return '<div class="cw-skel ' + (i % 2
    ? 'u' : 'a') + '"><div class="skel" style="height:' + (i % 2 ? 44 : 96) + 'px"></div></div>';
    }).join('') + '</div>';
  C.api('/shared/' + encodeURIComponent(token)).then(function (d) {
    var c = d.conversation;
    document.title = c.title + ' · Colon AI';
    page.innerHTML = '<div class="cw-shared-head"><span class="badge">' + icon('link')
      + 'Shared chat</span><h1 class="h2">' + esc(c.title) + '</h1>' +
      '<p class="small muted">' + (c.owner ? esc(c.owner) + ' shared this conversation' : 'A shared conversation')
        + ' · ' + esc(C.ago(c.shared_at || c.created_at)) + '. It’s read-only.</p></div>' +
      '<div class="cw-thread">' + d.messages.map(function (m) {
        if (m.role === 'user') return '<div class="cw-msg user"><div class="cw-bubble">' + (m.attachments
          && m.attachments.length ? '<div class="cw-atts">' + m.attachments.map(function (a) {
          return '<span class="cw-att-file">' + icon(a.kind === 'image' ? 'image' : 'fileText') + '<span><b>'
          + esc(a.name) + '</b></span></span>'; }).join('') + '</div>' : '') + (m.content
          ? '<div class="cw-user-text">' + esc(m.content) + '</div>' : '') + '</div></div>';
        return '<div class="cw-msg ai"><div class="cw-ai-head"><span class="cw-ai-mark">' + C.MARK + '</span><b>'
          + esc(modelName(m.model)) + '</b></div><div class="cw-ai-body"><div class="md">' + MD.render(m.content,
          { sources: m.sources }) + '</div></div>' + sourcesHtml(m.sources) + '</div>';
      }).join('') + '</div>' +
      '<div class="cw-shared-cta"><a class="btn primary" href="#/">' + icon('plus')
        + 'Start your own chat</a><button type="button" class="btn ghost sm" data-report>' + icon('alert')
        + 'Report this chat</button></div>';
    var rb = page.querySelector('[data-report]');
    if (rb) rb.addEventListener('click', function () { reportShared(token, rb); });
  }).catch(function (e) {
    page.innerHTML = '<div class="empty cw-error-page">' + icon('link')
      + '<div class="h3">This link doesn’t work</div><p class="small">' + esc(e.message)
      + '</p><a class="btn primary" href="#/">' + icon('plus') + 'New chat</a></div>';
  });
}

// Anyone can report a shared chat; it goes to the Admin Dashboard moderation queue.
var REPORT_REASONS = ['Harmful or dangerous', 'Hate or harassment', 'Sexual content', 'Spam or scam',
  'Private information', 'Other'];
function reportShared(token, btn) {
  C.sheet(('<div class="h2">Report this chat</div><p class="small muted">Tell the Colon team what’s wrong. Reports '
    + 'are reviewed by moderators.</p><form class="form" novalidate>') +
    C.field({ name: 'reason', label: 'Reason', type: 'select', value: REPORT_REASONS[0], options: REPORT_REASONS.map(
      function (r) { return [r, r]; }) }) +
    C.field({ name: 'comment', label: 'Details (optional)', required: false, max: 1000 }) +
    ('<button class="btn primary block" type="submit">Send report</button><button class="btn ghost block" '
      + 'type="button" data-close>Cancel</button></form>'), function (el, close) {
    C.bindForm(el.querySelector('form'), function (d) {
      return C.api('/shared/' + encodeURIComponent(token) + '/report', { method: 'POST', body: d }).then(function () {
        close(); C.toast('Thanks. Our moderators will review it.', 'ok'); btn.disabled = true; });
    });
  });
}

export { showShared };
