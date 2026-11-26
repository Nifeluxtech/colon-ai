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
  function repo(id) { return '/projects/' + encodeURIComponent(id) + '/repo'; }   // v0.24.0
  function wsp(id) { return '/workspaces/' + encodeURIComponent(id); }   // v0.25.0
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
        function (a) { return a.id; }), browser: o.browser || undefined, voice: o.voice || undefined,
        fun: o.fun === false ? false : undefined }, o,
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
    // v0.25.0 (Workspace step 1, docs/workspace/plan.md): website workspaces (pages/workspace.js).
    listWorkspaces: function () { return api('/workspaces'); },
    createWorkspace: function (b) { return api('/workspaces', { method: 'POST', body: b }); },
    getWorkspace: function (id) { return api(wsp(id)); },
    updateWorkspace: function (id, b) { return api(wsp(id), { method: 'PATCH', body: b }); },
    deleteWorkspace: function (id) { return api(wsp(id), { method: 'DELETE' }); },
    workspaceFile: function (id, path) { return api(wsp(id) + '/file?path=' + encodeURIComponent(path)); },
    workspaceVersions: function (id) { return api(wsp(id) + '/versions'); },
    restoreWorkspace: function (id, n) { return api(wsp(id) + '/versions/' + n + '/restore', { method: 'POST' }); },
    workspaceChat: function (id) { return api(wsp(id) + '/chat'); },   // v0.26.0 (step 2)
    // v0.27.3: clone a repository into the workspace, or learn from one (and stop)
    workspaceRepo: function (id, action, url) { return api(wsp(id) + '/repo', { method: 'POST',
      body: { action: action, url: url } }); },
    forgetWorkspaceReference: function (id) { return api(wsp(id) + '/reference', { method: 'DELETE' }); },
    // v0.28.0 (step 4): publish to apparatus.name.ng/<name>/
    checkWorkspacePublish: function (id, name) { return api(wsp(id) + '/publish/check?name='
      + encodeURIComponent(name)); },
    publishWorkspace: function (id, name) { return api(wsp(id) + '/publish', { method: 'POST',
      body: { name: name } }); },
    unpublishWorkspace: function (id) { return api(wsp(id) + '/publish', { method: 'DELETE' }); },
    // v0.30.0: the publishing name (apparatus.name.ng/<username>/<site>/) and connected services
    workspaceOwner: function () { return api('/workspace-owner'); },
    checkWorkspaceOwner: function (name) { return api('/workspace-owner/check?name=' + encodeURIComponent(name)); },
    setWorkspaceOwner: function (name) { return api('/workspace-owner', { method: 'PUT', body: { name: name } }); },
    putWorkspaceConnection: function (id, p, b) { return api(wsp(id) + '/connections/' + encodeURIComponent(p),
      { method: 'PUT', body: b }); },
    deleteWorkspaceConnection: function (id, p) { return api(wsp(id) + '/connections/' + encodeURIComponent(p),
      { method: 'DELETE' }); },
    // v0.29.0 (step 5): the site's database and secret keys (a key's value goes up, never comes back)
    workspaceData: function (id) { return api(wsp(id) + '/data'); },
    putWorkspaceSecret: function (id, name, b) { return api(wsp(id) + '/secrets/' + encodeURIComponent(name),
      { method: 'PUT', body: b }); },
    deleteWorkspaceSecret: function (id, name) { return api(wsp(id) + '/secrets/' + encodeURIComponent(name),
      { method: 'DELETE' }); },
    putWorkspaceTable: function (id, name, b) { return api(wsp(id) + '/tables/' + encodeURIComponent(name),
      { method: 'PUT', body: b }); },
    deleteWorkspaceTable: function (id, name) { return api(wsp(id) + '/tables/' + encodeURIComponent(name),
      { method: 'DELETE' }); },
    workspaceRecords: function (id, name, before) { return api(wsp(id) + '/tables/' + encodeURIComponent(name)
      + '/records' + (before ? '?before=' + encodeURIComponent(before) : '')); },
    deleteWorkspaceRecord: function (id, name, rid) { return api(wsp(id) + '/tables/' + encodeURIComponent(name)
      + '/records/' + encodeURIComponent(rid), { method: 'DELETE' }); },
    // v0.31.4: hold keeps the request open while the build runs, so the host doesn't stop that API process
    sendWorkspaceChat: function (id, message, images) { return api(wsp(id) + '/chat', { method: 'POST',
      body: { message: message, hold: true, images: images && images.length ? images : undefined } }); },
    // v0.27.0 (step 3): Preview (whole site), Code, Files and Terminal edits. Each write is a new version.
    workspaceBundle: function (id) { return api(wsp(id) + '/bundle'); },
    // v0.31.0: every file and folder as a .zip -> { blob, name, files } (owner only; the session cookie goes along)
    workspaceZip: function (id) {
      return fetch(C.API + wsp(id) + '/export', { credentials: 'include' }).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) {
          throw Object.assign(new Error(d.message || 'The ZIP couldn’t be made.'), { status: r.status }); });
        var cd = r.headers.get('content-disposition') || '', m = /filename="([^"]+)"/.exec(cd);
        return r.blob().then(function (b) { return { blob: b, name: m ? m[1] : 'site.zip',
          files: Number(r.headers.get('x-colon-files')) || null }; });
      }, function () { throw Object.assign(new Error('Can’t reach Colon right now. Check your connection.'),
        { code: 'offline' }); });
    },
    putWorkspaceFile: function (id, b) { return api(wsp(id) + '/file', { method: 'PUT', body: b }); },
    moveWorkspaceFile: function (id, from, to) { return api(wsp(id) + '/file/move', { method: 'POST',
      body: { from: from, to: to } }); },
    // v0.31.0: folders (move or delete everything in one, as one version), Git and server databases
    moveWorkspaceFolder: function (id, from, to) { return api(wsp(id) + '/folder/move', { method: 'POST',
      body: { from: from, to: to } }); },
    deleteWorkspaceFolder: function (id, path) { return api(wsp(id) + '/folder?path=' + encodeURIComponent(path),
      { method: 'DELETE' }); },
    workspaceGit: function (id, p, action, b) { return api(wsp(id) + '/git/' + encodeURIComponent(p) + '/' + action,
      { method: 'POST', body: b || {} }); },
    workspaceGitPulls: function (id, p) { return api(wsp(id) + '/git/' + encodeURIComponent(p) + '/pulls'); },
    workspaceRemoteTables: function (id, p) { return api(wsp(id) + '/remote/' + encodeURIComponent(p) + '/tables'); },
    workspaceRemoteRows: function (id, p, t) { return api(wsp(id) + '/remote/' + encodeURIComponent(p) + '/rows?table='
      + encodeURIComponent(t)); },
    deleteWorkspaceFile: function (id, path) { return api(wsp(id) + '/file?path=' + encodeURIComponent(path),
      { method: 'DELETE' }); },
    // v0.24.0: a project's connected repository (components/project-context.js). A token goes up, never comes back.
    connectRepo: function (id, b) { return api(repo(id), { method: 'POST', body: b }); },
    syncRepo: function (id) { return api(repo(id) + '/sync', { method: 'POST' }); },
    disconnectRepo: function (id) { return api(repo(id), { method: 'DELETE' }); },
    repoBranches: function (id, b) { return api(repo(id) + '/branches', { method: 'POST', body: b }); },
    repoList: function (id, b) { return api(repo(id) + '/repos', { method: 'POST', body: b }); },
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
