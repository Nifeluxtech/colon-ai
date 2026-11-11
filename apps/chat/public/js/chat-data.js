/* Colon AI · data adapter. EVERY chat call goes through here; screens never call fetch directly.

   LocalChatData (default today): conversations, files and settings live in this browser
   (IndexedDB), replies come from the on-device preview responder (chat-responder.js) and are
   streamed token by token so stop, regenerate and all UI states behave exactly like the real thing.
   RemoteChatData: the endpoints below. Switch with localStorage['colon.data'] = 'remote'
   (or window.COLON_DATA = 'remote') once the API serves them. Nothing else changes.

   Expected API endpoints (cookie session + X-Colon-Client header; not served by the API yet):
     GET    /models                               -> { models:[{ id,name,description,available,status,default,capabilities[] }] }
     GET    /conversations?q=&archived=0|1        -> { conversations:[{ id,title,mode,model,pinned,archived,preview,created_at,updated_at }] }
     POST   /conversations { mode, model }        -> { conversation }
     GET    /conversations/:id                    -> { conversation, messages:[{ id,role,content,attachments,sources,feedback,status,model,mode,created_at }] }
     PATCH  /conversations/:id { title?,pinned?,archived?,mode?,model? } -> { conversation }
     DELETE /conversations/:id                    DELETE /conversations (all)   GET /conversations/export
     POST   /conversations/:id/messages { content, mode, model, attachment_ids }      -> text/event-stream
     POST   /conversations/:id/messages/:mid/regenerate                              -> text/event-stream
            SSE events: start {message} · delta {text} · sources {sources} · done {message} · error {code,message}
            Provider errors: code 'no_provider' (no AI provider configured), 'quota' (daily limit), 'provider_down'.
     POST   /conversations/:id/notes { content, sources }   (adds an assistant note, e.g. an AI Browse summary)
     POST   /messages/:id/feedback { rating:'up'|'down', reason?, comment? }
     POST   /uploads (multipart: file)  -> { attachment:{ id,name,type,size,kind } }   DELETE /uploads/:id   GET /uploads/:id/file
            Limits enforced server-side too: images 10 MB, PDF/docs 20 MB, text 2 MB, 5 files per message.
     GET    /chat/settings   PATCH /chat/settings { ... }
   Account profile (name, reply language) uses the EXISTING PATCH /account/profile. */
