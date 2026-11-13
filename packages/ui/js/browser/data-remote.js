/* ColonBrowserData · account adapter: the same interface through the Colon API (/browser/*). */

import { DEFAULT_SETTINGS, err } from './data-common.js';
import { LocalBrowserData } from './data-local.js';
import { sanitize } from './sanitize.js';
import { Colon } from '../colon.js';
import { ColonURL } from '../url.js';

var U = ColonURL;

// Phase 10: a conversation's own session (?conversation_id=); without a key, the device-wide one.
function chatQ(key) { return key ? '?conversation_id=' + encodeURIComponent(key) : ''; }

/* ---------- Remote implementation (endpoints documented above) ---------- */
function RemoteBrowserData() {
  var api = Colon.api, settingsCache = null;
  var local = LocalBrowserData(); // file blobs for downloads still live on the device
  return {
    kind: 'remote',
    describe: 'Synced with your Colon account.',
    getSession: function (key) { return api('/browser/session' + chatQ(key)).then(function (d) {
      return d.session; }); },
    saveSession: function (s, key) { return api('/browser/session' + chatQ(key), { method: 'PUT',
      body: { session: s } }).then(function (d) { return d.session; }); },
    removeSession: function (key) { return api('/browser/session' + chatQ(key), { method: 'DELETE' }); },
    getSettings: function () { return settingsCache ? Promise.resolve(settingsCache) : api('/browser/settings').then(
      function (d) { settingsCache = Object.assign({}, DEFAULT_SETTINGS, d.settings); return settingsCache; }); },
    saveSettings: function (p) { return api('/browser/settings', { method: 'PATCH', body: p }).then(function (d) {
      settingsCache = Object.assign({}, DEFAULT_SETTINGS, d.settings); return settingsCache; }); },
    listBookmarks: function () { return api('/browser/bookmarks'); },
    addBookmark: function (b) { return api('/browser/bookmarks', { method: 'POST', body: b }).then(function (d) {
      return d.bookmark; }); },
    updateBookmark: function (bid, p) { return api('/browser/bookmarks/' + encodeURIComponent(bid), { method: 'PATCH',
      body: p }).then(function (d) { return d.bookmark; }); },
    removeBookmark: function (bid) { return api('/browser/bookmarks/' + encodeURIComponent(bid), { method: 'DELETE' });
      },
    addFolder: function (name) { return api('/browser/folders', { method: 'POST', body: { name: name } }).then(
      function (d) { return d.folder; }); },
    renameFolder: function (fid, name) { return api('/browser/folders/' + encodeURIComponent(fid), { method: 'PATCH',
      body: { name: name } }); },
    removeFolder: function (fid) { return api('/browser/folders/' + encodeURIComponent(fid), { method: 'DELETE' }); },
    listHistory: function (o) { o = o || {}; return api('/browser/history?q=' + encodeURIComponent(o.q || '')
      + '&limit=' + (o.limit || 500)).then(function (d) { return d.history; }); },
    addHistory: function (h) { return /^colon:/.test(h.url) ? Promise.resolve(null) : api('/browser/history',
      { method: 'POST', body: h }); },
    removeHistory: function (hid) { return api('/browser/history/' + encodeURIComponent(hid), { method: 'DELETE' }); },
    clearHistory: function () { return api('/browser/history', { method: 'DELETE' }); },
    listDownloads: function () { return api('/browser/downloads').then(function (d) { return d.downloads; }); },
    addDownload: function (d) { return local.addDownload(d); },
    updateDownload: local.updateDownload, getDownloadFile: local.getDownloadFile,
    removeDownload: function (did) { return api('/browser/downloads/' + encodeURIComponent(did), { method: 'DELETE' });
      },
    listUploads: function () { return api('/browser/uploads').then(function (d) { return d.uploads; }); },
    upload: function (file, onProgress) {
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest(), fd = new FormData(); fd.append('file', file);
        x.open('POST', Colon.API + '/browser/uploads'); x.withCredentials = true; x.setRequestHeader('X-Colon-Client',
          'browser');
        x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        x.onload = function () { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (
          x.status < 300) resolve(d.upload); else reject(err(d.error || 'upload_failed', d.message
          || 'Upload failed.')); };
        x.onerror = function () { reject(err('offline', 'Upload failed. Check your connection.')); };
        x.send(fd);
      });
    },
    removeUpload: function (uid) { return api('/browser/uploads/' + encodeURIComponent(uid), { method: 'DELETE' }); },
    fetchPage: function (url, o) {
      var g = U.guard(url); if (!g.ok) return Promise.reject(err('blocked_' + g.reason, g.message));
      return api('/browser/fetch?url=' + encodeURIComponent(g.url)).then(function (d) {
        var clean = sanitize(d.html, d.final_url || g.url, {}); // defence in depth: sanitise again
        return { url: d.final_url || g.url, title: d.title || clean.title, html: clean.html, text: clean.text,
          links: clean.links, source: U.hostOf(g.url), mode: 'reader' };
      });
    },
    search: function (q, engine) { return api('/browser/search?q=' + encodeURIComponent(q) + '&engine='
      + encodeURIComponent(engine || 'google')).then(function (d) { return { query: q, results: d.results,
      provider: d.provider, engine: engine, external: U.searchUrl(q, engine) }; }); },
    plan: function (goal) { return api('/browser/plan', { method: 'POST', body: { goal: goal } }).then(function (d) {
      return d.steps; }).catch(function () { return null; }); },
    clearData: function (what) { return api('/browser/data/clear', { method: 'POST', body: what }); }
  };
}

export { RemoteBrowserData };
