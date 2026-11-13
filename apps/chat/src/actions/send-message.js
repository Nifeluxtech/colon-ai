/* Colon AI · sending a message and streaming the reply; regenerate, stop and edit-and-resend. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonMarkdown } from '../../../../packages/ui/js/markdown/index.js';
import { autoGrow, scrollBottom, syncComposer } from '../components/composer.js';
import { announce, paintMessage, renderThread } from '../components/message.js';
import { updateHeader } from '../components/model-picker.js';
import { refreshConvs } from '../components/sidebar.js';
import { $, S, data, defaultModel, isMobile, mode, modelId, rafThrottle } from '../core/state.js';
import { setView } from '../pages/chat.js';

var C = Colon, esc = C.esc;

/* ================= Streaming send ================= */
function send() {
  var ta = $('#cw-input'), text = ta.value.trim(), atts = S.media.ready(), st = S.media.state();
  if (S.streaming) return;
  if (st.uploading) { C.toast('Wait for your files to finish uploading.'); return; }
  if (!text && !atts.length) return;
  if (S.media.voiceActive()) S.media.stopVoice();
  var conv = S.current && !S.loadingConv ? Promise.resolve(S.current) : data.createConversation({ mode: S.draftMode,
    model: S.draftModel || defaultModel() });
  ta.value = ''; autoGrow(); S.media.clear(true); syncComposer();
  conv.then(function (c) {
    var fresh = !S.current || S.current.id !== c.id;
    if (fresh) {
      S.current = c; S.messages = [];
      var w = $('.cw-welcome'); if (w) w.classList.add('leaving');
      history.replaceState(null, '', '#/c/' + encodeURIComponent(c.id)); setView('chat');
      S.el.querySelectorAll('[data-nav]').forEach(function (a) { a.classList.toggle('active', a.getAttribute(
        'data-nav') === '/'); });
    }
    var temp = { id: C.uid('tmp'), role: 'user', content: text, attachments: atts, created_at: new Date().toISOString(
      ) };
    S.messages.push(temp); renderThread(); updateHeader(); scrollBottom(true);
    run(function (o) { return data.send(Object.assign({ conversationId: c.id, content: text, attachments: atts,
      mode: c.mode, model: c.model || defaultModel() }, o)); }, temp);
  }).catch(function (e) { ta.value = text; autoGrow(); syncComposer(); C.toast(e.message, 'bad'); });
}
function run(call, tempUser, replaceId) {
  var ctl = new AbortController(), msg = null;
  S.streaming = { ctl: ctl }; syncComposer();
  var paint = rafThrottle(function () { if (msg) paintMessage(msg); });
  call({
    signal: ctl.signal,
    onEvent: function (ev) {
      if (ev.type === 'user' && tempUser) { S.seen[ev.message.id] = 1; tempUser.id = ev.message.id;
        if (ev.conversation) S.current = Object.assign(S.current || {}, ev.conversation); updateHeader(); }
      else if (ev.type === 'start') {
        msg = ev.message; msg.content = msg.content || ''; S.streaming.msgId = msg.id;
        var at = replaceId ? S.messages.findIndex(function (m) { return m.id === replaceId; }) : -1;
        if (at > -1) S.messages.splice(at, 1, msg); else S.messages.push(msg);
        renderThread(); scrollBottom();
      }
      else if (ev.type === 'sources' && msg) { msg.sources = ev.sources; renderThread(); scrollBottom(); }
      else if (ev.type === 'status' && msg) { msg.stage = ev.stage; msg.stageCount = ev.count || 0; paint(); }
      else if (ev.type === 'delta' && msg) { if (data.kind === 'remote') msg.content += ev.text; paint(); }
      else if (ev.type === 'done' && msg) { Object.assign(msg, ev.message || {}); }
    }
  }).then(function () { finish(); }, function (e) {
    if (msg && msg.status === 'streaming') { msg.status = 'error'; msg.error = { code: e.code, message: e.message }; }
    else if (!msg) S.messages.push({ id: C.uid('m'), role: 'assistant', content: '', status: 'error',
      error: { code: e.code, message: e.message }, model: modelId(), mode: mode(), created_at: new Date().toISOString(
      ) });
    finish();
  });
  function finish() {
    S.streaming = null; renderThread(); syncComposer(); scrollBottom(); refreshConvs(); updateHeader();
    if (msg && msg.status === 'complete') announce('Colon Saga replied.');
    if (S.hf) S.hf.replyDone(msg, msg && msg.content ? ColonMarkdown.toText(msg.content) : '');
  }
}
function stopStreaming() { if (S.streaming) S.streaming.ctl.abort(); }
function regenerate(mid) {
  if (S.streaming || !S.current) return;
  run(function (o) { return data.regenerate(Object.assign({ conversationId: S.current.id, messageId: mid }, o));
    }, null, mid);
}

/* ================= Edit a sent message ================= */
// Rewrites the question in place; everything after it is replaced by a fresh answer (like ChatGPT).
function editMessage(m) {
  if (S.streaming || !S.current) return;
  var node = S.el.querySelector('.cw-msg[data-mid="' + CSS.escape(m.id) + '"]'); if (!node) return;
  node.classList.add('editing');
  var bubble = node.querySelector('.cw-bubble');
  bubble.innerHTML =
    '<form class="cw-edit" novalidate><textarea class="textarea" maxlength="16000" aria-label="Edit your message">'
    + esc(m.content) + '</textarea>' +
    ('<div class="cw-edit-actions"><button type="button" class="btn sm ghost" '
      + 'data-edit-cancel>Cancel</button><button type="submit" class="btn sm primary">Send</button></div></form>');
  node.querySelector('.cw-actions').hidden = true;
  var ta = bubble.querySelector('textarea');
  var grow = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; };
  ta.addEventListener('input', grow); setTimeout(function () { grow(); ta.focus(); ta.setSelectionRange(
    ta.value.length, ta.value.length); }, 20);
  ta.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); renderThread();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && S.settings.enterToSend
    && !('ontouchstart' in window && isMobile())) { e.preventDefault(); bubble.querySelector('form').requestSubmit();
    } });
  bubble.querySelector('[data-edit-cancel]').addEventListener('click', function () { renderThread(); });
  bubble.querySelector('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = ta.value.trim();
    if (!text && !(m.attachments && m.attachments.length)) { C.toast('Type a message first.', 'bad'); return; }
    if (text === m.content) { renderThread(); return; }
    var idx = S.messages.indexOf(m);
    m.content = text; S.messages.splice(idx + 1);
    renderThread(); scrollBottom(true);
    run(function (o) { return data.edit(Object.assign({ conversationId: S.current.id, messageId: m.id, content: text },
      o)); }, null, null);
  });
}

export { editMessage, regenerate, send, stopStreaming };