(function (root) {
  'use strict';
  var C = root.Colon;

  var LIMITS = {
    perMessage: 5,
    kinds: {
      image: { max: 10, types: /^image\/(png|jpe?g|webp|gif)$/, ext: /\.(png|jpe?g|webp|gif)$/i, label: 'Image' },
      pdf: { max: 20, types: /^application\/pdf$/, ext: /\.pdf$/i, label: 'PDF' },
      doc: { max: 20, types: /(msword|officedocument|opendocument|rtf)/, ext: /\.(docx?|odt|rtf|pptx?|xlsx?)$/i, label: 'Document' },
      text: { max: 2, types: /^(text\/|application\/(json|xml|x-yaml|javascript|x-sh|sql))/, ext: /\.(txt|md|csv|json|xml|ya?ml|js|ts|py|java|c|cpp|cs|go|rs|php|sql|html|css|sh|log)$/i, label: 'Text file' },
      audio: { max: 10, types: /^audio\//, ext: /\.(webm|ogg|m4a|mp3|wav)$/i, label: 'Voice note', recorderOnly: true }
    },
    accept: 'image/png,image/jpeg,image/webp,image/gif,application/pdf,.doc,.docx,.odt,.rtf,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.json,.xml,.yaml,.yml,.js,.ts,.py,.java,.c,.cpp,.cs,.go,.rs,.php,.sql,.html,.css,.sh,.log'
  };
  // -> { kind } or throws { code, message }
  function classify(file, opts) {
    var name = file.name || '', type = file.type || '';
    var kind = Object.keys(LIMITS.kinds).filter(function (k) { var d = LIMITS.kinds[k]; return d.types.test(type) || d.ext.test(name); })[0];
    if (!kind || (LIMITS.kinds[kind].recorderOnly && !(opts && opts.fromRecorder))) throw Object.assign(new Error('“' + name + '” isn’t a supported file. Use images, PDFs, documents or text files.'), { code: 'unsupported' });
    var max = LIMITS.kinds[kind].max;
    if (file.size > max * 1048576) throw Object.assign(new Error('“' + name + '” is ' + C.fmtBytes(file.size) + '. ' + LIMITS.kinds[kind].label + 's can be up to ' + max + ' MB.'), { code: 'too_large' });
    if (!file.size) throw Object.assign(new Error('“' + name + '” is empty.'), { code: 'empty' });
    return { kind: kind };
  }

  var DEFAULT_SETTINGS = {
    enterToSend: true, defaultMode: 'general', defaultModel: null, showMeta: true, linksInPanel: true, browserLayout: 'split',
    streaming: true, textSize: 'md', saveHistory: true, shareFeedback: true,
    voice: { lang: 'en-NG', method: 'auto', autoSend: false, readAloudRate: 1 }
  };

  function now() { return new Date().toISOString(); }
  function sleep(ms, signal) { return new Promise(function (res, rej) { var t = setTimeout(res, ms); if (signal) signal.addEventListener('abort', function () { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); }); }
  function summary(c) { return { id: c.id, title: c.title, mode: c.mode, model: c.model, pinned: !!c.pinned, archived: !!c.archived, preview: c.preview || '', created_at: c.created_at, updated_at: c.updated_at, temporary: !!c.temporary }; }

  /* ---------- Local implementation ---------- */
  function LocalChatData() {
    var db = root.ColonStore.open('colon-chat', ['conversations', 'files', 'kv']);
    var temp = {}; // conversations kept only in memory when "Save chat history" is off
    var prefs = root.ColonStore.prefs('colon.chat.settings', DEFAULT_SETTINGS);
    var modelsCache = null;

    function getConv(id) { return temp[id] ? Promise.resolve(temp[id]) : db.get('conversations', id); }
    function putConv(c) { c.updated_at = now(); if (c.temporary) { temp[c.id] = c; return Promise.resolve(c); } return db.put('conversations', c); }
    function notFound() { return Object.assign(new Error('This conversation no longer exists.'), { code: 'not_found', status: 404 }); }

    function stream(conv, msg, input, o) {
      var signal = o.signal, emit = o.onEvent || function () {};
      emit({ type: 'start', message: msg });
      var language = (C.user && C.user.language) || 'en';
      return Promise.all((input.attachmentIds || []).map(function (id) { return db.get('files', id); })).then(function (files) {
        var meta = files.filter(Boolean).map(function (f) { return { name: f.name, kind: f.kind, excerpt: f.excerpt, words: f.words, lines: f.lines, width: f.width, height: f.height, duration: f.duration }; });
        return sleep(380 + Math.random() * 400, signal).then(function () {
          return root.ColonResponder.respond({ content: input.content, mode: conv.mode, language: language, attachments: meta, history: conv.messages }, signal);
        });
      }).then(function (r) {
        if (r.sources && r.sources.length) { msg.sources = r.sources; emit({ type: 'sources', sources: r.sources }); }
        var parts = root.ColonResponder.chunks(r.text), fast = prefs.get().streaming === false;
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
        msg.status = 'error'; msg.error = { code: e.code || 'error', message: e.message || 'Something went wrong.' }; return finish().then(function () { throw e; });
      });
      function finish() {
        msg.completed_at = now();
        conv.preview = root.ColonMarkdown.toText(msg.content).slice(0, 120);
        return putConv(conv).then(function () { emit({ type: 'done', message: msg }); return msg; });
      }
    }

    var self = {
      kind: 'local', LIMITS: LIMITS, classify: classify,
      describe: 'Preview mode: chats are saved on this device and replies are generated on-device until the Colon Saga API is connected.',
      listModels: function () {
        if (modelsCache) return Promise.resolve(modelsCache);
        return fetch('config/models.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('Models unavailable'); return r.json(); })
          .then(function (d) { modelsCache = d.models || []; return modelsCache; });
      },
      listConversations: function (o) {
        o = o || {};
        return db.all('conversations').then(function (all) {
          all = all.concat(Object.keys(temp).map(function (k) { return temp[k]; }));
          var q = (o.q || '').toLowerCase().trim();
          return all.filter(function (c) { return (o.archived === 'all' || !!c.archived === !!o.archived); })
            .filter(function (c) { return !q || (c.title + ' ' + (c.messages || []).map(function (m) { return m.content; }).join(' ')).toLowerCase().indexOf(q) > -1; })
            .sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; }).map(summary);
        });
      },
      createConversation: function (o) {
        var s = prefs.get();
        var c = { id: C.uid('c'), title: 'New chat', mode: o.mode || s.defaultMode, model: o.model, pinned: false, archived: false, messages: [], created_at: now(), updated_at: now(), temporary: s.saveHistory === false };
        return putConv(c).then(summary);
      },
      getConversation: function (id) {
        return getConv(id).then(function (c) { if (!c) throw notFound(); return { conversation: summary(c), messages: c.messages.slice() }; });
      },
      updateConversation: function (id, patch) {
        return getConv(id).then(function (c) {
          if (!c) throw notFound();
          ['title', 'pinned', 'archived', 'mode', 'model'].forEach(function (k) { if (patch[k] !== undefined) c[k] = patch[k]; });
          if (patch.mode && c.messages.length) c.messages.push({ id: C.uid('e'), role: 'event', content: 'Switched to ' + patch.mode + ' mode', created_at: now() });
          return putConv(c).then(summary);
        });
      },
      deleteConversation: function (id) { delete temp[id]; return db.del('conversations', id); },
      deleteAll: function () { temp = {}; return Promise.all([db.clear('conversations'), db.clear('files')]); },
      exportAll: function () {
        return db.all('conversations').then(function (all) { return { app: 'Colon AI', exported_at: now(), format: 1, conversations: all.map(function (c) { return Object.assign({}, c); }) }; });
      },
      send: function (o) {
        return getConv(o.conversationId).then(function (c) {
          if (!c) throw notFound();
          var user = { id: C.uid('m'), role: 'user', content: o.content, attachments: o.attachments || [], created_at: now(), mode: c.mode };
          c.messages.push(user);
          if (c.title === 'New chat') c.title = root.ColonResponder.titleFrom(o.content || (o.attachments[0] && o.attachments[0].name) || 'New chat');
          var msg = { id: C.uid('m'), role: 'assistant', content: '', sources: [], status: 'streaming', model: c.model, mode: c.mode, created_at: now(), preview: true };
          c.messages.push(msg);
          if (o.onEvent) o.onEvent({ type: 'user', message: user, conversation: summary(c) });
          return putConv(c).then(function () { return stream(c, msg, { content: o.content, attachmentIds: (o.attachments || []).map(function (a) { return a.id; }) }, o); });
        });
      },
      regenerate: function (o) {
        return getConv(o.conversationId).then(function (c) {
          if (!c) throw notFound();
          var idx = c.messages.findIndex(function (m) { return m.id === o.messageId; });
          var prevUser = c.messages.slice(0, idx).reverse().filter(function (m) { return m.role === 'user'; })[0];
          if (idx < 0 || !prevUser) throw Object.assign(new Error('Nothing to regenerate.'), { code: 'invalid' });
          var old = c.messages[idx];
          var msg = { id: C.uid('m'), role: 'assistant', content: '', sources: [], status: 'streaming', model: c.model, mode: c.mode, created_at: now(), preview: true, version: (old.version || 1) + 1 };
          c.messages.splice(idx, 1, msg);
          return putConv(c).then(function () { return stream(c, msg, { content: prevUser.content, attachmentIds: (prevUser.attachments || []).map(function (a) { return a.id; }) }, o); });
        });
      },
      addNote: function (conversationId, note) {
        return getConv(conversationId).then(function (c) {
          if (!c) throw notFound();
          var msg = { id: C.uid('m'), role: 'assistant', content: note.content, sources: note.sources || [], status: 'complete', model: c.model, mode: c.mode, created_at: now(), origin: note.origin || 'note' };
          c.messages.push(msg); if (c.title === 'New chat' && note.title) c.title = root.ColonResponder.titleFrom(note.title);
          return putConv(c).then(function () { return msg; });
        });
      },
      feedback: function (conversationId, messageId, fb) {
        return getConv(conversationId).then(function (c) {
          var m = c && c.messages.filter(function (x) { return x.id === messageId; })[0]; if (!m) throw notFound();
          m.feedback = fb.rating ? { rating: fb.rating, reason: fb.reason || null, comment: fb.comment || null, at: now() } : null;
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
          r.onerror = function () { reject(Object.assign(new Error('“' + file.name + '” couldn’t be read. It may be damaged.'), { code: 'processing' })); };
          r.onload = function () {
            var blob = new Blob([r.result], { type: file.type || 'application/octet-stream' });
            var rec = { id: C.uid('f'), name: file.name, type: blob.type, size: file.size, kind: k, created_at: now(), blob: blob, duration: o.duration || null };
            var extra = Promise.resolve();
            if (k === 'text') extra = blob.text().then(function (t) {
              if (/\u0000/.test(t.slice(0, 2000))) throw Object.assign(new Error('“' + file.name + '” looks like a binary file, not text.'), { code: 'processing' });
              rec.excerpt = t.slice(0, 2000); rec.words = (t.match(/\S+/g) || []).length; rec.lines = t.split('\n').length;
            });
            if (k === 'image') extra = new Promise(function (res, rej) {
              var img = new Image(), url = URL.createObjectURL(blob);
              img.onload = function () { rec.width = img.naturalWidth; rec.height = img.naturalHeight; URL.revokeObjectURL(url); res(); };
              img.onerror = function () { URL.revokeObjectURL(url); rej(Object.assign(new Error('“' + file.name + '” couldn’t be opened as an image.'), { code: 'processing' })); };
              img.src = url;
            });
            if (k === 'pdf') extra = blob.slice(0, 5).text().then(function (h) { if (h !== '%PDF-') throw Object.assign(new Error('“' + file.name + '” isn’t a valid PDF.'), { code: 'processing' }); });
            extra.then(function () { return db.put('files', rec); }).then(function () {
              if (o.onProgress) o.onProgress(1);
              resolve({ id: rec.id, name: rec.name, type: rec.type, size: rec.size, kind: k, width: rec.width, height: rec.height, duration: rec.duration });
            }, reject);
          };
          r.readAsArrayBuffer(file);
        });
      },
      fileBlob: function (id) { return db.get('files', id).then(function (f) { return f ? f.blob : null; }); },
      removeUpload: function (id) { return db.del('files', id); },
      clearFiles: function () { return db.clear('files'); },
      getSettings: function () { return Promise.resolve(prefs.get()); },
      saveSettings: function (patch) { var cur = prefs.get(); if (patch.voice) patch.voice = Object.assign({}, cur.voice, patch.voice); return Promise.resolve(prefs.set(patch)); },
      stats: function () {
        return Promise.all([db.all('conversations'), db.all('files')]).then(function (r) {
          var bytes = r[1].reduce(function (n, f) { return n + (f.size || 0); }, 0) + JSON.stringify(r[0]).length;
          return { conversations: r[0].length, messages: r[0].reduce(function (n, c) { return n + c.messages.filter(function (m) { return m.role !== 'event'; }).length; }, 0), files: r[1].length, bytes: bytes, where: 'This device' };
        });
      }
    };
    return self;
  }

  /* ---------- Remote implementation ---------- */
  function RemoteChatData() {
    var api = C.api, settings = null, modelsCache = null;
    function sse(path, body, o) {
      var emit = o.onEvent || function () {}, last = null;
      return api(path, { method: 'POST', body: body, raw: true, signal: o.signal }).then(function (res) {
        if (!res.ok) return res.json().catch(function () { return {}; }).then(function (d) { throw Object.assign(new Error(d.message || 'Colon Saga couldn’t answer.'), { code: d.error, status: res.status }); });
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return last;
            buf += dec.decode(r.value, { stream: true });
            var parts = buf.split(/\n\n/); buf = parts.pop();
            parts.forEach(function (block) {
              var ev = 'message', data = '';
              block.split('\n').forEach(function (l) { if (l.indexOf('event:') === 0) ev = l.slice(6).trim(); else if (l.indexOf('data:') === 0) data += l.slice(5).trim(); });
              var d = {}; try { d = data ? JSON.parse(data) : {}; } catch (e) { return; }
              if (ev === 'error') throw Object.assign(new Error(d.message || 'Colon Saga couldn’t answer.'), { code: d.code });
              if (ev === 'done') last = d.message;
              emit(Object.assign({ type: ev }, d));
            });
            return pump();
          });
        }
        return pump();
      });
    }
    return {
      kind: 'remote', LIMITS: LIMITS, classify: classify, describe: 'Chats are synced to your Colon account.',
      listModels: function () { return modelsCache ? Promise.resolve(modelsCache) : api('/models').then(function (d) { modelsCache = d.models; return d.models; }); },
      listConversations: function (o) { o = o || {}; return api('/conversations?q=' + encodeURIComponent(o.q || '') + '&archived=' + (o.archived === 'all' ? 'all' : o.archived ? 1 : 0)).then(function (d) { return d.conversations; }); },
      createConversation: function (o) { return api('/conversations', { method: 'POST', body: o }).then(function (d) { return d.conversation; }); },
      getConversation: function (id) { return api('/conversations/' + encodeURIComponent(id)); },
      updateConversation: function (id, p) { return api('/conversations/' + encodeURIComponent(id), { method: 'PATCH', body: p }).then(function (d) { return d.conversation; }); },
      deleteConversation: function (id) { return api('/conversations/' + encodeURIComponent(id), { method: 'DELETE' }); },
      deleteAll: function () { return api('/conversations', { method: 'DELETE' }); },
      exportAll: function () { return api('/conversations/export'); },
      send: function (o) { return sse('/conversations/' + encodeURIComponent(o.conversationId) + '/messages', { content: o.content, attachment_ids: (o.attachments || []).map(function (a) { return a.id; }) }, o); },
      regenerate: function (o) { return sse('/conversations/' + encodeURIComponent(o.conversationId) + '/messages/' + encodeURIComponent(o.messageId) + '/regenerate', {}, o); },
      addNote: function (cid, note) { return api('/conversations/' + encodeURIComponent(cid) + '/notes', { method: 'POST', body: note }).then(function (d) { return d.message; }); },
      feedback: function (cid, mid, fb) { return api('/messages/' + encodeURIComponent(mid) + '/feedback', { method: 'POST', body: fb }); },
      upload: function (file, o) {
        o = o || {};
        try { classify(file, o); } catch (e) { return Promise.reject(e); }
        return new Promise(function (resolve, reject) {
          var x = new XMLHttpRequest(), fd = new FormData(); fd.append('file', file);
          x.open('POST', C.API + '/uploads'); x.withCredentials = true; x.setRequestHeader('X-Colon-Client', 'chat');
          if (o.signal) o.signal.addEventListener('abort', function () { x.abort(); });
          x.upload.onprogress = function (e) { if (e.lengthComputable && o.onProgress) o.onProgress(e.loaded / e.total); };
          x.onload = function () { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (x.status < 300) resolve(d.attachment); else reject(Object.assign(new Error(d.message || 'Upload failed.'), { code: d.error || 'processing' })); };
          x.onerror = function () { reject(Object.assign(new Error('Upload failed. Check your connection.'), { code: 'offline' })); };
          x.onabort = function () { reject(Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' })); };
          x.send(fd);
        });
      },
      fileBlob: function (id) { return fetch(C.API + '/uploads/' + encodeURIComponent(id) + '/file', { credentials: 'include' }).then(function (r) { return r.ok ? r.blob() : null; }); },
      removeUpload: function (id) { return api('/uploads/' + encodeURIComponent(id), { method: 'DELETE' }); },
      clearFiles: function () { return api('/uploads', { method: 'DELETE' }); },
      getSettings: function () { return settings ? Promise.resolve(settings) : api('/chat/settings').then(function (d) { settings = Object.assign({}, DEFAULT_SETTINGS, d.settings); return settings; }); },
      saveSettings: function (p) { return api('/chat/settings', { method: 'PATCH', body: p }).then(function (d) { settings = Object.assign({}, DEFAULT_SETTINGS, d.settings); return settings; }); },
      stats: function () { return api('/chat/stats').catch(function () { return { where: 'Your Colon account' }; }); }
    };
  }

  function mode() { try { return root.COLON_DATA || root.localStorage.getItem('colon.data') || 'local'; } catch (e) { return 'local'; } }
  var instance = null;
  root.ColonChatData = {
    get: function () { if (!instance) instance = mode() === 'remote' ? RemoteChatData() : LocalChatData(); return instance; },
    LIMITS: LIMITS, classify: classify, DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
})(window);
