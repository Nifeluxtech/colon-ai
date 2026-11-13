/* Colon AI · conversation thread: messages, reply states, error cards, message actions and feedback. */

import { scrollBottom } from './composer.js';
import { sourcesHtml } from './sources.js';
import { attachmentsHtml, loadAttachmentThumbs } from './uploads.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonMarkdown } from '../../../../packages/ui/js/markdown/index.js';
import { editMessage, regenerate } from '../actions/send-message.js';
import { ReadAloud } from '../lib/read-aloud.js';
import { $, MODES, S, STAGES, data, ephemeral, modelName, signedIn } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc, MD = ColonMarkdown;

/* ================= Thread ================= */
function renderThread() {
  var page = $('#cw-page'); page.className = 'cw-page cw-page-chat';
  if (!S.messages.length) { page.innerHTML = '<div class="empty">' + icon('chat')
    + ('<div class="h3">Say hello to Colon Saga</div><p class="small">Ask anything to start this '
    + 'conversation.</p></div>'); return; }
  var lastA = lastAssistant();
  page.innerHTML = '<div class="cw-thread" role="log" aria-live="off">' + S.messages.map(function (m) { return msgHtml(
    m, m === lastA); }).join('') + '</div>';
  S.messages.forEach(function (m) { S.seen[m.id] = 1; });
  loadAttachmentThumbs(page);
}
function lastAssistant() { for (var i = S.messages.length - 1; i >= 0; i--) if (S.messages[
  i].role === 'assistant') return S.messages[i]; return null; }
function msgHtml(m, isLast) {
  var fresh = S.seen[m.id] ? '' : ' fresh';  // entry animation only the first time a message appears
  if (m.role === 'event') return '<div class="cw-event"><span>' + esc(m.content) + '</span></div>';
  if (m.role === 'user') {
    return '<div class="cw-msg user' + fresh + '" data-mid="' + esc(m.id) + '"><div class="cw-bubble">'
      + attachmentsHtml(m.attachments) + (m.content ? '<div class="cw-user-text">' + esc(m.content) + '</div>' : '')
      + '</div>' +
      '<div class="cw-actions"><button class="icon-btn sm" data-msg="copy" aria-label="Copy message" data-tip="Copy">'
        + icon('copy') + '</button>' +
      (S.streaming || /^tmp/.test(m.id)
        ? '' : '<button class="icon-btn sm" data-msg="edit" aria-label="Edit message" data-tip="Edit">' + icon('edit')
        + '</button>') + '</div></div>';
  }
  var streaming = m.status === 'streaming', fb = m.feedback && m.feedback.rating;
  var body = aiBody(m);
  var meta = (S.settings && S.settings.showMeta) ? '<span class="badge">' + icon(MODES[m.mode] ? MODES[m.mode].icon :
    'sparkle') + (MODES[m.mode] ? MODES[m.mode].label : 'General') + '</span>' : '';
  return '<div class="cw-msg ai' + fresh + (streaming ? ' is-streaming' : '') + '" data-mid="' + esc(m.id) + '">' +
    '<div class="cw-ai-head"><span class="cw-ai-mark">' + C.MARK + '</span><b>' + esc(modelName(m.model)) + '</b>'
      + meta +
    (m.origin === 'browse' ? '<span class="badge cyan">' + icon('globe') + 'AI Browse</span>' : '') +
    (m.web && !streaming ? (m.web.ok ? '<span class="badge cyan" data-tip="Answered from a web search just now">'
      + icon('globe')
      + 'Web</span>' :
      '<span class="badge warn" data-tip="Web search wasn’t available for this answer">No web</span>') : '')
      + (m.preview
      ? '<span class="badge" data-tip="Generated on this device. Colon Saga isn’t connected yet.">Preview</span>' : '')
      +
    (m.status === 'stopped' ? '<span class="badge warn">Stopped</span>' : '') + '</div>' +
    '<div class="cw-ai-body">' + body + '</div>' +
    (m.status === 'error' ? errorCard(m) : '') +
    sourcesHtml(m.sources) +
    (streaming ? '' : '<div class="cw-actions">' +
      '<button class="icon-btn sm" data-msg="copy" aria-label="Copy response" data-tip="Copy">' + icon('copy')
        + '</button>' +
      (isLast ? '<button class="icon-btn sm" data-msg="regen" aria-label="Regenerate response" data-tip="Regenerate">'
        + icon('refresh') + '</button>' : '') +
      '<button class="icon-btn sm" data-msg="up" aria-label="Good response" aria-pressed="' + (fb === 'up')
        + '" data-tip="Good response">' + icon('thumbUp') + '</button>' +
      '<button class="icon-btn sm" data-msg="down" aria-label="Bad response" aria-pressed="' + (fb === 'down')
        + '" data-tip="Bad response">' + icon('thumbDown') + '</button>' +
      (ReadAloud.canPlay
        ? '<button class="icon-btn sm" data-msg="speak" aria-label="Read aloud" aria-pressed="' + (S.speaking === m.id)
        + '" data-tip="Read aloud">' + icon('volume') + '</button>' : '') +
      (m.version > 1 ? '<span class="tiny muted">Version ' + m.version + '</span>' : '') + '</div>') +
    '</div>';
}
function aiBody(m) {
  var streaming = m.status === 'streaming';
  if (streaming && !m.content) {
    var st = m.stage && STAGES[m.stage] ? STAGES[m.stage](m.stage === 'writing' ? (m.sources
      || []).length : m.stageCount || 0) : esc(modelName(m.model)) + ' is thinking…';
    return '<div class="cw-thinking' + (m.stage ? ' cw-stage' : '') + '" role="status">' + (m.stage === 'searching'
      || m.stage === 'reading' ? icon('globe') : '') + '<span class="typing"><i></i><i></i><i></i></span><span>'
      + (m.stage ? esc(st) : st) + '</span></div>';
  }
  return '<div class="md' + (streaming ? ' streaming' : '') + '">' + MD.render(m.content, { sources: m.sources })
    + '</div>';
}
function errorCard(m) {
  var e = m.error || {}, noProv = e.code === 'no_provider', needLogin = !signedIn() && (e.code === 'quota'
    || e.code === 'login_required');
  var title = noProv ? 'Colon Saga isn’t connected to an AI provider yet' : e.code === 'quota'
    ? 'You’ve reached today’s limit' : e.code === 'no_vision' ? 'Images can’t be read yet' : e.code === 'offline'
    ? 'You’re offline' : 'This reply didn’t finish';
  var body = noProv ? 'An admin needs to add a provider in the Admin Dashboard.' + (ephemeral()
    ? '' : ' Your message is saved.') : e.message || 'Something went wrong.';
  return '<div class="cw-err" role="alert">' + icon('alert') + '<div><b>' + title + '</b><span>' + esc(body)
    + '</span></div>' +
    (needLogin ? '<button class="btn sm primary" data-a="login">Log in</button>' : noProv || e.code === 'quota'
      ? '' : '<button class="btn sm" data-msg="regen">' + icon('refresh') + 'Retry</button>') + '</div>';
}
function paintMessage(msg) {
  var node = S.el.querySelector('.cw-msg[data-mid="' + CSS.escape(msg.id) + '"] .cw-ai-body');
  if (!node) { renderThread(); return; }
  node.innerHTML = aiBody(msg);
  scrollBottom();
}
function announce(t) { var a = document.getElementById('cw-live') || document.body.appendChild(Object.assign(
  document.createElement('div'), { id: 'cw-live', className: 'sr-only' })); a.setAttribute('aria-live', 'polite');
  a.textContent = t; }
