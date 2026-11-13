/* Colon AI · guest adapter: signed-out chats streamed from POST /chat/guest, kept in this tab only. */

import { DEFAULT_SETTINGS, LIMITS, classify, now, summary } from './common.js';
import { offline, readSSE } from './sse.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonMarkdown } from '../../../../packages/ui/js/markdown/index.js';
import { ColonResponder } from '../lib/responder.js';

var C = Colon;

/* ---------- Guest implementation (nothing saved; this tab's memory only) ----------
   Also used inside RemoteChatData for temporary chats when "Save chat history" is off. */
function GuestChatData(opts) {
  opts = opts || {};
  var api = C.api, convs = {}, files = {}, modelsCache = null;
  var settings = Object.assign({}, DEFAULT_SETTINGS, { voice: Object.assign({}, DEFAULT_SETTINGS.voice) });
  function notFound() { return Object.assign(new Error('This chat wasn’t saved, so it’s gone. Start a new one.'),
    { code: 'not_found', status: 404 }); }
  function get(id) { var c = convs[id]; if (!c) throw notFound(); return c; }
  function fileFor(a) {
    var f = files[a.id];
    return f ? { name: f.name, kind: f.kind, text: f.text || '', pages: f.pages, note: f.note } : { name: a.name,
      kind: a.kind, text: '', note: opts.signedIn ? undefined : 'This file was removed.' };
  }
  // Streams a reply for the latest user turn. `replaceAt` puts the reply at that index (regenerate).
  function stream(c, o, replaceAt, version) {
    var emit = o.onEvent || function () {}, msg = null;
    var turns = c.messages.slice(0, replaceAt > -1 ? replaceAt : c.messages.length).filter(function (m) {
      return m.role === 'user' || (m.role === 'assistant' && (m.status === 'complete' || m.status === 'stopped')
      && m.content); });
    var lastUser = turns.filter(function (m) { return m.role === 'user'; }).pop();
    var body = {
      messages: turns.slice(-40).map(function (m) { return { role: m.role, content: m.content || '',
        attachments: opts.signedIn ? [] : (m.attachments || []).map(fileFor) }; }),
      mode: c.mode, model: c.model, language: (C.user && C.user.language) || 'en'
    };
    if (opts.signedIn && lastUser && lastUser.attachments && lastUser.attachments.length) body.attachment_ids =
      lastUser.attachments.map(function (a) { return a.id; });
    return api('/chat/guest', { method: 'POST', body: body, raw: true, signal: o.signal }).then(function (res) {
      return readSSE(res, function (ev) {
        if (ev.type === 'start') {
          msg = Object.assign({}, ev.message, { content: '', temporary: true, version: version || 1 });
          if (replaceAt > -1) c.messages.splice(replaceAt, 1, msg); else c.messages.push(msg);
          emit({ type: 'start', message: msg });
        } else if (ev.type === 'delta' && msg) { msg.content += ev.text; emit(ev); }
        else if (ev.type === 'done' && msg) { Object.assign(msg, ev.message, { version: msg.version });
          emit({ type: 'done', message: msg }); }
        else emit(ev);
      });
    }).catch(offline).then(function () {
      c.updated_at = now(); if (msg) c.preview = ColonMarkdown.toText(msg.content).slice(0, 120); return msg;
    }, function (e) {
      if (msg) {
        if (e.name === 'AbortError') msg.status = 'stopped';
        else { msg.status = 'error'; msg.error = { code: e.code || 'error', message: e.message }; }
        if (e.name === 'AbortError') return msg;
      }
      throw e;
    });
  }
  var self = {
    kind: 'guest', LIMITS: LIMITS, classify: classify, temporary: true,
    describe: opts.signedIn ? 'Temporary chat: not saved to your account, and gone when you close this tab.' :
      'Guest mode: this chat isn’t saved. Log in to save your chats and pick them up on any device.',
    has: function (id) { return !!convs[id]; },
    listModels: function () { return modelsCache ? Promise.resolve(modelsCache) : api('/models').then(function (d) {
      modelsCache = d.models; return d.models; }); },
    listConversations: function (o) {
      o = o || {}; var q = (o.q || '').toLowerCase().trim();
      return Promise.resolve(Object.keys(convs).map(function (k) { return convs[k]; })
        .filter(function (c) { return o.archived === 'all' || !!c.archived === !!o.archived; })
        .filter(function (c) { return !q || (c.title + ' ' + c.messages.map(function (m) { return m.content;
          }).join(' ')).toLowerCase().indexOf(q) > -1; })
        .sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; }).map(summary));
    },
    createConversation: function (o) {
      var c = { id: C.uid('t'), title: 'New chat', mode: o.mode || 'general', model: o.model, pinned: false,
        archived: false, messages: [], created_at: now(), updated_at: now(), temporary: true };
      convs[c.id] = c; return Promise.resolve(summary(c));
    },
    getConversation: function (id) { return Promise.resolve().then(function () { var c = get(id);
      return { conversation: summary(c), messages: c.messages.slice() }; }); },
    updateConversation: function (id, patch) {
      return Promise.resolve().then(function () {
        var c = get(id);
        ['title', 'pinned', 'archived', 'mode', 'model'].forEach(function (k) { if (patch[k] !== undefined) c[
          k] = patch[k]; });
        if (patch.mode && c.messages.length) c.messages.push({ id: C.uid('e'), role: 'event', content: 'Switched to '
          + patch.mode + ' mode', created_at: now() });
        c.updated_at = now(); return summary(c);
      });
    },
    deleteConversation: function (id) { delete convs[id]; return Promise.resolve({ ok: true }); },
    deleteAll: function () { convs = {}; files = {}; return Promise.resolve({ ok: true }); },
    exportAll: function () { return Promise.resolve({ app: 'Colon AI', exported_at: now(), format: 1,
      conversations: Object.keys(convs).map(function (k) { return convs[k]; }) }); },
    send: function (o) {
      return Promise.resolve().then(function () {
        var c = get(o.conversationId);
        var user = { id: C.uid('m'), role: 'user', content: o.content, attachments: (o.attachments || []).map(function (
          a) { return { id: a.id, name: a.name, type: a.type, size: a.size, kind: a.kind, width: a.width,
          height: a.height, duration: a.duration }; }), created_at: now(), mode: c.mode };
        c.messages.push(user);
        if (c.title === 'New chat') c.title = ColonResponder.titleFrom(o.content || (user.attachments[0]
          && user.attachments[0].name) || 'New chat');
        if (o.onEvent) o.onEvent({ type: 'user', message: user, conversation: summary(c) });
        return stream(c, o, -1);
      });
    },
    regenerate: function (o) {
      return Promise.resolve().then(function () {
        var c = get(o.conversationId);
        var idx = c.messages.findIndex(function (m) { return m.id === o.messageId; });
        var before = idx > -1 ? c.messages.slice(0, idx) : c.messages;
        if (!before.some(function (m) { return m.role === 'user'; })) throw Object.assign(new Error(
          'There’s nothing to regenerate yet.'), { code: 'invalid' });
        var version = idx > -1 ? (c.messages[idx].version || 1) + 1 : 1;
        if (idx > -1) c.messages.splice(idx + 1);
        return stream(c, o, idx, version);
      });
    },
    edit: function (o) {
      return Promise.resolve().then(function () {
        var c = get(o.conversationId);
        var idx = c.messages.findIndex(function (m) { return m.id === o.messageId && m.role === 'user'; });
        if (idx < 0) throw notFound();
        c.messages[idx].content = o.content; c.messages.splice(idx + 1);
        return stream(c, o, -1);
      });
    },
    share: function () { return Promise.reject(Object.assign(new Error(opts.signedIn
      ? 'Temporary chats can’t be shared. Turn on “Save chat history” in Settings first.' :
      'Log in to share your chats.'), { code: 'login_required' })); },
    unshare: function () { return Promise.resolve(); },
    addNote: function (cid, note) {
      return Promise.resolve().then(function () {
        var c = get(cid);
        var msg = { id: C.uid('m'), role: 'assistant', content: note.content, sources: note.sources || [],
          status: 'complete', model: c.model, mode: c.mode, created_at: now(), origin: note.origin || 'note' };
        c.messages.push(msg); if (c.title === 'New chat' && note.title) c.title = ColonResponder.titleFrom(note.title);
        c.updated_at = now(); return msg;
      });
    },
    feedback: function (cid, mid, fb) {
      return Promise.resolve().then(function () {
        var c = get(cid), m = c.messages.filter(function (x) { return x.id === mid; })[0]; if (!m) throw notFound();
        m.feedback = fb.rating ? { rating: fb.rating, reason: fb.reason || null, comment: fb.comment || null } : null;
          return m.feedback;
      });
    },
    // Guests: the server reads the file's text once and forgets it; the file stays in this tab only.
    upload: function (file, o) {
      o = o || {};
      var k;
      try { k = classify(file, o).kind; } catch (e) { return Promise.reject(e); }
      if (k === 'image') return Promise.reject(Object.assign(new Error('Log in to ask Colon about images.'),
        { code: 'login_required' }));
      if (k === 'audio') return Promise.reject(Object.assign(new Error('Log in to send voice notes.'),
        { code: 'login_required' }));
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest(), fd = new FormData(); fd.append('file', file);
        x.open('POST', C.API + '/chat/guest/extract'); x.withCredentials = true; x.setRequestHeader('X-Colon-Client',
          'chat');
        if (o.signal) o.signal.addEventListener('abort', function () { x.abort(); });
        x.upload.onprogress = function (e) { if (e.lengthComputable && o.onProgress) o.onProgress(e.loaded / e.total);
          };
        x.onload = function () {
          var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {}
          if (x.status >= 300) return reject(Object.assign(new Error(d.message || 'Upload failed.'), { code: d.error
            || 'processing' }));
          var a = d.attachment; files[a.id] = Object.assign({ blob: file }, a);
          resolve({ id: a.id, name: a.name, type: a.type, size: a.size, kind: a.kind });
        };
        x.onerror = function () { reject(Object.assign(new Error('Upload failed. Check your connection.'),
          { code: 'offline' })); };
        x.onabort = function () { reject(Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' })); };
        x.send(fd);
      });
    },
    fileBlob: function (id) { return Promise.resolve(files[id] ? files[id].blob : null); },
    removeUpload: function (id) { delete files[id]; return Promise.resolve({ ok: true }); },
    clearFiles: function () { files = {}; return Promise.resolve({ ok: true }); },
    getSettings: function () { return Promise.resolve(settings); },
    saveSettings: function (p) { if (p.voice) p.voice = Object.assign({}, settings.voice, p.voice);
      settings = Object.assign({}, settings, p); return Promise.resolve(settings); },
    stats: function () { return Promise.resolve({ where: 'This tab only (not saved)' }); },
    // CBT practice test (v0.5.7): POST /study/cbt -> { questions[10], durationSec, exam, examLabel, subject, topic }
    cbt: function (o) { return api('/study/cbt', { method: 'POST', body: o }); }
  };
  return self;
}

export { GuestChatData };
