/* Colon AI · commands in the chat thread (0.22.1). Every command, typed or spoken (phone actions, music, watch, the
   video card's player words, song recognition), shows in the thread as the user's message plus Colon's short reply
   (lib/command-replies.js), saved in the chat's history like any other turn (POST /conversations/:id/notes, origin
   'command'; a reply that starts a video card is origin 'video' and carries the video, so a reload draws the card
   collapsed). In voice mode the reply is also spoken: the same words, by the phone's own TTS in the Android app.
   Lines are written in order (each waits for the one before), whatever order the phone answers in.
     ensureConv() -> Promise<conversation>            this chat, or a new one (also used by send-message.js)
     commandLine(text) -> Promise<message|null>       the user's command
     answer(say, { ok, ends, video }) -> Promise<message|null>
                                                      Colon's reply; ends: voice mode stops after saying it (the
                                                      command left Colon or started music); video: the track that
                                                      the reply's card plays ({ id, title, channel }) */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { scrollBottom } from '../components/composer.js';
import { renderThread } from '../components/message.js';
import { updateHeader } from '../components/model-picker.js';
import { refreshConvs } from '../components/sidebar.js';
import { $, S, data, defaultModel } from '../core/state.js';
import { setView } from '../pages/chat.js';

var C = Colon, chain = Promise.resolve();

/** This chat, or a new one (shown in place of the welcome screen). -> Promise<conversation> */
function ensureConv() {
  var conv = S.current && !S.loadingConv ? Promise.resolve(S.current) : data.createConversation({ mode: S.draftMode,
    model: S.draftModel || defaultModel() });
  return conv.then(function (c) {
    var fresh = !S.current || S.current.id !== c.id;
    if (fresh) {
      S.current = c; S.messages = []; S.browser.createdId = c.id;   // the new chat keeps its browser (adopt)
      var w = $('.cw-welcome'); if (w) w.classList.add('leaving');
      history.replaceState(null, '', '#/c/' + encodeURIComponent(c.id)); setView('chat');
      S.el.querySelectorAll('[data-nav]').forEach(function (a) { a.classList.toggle('active', a.getAttribute(
        'data-nav') === '/'); });
    }
    return c;
  });
}

function local(note) {
  return { id: C.uid('m'), role: note.role === 'user' ? 'user' : 'assistant', content: note.content,
    sources: note.sources || [], status: 'complete', origin: note.origin, created_at: new Date().toISOString() };
}

function add(note) {
  var p = chain.then(ensureConv).then(function (c) {
    // Not saved (offline, the server refused): the line still shows in this chat until it is reloaded.
    return data.addNote(c.id, note).catch(function () { return local(note); }).then(function (m) {
      if (S.current && S.current.id === c.id && m) {
        S.messages.push(m); renderThread(); scrollBottom(true);
      }
      refreshConvs(); updateHeader();
      return m;
    });
  }).catch(function () { C.toast(note.content, note.role === 'user' ? '' : 'ok'); return null; });
  chain = p;
  return p;
}

function commandLine(text) {
  var t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!t) return Promise.resolve(null);
  return add({ role: 'user', origin: 'command', content: t, title: t });
}

function videoSource(t) {
  return { n: 1, title: String(t.title || 'YouTube video').slice(0, 200),
    url: 'https://www.youtube.com/watch?v=' + t.id, snippet: String(t.channel || '').slice(0, 200) };
}

function handsFree() { return !!(S.hf && S.hf.active()); }

/** Colon's reply in the thread, and spoken in voice mode. */
function answer(say, o) {
  o = o || {};
  var ok = o.ok !== false;
  C.native.haptic(ok ? 'confirm' : 'reject');
  if (handsFree()) {
    if (o.ends && ok && S.hf.finalReply) S.hf.finalReply(say);
    else S.hf.replyDone({ status: 'complete' }, say);
  }
  var video = o.video && /^[\w-]{11}$/.test(o.video.id) ? o.video : null;
  return add({ role: 'assistant', origin: video ? 'video' : 'command', content: say,
    sources: video ? [videoSource(video)] : [] });
}

export { answer, commandLine, ensureConv };
