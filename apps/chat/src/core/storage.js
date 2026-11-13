/* Colon AI · offline Preview adapter: conversations, files and settings kept on this device (IndexedDB via
   ColonStore), with replies from the on-device responder. Same interface as the other adapters. */

import { DEFAULT_SETTINGS, LIMITS, classify, now, sleep, summary } from './common.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonMarkdown } from '../../../../packages/ui/js/markdown/index.js';
import { ColonStore } from '../../../../packages/ui/js/store.js';
import { ColonResponder } from '../lib/responder.js';

var C = Colon;

/* ---------- Local implementation ---------- */
function LocalChatData() {
  var db = ColonStore.open('colon-chat', ['conversations', 'files', 'kv']);
  var temp = {}; // conversations kept only in memory when "Save chat history" is off
  var prefs = ColonStore.prefs('colon.chat.settings', DEFAULT_SETTINGS);
  var modelsCache = null;

  function getConv(id) { return temp[id] ? Promise.resolve(temp[id]) : db.get('conversations', id); }
  function putConv(c) { c.updated_at = now(); if (c.temporary) { temp[c.id] = c; return Promise.resolve(c);
    } return db.put('conversations', c); }
  function notFound() { return Object.assign(new Error('This conversation no longer exists.'), { code: 'not_found',
    status: 404 }); }

  function stream(conv, msg, input, o) {
    var signal = o.signal, emit = o.onEvent || function () {};
    emit({ type: 'start', message: msg });
    var language = (C.user && C.user.language) || 'en';
    return Promise.all((input.attachmentIds || []).map(function (id) { return db.get('files', id); })).then(function (
      files) {
      var meta = files.filter(Boolean).map(function (f) { return { name: f.name, kind: f.kind, excerpt: f.excerpt,
        words: f.words, lines: f.lines, width: f.width, height: f.height, duration: f.duration }; });
      return sleep(380 + Math.random() * 400, signal).then(function () {
        return ColonResponder.respond({ content: input.content, mode: conv.mode, language: language, attachments: meta,
          history: conv.messages }, signal);
      });
    }).then(function (r) {
      if (r.sources && r.sources.length) { msg.sources = r.sources; emit({ type: 'sources', sources: r.sources }); }
      var parts = ColonResponder.chunks(r.text), fast = prefs.get().streaming === false;
      var i = 0;
      function next() {
        if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (i >= parts.length) return Promise.resolve();
        var n = fast ? parts.length : 1 + Math.floor(Math.random() * 3), piece = parts.slice(i, i + n).join(''); i += n;
        msg.content += piece; emit({ type: 'delta', text: piece });
        return sleep(fast ? 0 : 14 + Math.random() * 34, signal).then(next);
      }
      return next();
    }).then(function () {
      msg.status = 'complete'; return finish();
    }, function (e) {
      if (e.name === 'AbortError') { msg.status = 'stopped'; return finish(); }
      msg.status = 'error'; msg.error = { code: e.code || 'error', message: e.message || 'Something went wrong.' };
        return finish().then(function () { throw e; });
    });
    function finish() {
      msg.completed_at = now();
      conv.preview = ColonMarkdown.toText(msg.content).slice(0, 120);
      return putConv(conv).then(function () { emit({ type: 'done', message: msg }); return msg; });
    }
  }

  var self = {
    kind: 'local', LIMITS: LIMITS, classify: classify,
    describe: ('Preview mode: chats are saved on this device and replies are generated on-device until the Colon '
      + 'Saga API is connected.'),
    listModels: function () {
      if (modelsCache) return Promise.resolve(modelsCache);
      return fetch('assets/config/models.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(
        'Models unavailable'); return r.json(); })
        .then(function (d) { modelsCache = d.models || []; return modelsCache; });
    },
    listConversations: function (o) {
      o = o || {};
      return db.all('conversations').then(function (all) {
        all = all.concat(Object.keys(temp).map(function (k) { return temp[k]; }));
        var q = (o.q || '').toLowerCase().trim();
        return all.filter(function (c) { return (o.archived === 'all' || !!c.archived === !!o.archived); })
          .filter(function (c) { return !q || (c.title + ' ' + (c.messages || []).map(function (m) { return m.content;
            }).join(' ')).toLowerCase().indexOf(q) > -1; })
          .sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; }).map(summary);
      });
    },
    createConversation: function (o) {
      var s = prefs.get();
      var c = { id: C.uid('c'), title: 'New chat', mode: o.mode || s.defaultMode, model: o.model, pinned: false,
        archived: false, messages: [], created_at: now(), updated_at: now(), temporary: s.saveHistory === false };
      return putConv(c).then(summary);
    },
    getConversation: function (id) {
      return getConv(id).then(function (c) { if (!c) throw notFound(); return { conversation: summary(c),
        messages: c.messages.slice() }; });
    },
    updateConversation: function (id, patch) {
      return getConv(id).then(function (c) {
        if (!c) throw notFound();
        ['title', 'pinned', 'archived', 'mode', 'model'].forEach(function (k) { if (patch[k] !== undefined) c[
          k] = patch[k]; });
        if (patch.mode && c.messages.length) c.messages.push({ id: C.uid('e'), role: 'event', content: 'Switched to '
          + patch.mode + ' mode', created_at: now() });
        return putConv(c).then(summary);
      });
    },
    deleteConversation: function (id) { delete temp[id]; return db.del('conversations', id); },
    deleteAll: function () { temp = {}; return Promise.all([db.clear('conversations'), db.clear('files')]); },
    exportAll: function () {
      return db.all('conversations').then(function (all) { return { app: 'Colon AI', exported_at: now(), format: 1,
        conversations: all.map(function (c) { return Object.assign({}, c); }) }; });
    },
    send: function (o) {
      return getConv(o.conversationId).then(function (c) {
        if (!c) throw notFound();
        var user = { id: C.uid('m'), role: 'user', content: o.content, attachments: o.attachments || [],
          created_at: now(), mode: c.mode };
        c.messages.push(user);
        if (c.title === 'New chat') c.title = ColonResponder.titleFrom(o.content || (o.attachments[0] && o.attachments[
          0].name) || 'New chat');
        var msg = { id: C.uid('m'), role: 'assistant', content: '', sources: [], status: 'streaming', model: c.model,
          mode: c.mode, created_at: now(), preview: true };
        c.messages.push(msg);
        if (o.onEvent) o.onEvent({ type: 'user', message: user, conversation: summary(c) });
        return putConv(c).then(function () { return stream(c, msg, { content: o.content, attachmentIds: (o.attachments
          || []).map(function (a) { return a.id; }) }, o); });
      });
    },
    regenerate: function (o) {
      return getConv(o.conversationId).then(function (c) {
        if (!c) throw notFound();
        var idx = c.messages.findIndex(function (m) { return m.id === o.messageId; });
        var prevUser = c.messages.slice(0, idx).reverse().filter(function (m) { return m.role === 'user'; })[0];
        if (idx < 0 || !prevUser) throw Object.assign(new Error('Nothing to regenerate.'), { code: 'invalid' });
        var old = c.messages[idx];
        var msg = { id: C.uid('m'), role: 'assistant', content: '', sources: [], status: 'streaming', model: c.model,
          mode: c.mode, created_at: now(), preview: true, version: (old.version || 1) + 1 };
        c.messages.splice(idx, 1, msg);
        return putConv(c).then(function () { return stream(c, msg, { content: prevUser.content, attachmentIds: (
          prevUser.attachments || []).map(function (a) { return a.id; }) }, o); });
      });
    },
    edit: function (o) {
      return getConv(o.conversationId).then(function (c) {
        if (!c) throw notFound();
        var idx = c.messages.findIndex(function (m) { return m.id === o.messageId && m.role === 'user'; });
        if (idx < 0) throw notFound();
        var u = c.messages[idx]; u.content = o.content; c.messages.splice(idx + 1);
        var msg = { id: C.uid('m'), role: 'assistant', content: '', sources: [], status: 'streaming', model: c.model,
          mode: c.mode, created_at: now(), preview: true };
        c.messages.push(msg);
        return putConv(c).then(function () { return stream(c, msg, { content: u.content, attachmentIds: (u.attachments
          || []).map(function (a) { return a.id; }) }, o); });
      });
    },
    share: function () { return Promise.reject(Object.assign(new Error(
      'Share links need the Colon service. Try again when you’re online and logged in.'), { code: 'offline' })); },
    unshare: function () { return Promise.resolve(); },
    addNote: function (conversationId, note) {
      return getConv(conversationId).then(function (c) {
        if (!c) throw notFound();
        var msg = { id: C.uid('m'), role: 'assistant', content: note.content, sources: note.sources || [],
          status: 'complete', model: c.model, mode: c.mode, created_at: now(), origin: note.origin || 'note' };
        c.messages.push(msg); if (c.title === 'New chat' && note.title) c.title = ColonResponder.titleFrom(note.title);
        return putConv(c).then(function () { return msg; });
      });
    },
    feedback: function (conversationId, messageId, fb) {
      return getConv(conversationId).then(function (c) {
        var m = c && c.messages.filter(function (x) { return x.id === messageId; })[0]; if (!m) throw notFound();
        m.feedback = fb.rating ? { rating: fb.rating, reason: fb.reason || null, comment: fb.comment || null,
          at: now() } : null;
        return putConv(c).then(function () { return m.feedback; });
      });
    },
    // Reads the file on-device (real progress events), extracts text/metadata, stores it in IndexedDB.
    upload: function (file, o) {
      o = o || {};
      var k;
      try { k = classify(file, o).kind; } catch (e) { return Promise.reject(e); }
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        if (o.signal) o.signal.addEventListener('abort', function () { r.abort(); });
        r.onprogress = function (e) { if (e.lengthComputable && o.onProgress) o.onProgress(e.loaded / e.total * 0.9); };
        r.onabort = function () { reject(Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' })); };
        r.onerror = function () { reject(Object.assign(new Error('“' + file.name
          + '” couldn’t be read. It may be damaged.'), { code: 'processing' })); };
        r.onload = function () {
          var blob = new Blob([r.result], { type: file.type || 'application/octet-stream' });
          var rec = { id: C.uid('f'), name: file.name, type: blob.type, size: file.size, kind: k, created_at: now(),
            blob: blob, duration: o.duration || null };
          var extra = Promise.resolve();
          if (k === 'text') extra = blob.text().then(function (t) {
            if (/\u0000/.test(t.slice(0, 2000))) throw Object.assign(new Error('“' + file.name
              + '” looks like a binary file, not text.'), { code: 'processing' });
            rec.excerpt = t.slice(0, 2000); rec.words = (t.match(/\S+/g) || []).length; rec.lines = t.split(
              '\n').length;
          });
          if (k === 'image') extra = new Promise(function (res, rej) {
            var img = new Image(), url = URL.createObjectURL(blob);
            img.onload = function () { rec.width = img.naturalWidth; rec.height = img.naturalHeight;
              URL.revokeObjectURL(url); res(); };
            img.onerror = function () { URL.revokeObjectURL(url); rej(Object.assign(new Error('“' + file.name
              + '” couldn’t be opened as an image.'), { code: 'processing' })); };
            img.src = url;
          });
          if (k === 'pdf') extra = blob.slice(0, 5).text().then(function (h) { if (h !== '%PDF-') throw Object.assign(
            new Error('“' + file.name + '” isn’t a valid PDF.'), { code: 'processing' }); });
          extra.then(function () { return db.put('files', rec); }).then(function () {
            if (o.onProgress) o.onProgress(1);
            resolve({ id: rec.id, name: rec.name, type: rec.type, size: rec.size, kind: k, width: rec.width,
              height: rec.height, duration: rec.duration });
          }, reject);
        };
        r.readAsArrayBuffer(file);
      });
    },
    fileBlob: function (id) { return db.get('files', id).then(function (f) { return f ? f.blob : null; }); },
    removeUpload: function (id) { return db.del('files', id); },
    clearFiles: function () { return db.clear('files'); },
    getSettings: function () { return Promise.resolve(prefs.get()); },
    saveSettings: function (patch) { var cur = prefs.get(); if (patch.voice) patch.voice = Object.assign({}, cur.voice,
      patch.voice); return Promise.resolve(prefs.set(patch)); },
    stats: function () {
      return Promise.all([db.all('conversations'), db.all('files')]).then(function (r) {
        var bytes = r[1].reduce(function (n, f) { return n + (f.size || 0); }, 0) + JSON.stringify(r[0]).length;
        return { conversations: r[0].length, messages: r[0].reduce(function (n, c) { return n + c.messages.filter(
          function (m) { return m.role !== 'event'; }).length; }, 0), files: r[1].length, bytes: bytes,
          where: 'This device' };
      });
    },
    // CBT practice tests are written by Colon Saga on the server, so Preview has none (pages/cbt.js says so).
    cbt: function () { return Promise.reject(Object.assign(new Error('CBT practice tests need a connection to Colon. '
      + 'Check your connection and try again.'), { code: 'offline' })); }
  };
  return self;
}

export { LocalChatData };
