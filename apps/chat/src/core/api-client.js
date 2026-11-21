/* Colon AI · account adapter: conversations, messages, uploads and settings through the Colon API. */

import { DEFAULT_SETTINGS, LIMITS, classify, clientInfo } from './common.js';
import { GuestChatData } from './guest-client.js';
import { offline, readSSE } from './sse.js';
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon;

/* ---------- Remote implementation (signed in: synced to the Colon account) ---------- */
function RemoteChatData() {
  var api = C.api, settings = null, modelsCache = null;
  var temp = GuestChatData({ signedIn: true });  // temporary chats when "Save chat history" is off
  function sse(path, body, o, cid) {
    var emit = o.onEvent || function () {}, startedId = null;
    body.client = clientInfo();   // 0.24.0: app and version, for answers about the app itself
    if (o.signal) o.signal.addEventListener('abort', function () {
      // Closing the stream stops the reply; this also reaches a different server worker if needed.
      if (startedId) api('/conversations/' + encodeURIComponent(cid) + '/messages/' + encodeURIComponent(startedId)
        + '/stop', { method: 'POST' }).catch(function () {});
    });
    return api(path, { method: 'POST', body: body, raw: true, signal: o.signal }).then(function (res) {
      return readSSE(res, function (ev) { if (ev.type === 'start' && ev.message) startedId = ev.message.id; emit(ev);
        });
    }).catch(offline);
  }
  function conv(id) { return '/conversations/' + encodeURIComponent(id); }
  // v0.17.0: like api(), but an error keeps every field of its JSON body (a 409 consent_required carries `credits`).
  function full(path, o) {
    return api(path, { method: o.method || 'GET', body: o.body, raw: true }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (res.ok) return d;
        throw Object.assign(new Error(d.message || 'Something went wrong.'), d, { status: res.status, code: d.error });
      });
    }, function () { throw Object.assign(new Error('Can’t reach Colon right now. Check your connection.'),
      { code: 'offline' }); });
  }
  function run(id) { return '/research/' + encodeURIComponent(id); }
  var self = {
    kind: 'remote', LIMITS: LIMITS, classify: classify, describe: 'Chats are synced to your Colon account.',
    listModels: function () { return modelsCache ? Promise.resolve(modelsCache) : api('/models').then(function (d) {
      modelsCache = d.models; return d.models; }); },
    listConversations: function (o) {
      o = o || {};
      return Promise.all([temp.listConversations(o), api('/conversations?q=' + encodeURIComponent(o.q || '')
        + '&archived=' + (o.archived === 'all' ? 'all' : o.archived ? 1 : 0)).then(function (d) {
        return d.conversations; })])
        .then(function (r) { return r[0].concat(r[1]); });
    },
    createConversation: function (o) {
      return self.getSettings().then(function (s) {
        if (s.saveHistory === false) return temp.createConversation(o);
        return api('/conversations', { method: 'POST', body: o }).then(function (d) { return d.conversation; });
      });
    },
    getConversation: function (id) { return temp.has(id) ? temp.getConversation(id) : api(conv(id)); },
    updateConversation: function (id, p) { return temp.has(id) ? temp.updateConversation(id, p) : api(conv(id),
      { method: 'PATCH', body: p }).then(function (d) { return d.conversation; }); },
    deleteConversation: function (id) { return temp.has(id) ? temp.deleteConversation(id) : api(conv(id),
      { method: 'DELETE' }); },
    deleteAll: function () { return Promise.all([temp.deleteAll(), api('/conversations', { method: 'DELETE' })]); },
    exportAll: function () { return api('/conversations/export'); },
    send: function (o) {
      if (temp.has(o.conversationId)) return temp.send(o);
      // 0.11.5: browser = this chat's browser now (page, summary, numbered clickable items) for the chat model.
      return sse(conv(o.conversationId) + '/messages', { content: o.content, attachment_ids: (o.attachments || []).map(
        function (a) { return a.id; }), browser: o.browser || undefined, voice: o.voice || undefined }, o,
        o.conversationId);
    },
    regenerate: function (o) {
      if (temp.has(o.conversationId)) return temp.regenerate(o);
      return sse(conv(o.conversationId) + '/messages/' + encodeURIComponent(o.messageId) + '/regenerate', {}, o,
        o.conversationId);
    },
    edit: function (o) {
      if (temp.has(o.conversationId)) return temp.edit(o);
      return sse(conv(o.conversationId) + '/messages/' + encodeURIComponent(o.messageId) + '/edit',
        { content: o.content }, o, o.conversationId);
    },
    share: function (id) { return temp.has(id) ? temp.share(id) : api(conv(id) + '/share', { method: 'POST' }).then(
      function (d) { return d.share; }); },
    unshare: function (id) { return temp.has(id) ? temp.unshare(id) : api(conv(id) + '/share', { method: 'DELETE' }); },
    addNote: function (cid, note) { return temp.has(cid) ? temp.addNote(cid, note) : api(conv(cid) + '/notes',
      { method: 'POST', body: note }).then(function (d) { return d.message; }); },
    feedback: function (cid, mid, fb) { return temp.has(cid) ? temp.feedback(cid, mid, fb) : api('/messages/'
      + encodeURIComponent(mid) + '/feedback', { method: 'POST', body: fb }); },
    upload: function (file, o) {
      o = o || {};
      try { classify(file, o); } catch (e) { return Promise.reject(e); }
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest(), fd = new FormData(); fd.append('file', file);
        if (o.fromRecorder) fd.append('recorder', '1');
        if (o.duration) fd.append('duration', String(o.duration));
        if (o.projectId) fd.append('project_id', String(o.projectId));   // v0.15.0: a project file
        x.open('POST', C.API + '/uploads'); x.withCredentials = true; x.setRequestHeader('X-Colon-Client', 'chat');
        if (o.signal) o.signal.addEventListener('abort', function () { x.abort(); });
        x.upload.onprogress = function (e) { if (e.lengthComputable && o.onProgress) o.onProgress(e.loaded / e.total);
          };
        x.onload = function () { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (
          x.status < 300) resolve(d.attachment); else reject(Object.assign(new Error(d.message || 'Upload failed.'),
          { code: d.error || 'processing' })); };
        x.onerror = function () { reject(Object.assign(new Error('Upload failed. Check your connection.'),
          { code: 'offline' })); };
        x.onabort = function () { reject(Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' })); };
        x.send(fd);
      });
    },
    fileBlob: function (id) { return fetch(C.API + '/uploads/' + encodeURIComponent(id) + '/file',
      { credentials: 'include' }).then(function (r) { return r.ok ? r.blob() : null; }, function () { return null; });
      },
    removeUpload: function (id) { return api('/uploads/' + encodeURIComponent(id), { method: 'DELETE' }); },
    clearFiles: function () { return api('/uploads', { method: 'DELETE' }); },
    getSettings: function () { return settings ? Promise.resolve(settings) : api('/chat/settings').then(function (d) {
      settings = Object.assign({}, DEFAULT_SETTINGS, d.settings); return settings; }); },
    saveSettings: function (p) { return api('/chat/settings', { method: 'PATCH', body: p }).then(function (d) {
      settings = Object.assign({}, DEFAULT_SETTINGS, d.settings); return settings; }); },
    stats: function () { return api('/chat/stats').catch(function () { return { where: 'Your Colon account' }; }); },
    cbt: function (o) { return api('/study/cbt', { method: 'POST', body: o }); },  // CBT practice test (v0.5.7)
    // v0.15.0 (Blueprint B): memory and projects, signed-in only (pages/memory.js, pages/projects.js).
    getMemory: function (q) { return api('/memory' + (q && q.projectId ? '?project_id=' + encodeURIComponent(
      q.projectId) : '')); },
    setMemoryConsent: function (on) { return api('/memory/consent', { method: 'PUT', body: { enabled: on } }); },
    addMemory: function (m) { return api('/memories', { method: 'POST', body: m }).then(function (d) {
      return d.memory; }); },
    editMemory: function (id, content) { return api('/memories/' + encodeURIComponent(id), { method: 'PATCH',
      body: { content: content } }).then(function (d) { return d.memory; }); },
    deleteMemory: function (id) { return api('/memories/' + encodeURIComponent(id), { method: 'DELETE' }); },
    clearMemory: function () { return api('/memories', { method: 'DELETE' }); },
    listProjects: function () { return api('/projects'); },
    getProject: function (id) { return api('/projects/' + encodeURIComponent(id)); },
    createProject: function (p) { return api('/projects', { method: 'POST', body: p }); },
    updateProject: function (id, p) { return api('/projects/' + encodeURIComponent(id), { method: 'PATCH', body: p })
      .then(function (d) { return d.project; }); },
    deleteProject: function (id) { return api('/projects/' + encodeURIComponent(id), { method: 'DELETE' }); },
    // v0.17.0 (D15): an image in this chat. message_id: the user message whose turn asked for it (the stream's
    // `image` event); without it the prompt becomes a new user message. -> { user_message, message, conversation }
    isTemp: function (cid) { return temp.has(cid); },   // a temporary chat (history off): no images or research
    // v0.17.1: attachmentIds = the images to edit (the user's own, in this chat).
    generateImage: function (cid, o) { return full(conv(cid) + '/images', { method: 'POST', body: { prompt: o.prompt,
      message_id: o.messageId || undefined, attachment_ids: o.attachmentIds && o.attachmentIds.length
        ? o.attachmentIds : undefined } }); },
    // v0.17.0 (D16): deep research. Without confirm the answer is 409 consent_required { credits }.
    startResearch: function (cid, o) { return full(conv(cid) + '/research', { method: 'POST', body: {
      question: o.question, confirm: o.confirm === true } }); },
    listResearch: function (cid) { return full(conv(cid) + '/research', {}).then(function (d) { return d.runs; }); },
    getResearch: function (id) { return full(run(id), {}).then(function (d) { return d.run; }); },
    cancelResearch: function (id) { return full(run(id) + '/cancel', { method: 'POST' }).then(function (d) {
      return d.run; }); }
  };
  return self;
}

export { RemoteChatData };
