/* Colon AI · image generation and editing in chat (v0.17.0, Blueprint D15; editing v0.17.1).
   Ways in: the composer's `/image <prompt>` command (with an image attached, or one picked with Edit on a generated
   image, it is an edit of that image), and the chat model's generate_image tool (the stream's `image` event,
   { prompt, message_id, attachment_ids? }). All call POST /conversations/:id/images; the reply is an assistant message
   with the image attached (or an error card: the credit was given back). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { autoGrow, scrollBottom, syncComposer } from '../components/composer.js';
import { renderThread } from '../components/message.js';
import { updateHeader } from '../components/model-picker.js';
import { refreshConvs } from '../components/sidebar.js';
import { loadAttachmentThumbs } from '../components/uploads.js';
import { $, S, data, mode, modelId } from '../core/state.js';
import { editableIds, imagePromptProblem } from '../lib/chat-tools.js';

var C = Colon, esc = C.esc;

// Signed in, in a saved chat: the only place images can be made.
function imageBlocker(cid) {
  if (typeof data.generateImage !== 'function') return 'Log in to make images with Colon.';
  if (cid && data.isTemp && data.isTemp(cid)) return 'Images need a saved chat. Turn on “Save chat history” in '
    + 'Settings.';
  return null;
}
function pendingReply(edit) {
  return { id: C.uid('img'), role: 'assistant', content: '', status: 'streaming', stage: edit ? 'imageEdit' : 'image',
    origin: 'image', model: modelId(), mode: mode(), created_at: new Date().toISOString() };
}
function swap(old, next) {
  var i = S.messages.indexOf(old);
  if (i > -1) S.messages.splice(i, 1, next); else S.messages.push(next);
}

/** Makes (or edits) the image and shows it. o: { conv, prompt, messageId?, attachmentIds?, tempUser? }
 *  (tempUser: the composer's own bubble; attachmentIds: the images to edit). */
function makeImage(o) {
  var cid = o.conv.id, ids = o.attachmentIds || [], pending = pendingReply(ids.length > 0);
  S.imaging = (S.imaging || 0) + 1;
  S.messages.push(pending); renderThread(); scrollBottom(true);
  return data.generateImage(cid, { prompt: o.prompt, messageId: o.messageId, attachmentIds: ids }).then(function (r) {
    if (!S.current || S.current.id !== cid) return;   // the user moved on; the chat has it when reopened
    if (o.tempUser && r.user_message) { S.seen[r.user_message.id] = 1; swap(o.tempUser, r.user_message); }
    swap(pending, r.message);
    if (r.conversation) S.current = Object.assign(S.current, r.conversation);
  }).catch(function (e) {
    Object.assign(pending, { status: 'error', error: { code: e.code || 'image_unavailable',
      message: e.message } });
  }).then(function () {
    S.imaging--;
    if (S.current && S.current.id === cid) { renderThread(); scrollBottom(); updateHeader(); }
    refreshConvs();
  });
}

/** `/image <prompt>` typed in the composer. ensureConv() -> Promise<conversation>. o: { attachmentIds, atts } when it
 *  edits images (attached, or picked with Edit). Returns false if not handled. */
function imageCommand(prompt, ensureConv, o) {
  o = o || {};
  var ids = o.attachmentIds || [];
  var problem = imagePromptProblem(prompt, ids.length > 0) || imageBlocker(S.current && S.current.id);
  if (problem) { C.toast(problem, 'bad'); return false; }
  ensureConv().then(function (c) {
    var bad = imageBlocker(c.id); if (bad) { C.toast(bad, 'bad'); return; }
    var tempUser = { id: C.uid('tmp'), role: 'user', content: prompt, origin: 'image', attachments: o.atts || [],
      created_at: new Date().toISOString() };
    S.messages.push(tempUser);
    makeImage({ conv: c, prompt: prompt, tempUser: tempUser, attachmentIds: ids });
  }).catch(function (e) { C.toast(e.message, 'bad'); });
  return true;
}

/** The chat model called generate_image during a reply (SSE `image`): make (or edit) it for that user message. */
function imageFromStream(ev) {
  if (!S.current || !ev || !ev.prompt) return;
  var bad = imageBlocker(S.current.id); if (bad) { C.toast(bad, 'bad'); return; }
  makeImage({ conv: S.current, prompt: ev.prompt, messageId: ev.message_id,
    attachmentIds: Array.isArray(ev.attachment_ids) ? ev.attachment_ids.slice(0, 3) : [] });
}

/* ---------- Edit on a generated image (v0.17.1): `/image ` pre-filled, that image as the source ---------- */
/** The image picked with Edit, while it belongs to the open chat (else null). */
function imageSource() {
  var s = S.imageSource;
  return s && S.current && s.conv === S.current.id ? s : null;
}
function renderEditSource() {
  var box = $('.cw-edit-src');
  if (!box) return;
  var s = imageSource();
  box.hidden = !s;
  if (!s) { box.innerHTML = ''; return; }
  box.innerHTML = '<img alt="" data-thumb="' + esc(s.id) + '"><span>Editing <b>' + esc(s.name || 'this image')
    + '</b>. Say what to change.</span><button type="button" class="icon-btn sm" data-edit-src-clear '
    + 'aria-label="Stop editing this image" data-tip="Cancel">×</button>';
  loadAttachmentThumbs(box);
}
function clearImageSource() {
  if (!S.imageSource) return;
  S.imageSource = null; renderEditSource();
}
/** Edit on a reply's image: the composer gets `/image ` with that image as the one to change. */
function startImageEdit(m) {
  var id = editableIds(m && m.attachments)[0];
  if (!id || !S.current) return;
  var bad = imageBlocker(S.current.id); if (bad) { C.toast(bad, 'bad'); return; }
  var a = m.attachments.filter(function (x) { return x.id === id; })[0];
  S.imageSource = { id: a.id, name: a.name, kind: 'image', type: a.type, size: a.size, width: a.width,
    height: a.height, conv: S.current.id };
  var ta = $('#cw-input');
  if (ta) {
    if (!/^\s*\/image\b/i.test(ta.value)) ta.value = '/image ';
    autoGrow(); syncComposer(); ta.focus();
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* not focusable yet */ }
  }
  renderEditSource();
}

export { clearImageSource, imageCommand, imageFromStream, imageSource, renderEditSource, startImageEdit };
