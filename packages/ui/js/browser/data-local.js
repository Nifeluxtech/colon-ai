/* ColonBrowserData · local adapter: session, bookmarks, history and downloads on this device (ColonStore). */

import { DEFAULT_SETTINGS, MAX_PAGE, TIMEOUT, err, id, now, withTimeout } from './data-common.js';
import { sanitize } from './sanitize.js';
import { fetchWikipedia, searchWikipedia, wikiTitle } from './wikipedia.js';
import { ColonStore } from '../store.js';
import { ColonURL } from '../url.js';

var U = ColonURL;

/* ---------- Local implementation ---------- */
function LocalBrowserData() {
  var db = ColonStore.open('colon-browser', ['kv', 'bookmarks', 'folders', 'history', 'downloads', 'uploads']);
  var settingsCache = null;
  function kvGet(k, d) { return db.get('kv', k).then(function (r) { return r ? r.value : d; }); }
  function kvSet(k, v) { return db.put('kv', { id: k, value: v }).then(function () { return v; }); }
  var self = {
    kind: 'local',
    describe: 'Saved on this device. Web pages open in reader preview.',
    getSession: function () { return kvGet('session', null); },
    saveSession: function (s) { s.updated_at = now(); return kvSet('session', s); },

    getSettings: function () { return settingsCache ? Promise.resolve(settingsCache) : kvGet('settings',
      {}).then(function (s) { settingsCache = Object.assign({}, DEFAULT_SETTINGS, s, { permissions: Object.assign({},
      DEFAULT_SETTINGS.permissions, s && s.permissions) }); return settingsCache; }); },
    saveSettings: function (patch) { return self.getSettings().then(function (s) { settingsCache = Object.assign({}, s,
      patch); return kvSet('settings', settingsCache); }); },

    listBookmarks: function () { return Promise.all([db.all('bookmarks'), db.all('folders')]).then(function (r) {
      return { bookmarks: r[0].sort(byDate), folders: r[1].sort(function (a, b) { return a.name.localeCompare(b.name);
      }) }; }); },
    addBookmark: function (b) { return db.put('bookmarks', { id: id('b'), url: b.url, title: (b.title || b.url).slice(
      0, 200), folder_id: b.folder_id || null, created_at: now() }); },
    updateBookmark: function (bid, patch) { return db.get('bookmarks', bid).then(function (b) { if (!b) throw err(
      'not_found', 'Bookmark not found.'); return db.put('bookmarks', Object.assign(b, patch)); }); },
    removeBookmark: function (bid) { return db.del('bookmarks', bid); },
    addFolder: function (name) { return db.put('folders', { id: id('f'), name: String(name).slice(0, 60),
      created_at: now() }); },
    renameFolder: function (fid, name) { return db.get('folders', fid).then(function (f) { f.name = String(name).slice(
      0, 60); return db.put('folders', f); }); },
    removeFolder: function (fid) {
      return db.all('bookmarks').then(function (all) {
        return Promise.all(all.filter(function (b) { return b.folder_id === fid; }).map(function (b) { b.folder_id =
          null; return db.put('bookmarks', b); }));
      }).then(function () { return db.del('folders', fid); });
    },

    listHistory: function (o) {
      o = o || {};
      return db.all('history').then(function (all) {
        var q = (o.q || '').toLowerCase();
        return all.filter(function (h) { return !q || (h.title + ' ' + h.url).toLowerCase().indexOf(q) > -1; })
          .sort(function (a, b) { return a.visited_at < b.visited_at ? 1 : -1; }).slice(0, o.limit || 500);
      });
    },
    addHistory: function (h) {
      return self.getSettings().then(function (s) {
        if (!s.saveHistory || !h.url || /^colon:/.test(h.url)) return null;
        return db.put('history', { id: id('h'), url: h.url, title: (h.title || h.url).slice(0, 200), visited_at: now(
          ) }).then(function (rec) {
          return db.all('history').then(function (all) { // keep the newest 2000
            if (all.length <= 2000) return rec;
            all.sort(function (a, b) { return a.visited_at < b.visited_at ? 1 : -1; });
            return Promise.all(all.slice(2000).map(function (x) { return db.del('history', x.id); })).then(function (
              ) { return rec; });
          });
        });
      });
    },
    removeHistory: function (hid) { return db.del('history', hid); },
    clearHistory: function () { return db.clear('history'); },

    listDownloads: function () { return db.all('downloads').then(function (a) { return a.sort(byDate).map(function (
      d) { var o = Object.assign({}, d); delete o.blob; o.has_file = !!d.blob; return o; }); }); },
    addDownload: function (d) { var rec = Object.assign({ id: id('d'), created_at: now(), status: 'complete' }, d);
      return db.put('downloads', rec).then(function () { var o = Object.assign({}, rec); delete o.blob; return o; }); },
    updateDownload: function (did, patch) { return db.get('downloads', did).then(function (d) { return db.put(
      'downloads', Object.assign(d, patch)); }); },
    getDownloadFile: function (did) { return db.get('downloads', did).then(function (d) { return d && d.blob
      ? d.blob : null; }); },
    removeDownload: function (did) { return db.del('downloads', did); },

    listUploads: function () { return db.all('uploads').then(function (a) { return a.sort(byDate).map(function (d) {
      var o = Object.assign({}, d); delete o.blob; return o; }); }); },
    // Reads the file locally (real progress events) and keeps it on this device.
    upload: function (file, onProgress) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        r.onerror = function () { reject(err('read_failed', 'The file couldn’t be read.')); };
        r.onload = function () {
          var rec = { id: id('u'), name: file.name, type: file.type || 'application/octet-stream', size: file.size,
            status: 'uploaded', created_at: now(), blob: new Blob([r.result], { type: file.type }) };
          db.put('uploads', rec).then(function () { var o = Object.assign({}, rec); delete o.blob; resolve(o);
            }, reject);
        };
        r.readAsArrayBuffer(file);
      });
    },
    removeUpload: function (uid) { return db.del('uploads', uid); },

    fetchPage: function (url, o) {
      o = o || {};
      var g = U.guard(url); if (!g.ok) return Promise.reject(err('blocked_' + g.reason, g.message));
      var t = withTimeout(o.signal, TIMEOUT);
      return self.getSettings().then(function (s) {
        var w = wikiTitle(g.url);
        var job = w ? fetchWikipedia(w, t.signal) : fetch(g.url, { signal: t.signal, mode: 'cors', credentials: 'omit',
          referrerPolicy: 'no-referrer' }).then(function (r) {
          var len = Number(r.headers.get('content-length') || 0);
          if (len > MAX_PAGE) throw err('too_large', 'This page is larger than reader mode allows (2 MB).');
          var ct = r.headers.get('content-type') || '';
          if (!/html|text\/plain/.test(ct)) throw Object.assign(err('not_html', 'This address is a file, not a page.'),
            { contentType: ct, finalUrl: r.url });
          return r.text().then(function (h) { return { url: r.url || g.url, html: /text\/plain/.test(ct) ? '<pre>'
            + h.replace(/[&<]/g, function (c) { return c === '&' ? '&amp;' : '&lt;'; }) + '</pre>' : h, title: '',
            source: U.hostOf(g.url) }; });
        }).catch(function (e) {
          if (e.name === 'AbortError' || e.code) throw e;
          throw err('needs_proxy',
            'This site doesn’t allow other websites to read it, so the web reader can’t open it yet.');
        });
        return job.then(function (page) {
          var clean = sanitize(page.html, page.url, { loadImages: s.loadImages });
          return { url: page.url, title: page.title || clean.title || U.hostOf(page.url), html: clean.html,
            text: clean.text, links: clean.links, source: page.source, mode: 'reader' };
        });
      }).then(function (r) { t.done(); return r; }, function (e) { t.done();
        if (e.name === 'AbortError') throw o.signal && o.signal.aborted ? e : err('timeout',
        'The page took too long to respond.'); throw e; });
    },
    search: function (q, engine, o) {
      o = o || {};
      var t = withTimeout(o.signal, TIMEOUT);
      return searchWikipedia(q, 'en', t.signal).then(function (results) {
        t.done(); return { query: q, results: results, provider: 'Wikipedia', engine: engine, external: U.searchUrl(q,
          engine) };
      }, function (e) { t.done(); if (e.name === 'AbortError' && !(o.signal && o.signal.aborted)) throw err('timeout',
        'Search took too long.'); throw e; });
    },
    plan: function () { return Promise.resolve(null); }, // local: ColonSagaBrowse uses its built-in planner
    clearData: function (what) {
      var jobs = [];
      if (what.history) jobs.push(db.clear('history'));
      if (what.downloads) jobs.push(db.clear('downloads'), db.clear('uploads'));
      if (what.bookmarks) jobs.push(db.clear('bookmarks'), db.clear('folders'));
      if (what.session) jobs.push(db.del('kv', 'session'));
      if (what.settings) { settingsCache = null; jobs.push(db.del('kv', 'settings')); }
      return Promise.all(jobs);
    }
  };
  return self;
}
function byDate(a, b) { return (a.created_at || '') < (b.created_at || '') ? 1 : -1; }

export { LocalBrowserData };