function msgAction(b) {
  var node = b.closest('.cw-msg'), mid = node && node.getAttribute('data-mid'), m = S.messages.filter(function (x) {
    return x.id === mid; })[0], act = b.getAttribute('data-msg');
  if (!m) return;
  if (act === 'edit') { editMessage(m); return; }
  if (act === 'copy') C.copyText(m.content).then(function () { C.toast('Copied.'); }, function () { C.toast(
    'Couldn’t copy.', 'bad'); });
  else if (act === 'regen') regenerate(m.id);
  else if (act === 'up') sendFeedback(m, m.feedback && m.feedback.rating === 'up' ? {} : { rating: 'up' });
  else if (act === 'down') {
    if (m.feedback && m.feedback.rating === 'down') return sendFeedback(m, {});
    C.sheet(('<div class="h2">What went wrong?</div><p class="small muted" style="margin:4px 0 12px">Your feedback '
      + 'helps improve Colon Saga.</p><form class="form" novalidate><div class="cw-reasons">') +
      ['Not accurate', 'Not helpful', 'Wrong language', 'Unsafe or harmful', 'Too long', 'Other'].map(function (r,
        i) { return '<label class="chip sm"><input type="radio" name="reason" value="' + esc(r) + '"' + (i === 0
        ? ' checked' : '') + ' class="sr-only">' + esc(r) + '</label>'; }).join('') +
      ('</div><div class="field"><label for="fb-c">Tell us more (optional)</label><textarea class="textarea" '
        + 'id="fb-c" maxlength="1000"></textarea></div><div class="sheet-actions"><button type="button" class="btn '
        + 'ghost" data-close>Cancel</button><button class="btn primary" type="submit">Send '
        + 'feedback</button></div></form>'), function (el, close) {
      var sync = function () { el.querySelectorAll('.cw-reasons label').forEach(function (l) { l.classList.toggle('on',
        l.querySelector('input').checked); }); };
      el.querySelectorAll('.cw-reasons input').forEach(function (i) { i.addEventListener('change', sync); }); sync();
      el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); sendFeedback(m,
        { rating: 'down', reason: el.querySelector('input[name=reason]:checked').value, comment: el.querySelector(
        '#fb-c').value.trim() }); close(); });
    }, { label: 'Feedback' });
  }
  else if (act === 'speak') {
    if (S.speaking === m.id) { ReadAloud.stop(); S.speaking = null; renderThread(); return; }
    var v = S.settings.voice || {};
    ReadAloud.play(MD.toText(m.content).slice(0, 12000), { engine: v.readAloudVoice || 'auto', speaker: v.speaker,
      rate: v.readAloudRate || 1, lang: v.lang, onStart: function () { C.toast('Preparing the Colon voice…'); },
      onEnd: function () { S.speaking = null; renderThread(); } });
    S.speaking = m.id; renderThread();
  }
}
function sendFeedback(m, fb) {
  var prev = m.feedback; m.feedback = fb.rating ? fb : null; renderThread();
  data.feedback(S.current.id, m.id, fb).then(function () { if (fb.rating) C.toast('Thanks for the feedback.', 'ok');
    }).catch(function (e) { m.feedback = prev; renderThread(); C.toast(e.message, 'bad'); });
}

export { announce, msgAction, paintMessage, renderThread };
