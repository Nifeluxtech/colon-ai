/* Colon AI · image generation in chat (v0.17.0, Blueprint D15).
   Two ways in: the composer's `/image <prompt>` command, and the chat model's generate_image tool (the stream's
   `image` event, { prompt, message_id }). Both call POST /conversations/:id/images; the reply is an assistant
   message with the image attached (or an error card: the credit was given back). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { scrollBottom } from '../components/composer.js';
import { renderThread } from '../components/message.js';
import { updateHeader } from '../components/model-picker.js';
import { refreshConvs } from '../components/sidebar.js';
import { S, data, mode, modelId } from '../core/state.js';
import { imagePromptProblem } from '../lib/chat-tools.js';

var C = Colon;

// Signed in, in a saved chat: the only place images can be made.
function imageBlocker(cid) {
  if (typeof data.generateImage !== 'function') return 'Log in to make images with Colon.';
  if (cid && data.isTemp && data.isTemp(cid)) return 'Images need a saved chat. Turn on “Save chat history” in '
    + 'Settings.';
  return null;
}
function pendingReply() {
  return { id: C.uid('img'), role: 'assistant', content: '', status: 'streaming', stage: 'image', origin: 'image',
    model: modelId(), mode: mode(), created_at: new Date().toISOString() };
}
function swap(old, next) {
  var i = S.messages.indexOf(old);
  if (i > -1) S.messages.splice(i, 1, next); else S.messages.push(next);
}

/** Makes the image and shows it. o: { conv, prompt, messageId?, tempUser? } (tempUser: the composer's own bubble). */
function makeImage(o) {
  var cid = o.conv.id, pending = pendingReply();
  S.imaging = (S.imaging || 0) + 1;
  S.messages.push(pending); renderThread(); scrollBottom(true);
  return data.generateImage(cid, { prompt: o.prompt, messageId: o.messageId }).then(function (r) {
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

/** `/image <prompt>` typed in the composer. ensureConv() -> Promise<conversation>. Returns false if not handled. */
function imageCommand(prompt, ensureConv) {
  var problem = imagePromptProblem(prompt) || imageBlocker(S.current && S.current.id);
  if (problem) { C.toast(problem, 'bad'); return false; }
  ensureConv().then(function (c) {
    var bad = imageBlocker(c.id); if (bad) { C.toast(bad, 'bad'); return; }
    var tempUser = { id: C.uid('tmp'), role: 'user', content: prompt, origin: 'image', attachments: [],
      created_at: new Date().toISOString() };
    S.messages.push(tempUser);
    makeImage({ conv: c, prompt: prompt, tempUser: tempUser });
  }).catch(function (e) { C.toast(e.message, 'bad'); });
  return true;
}

/** The chat model called generate_image during a reply (SSE `image`): make it for that user message. */
function imageFromStream(ev) {
  if (!S.current || !ev || !ev.prompt) return;
  var bad = imageBlocker(S.current.id); if (bad) { C.toast(bad, 'bad'); return; }
  makeImage({ conv: S.current, prompt: ev.prompt, messageId: ev.message_id });
}

export { imageCommand, imageFromStream };
