/* ColonBrowserData: the ONE data adapter for browser state, shared by Colon Browser and the
   browser panel inside Colon AI (same session infrastructure, ROADMAP Phase 8/10).

   Two implementations with the same interface:
   - LocalBrowserData (default today): IndexedDB on this device + a web "reader preview" that loads
     pages from sources that allow cross-origin reads (Wikipedia). Each subdomain keeps its own copy.
   - RemoteBrowserData: the endpoints below on api.apparatus.name.ng. Switch with
     localStorage['colon.data'] = 'remote' (or window.COLON_DATA = 'remote') once the API serves them;
     the session is then shared by every app and device of the signed-in user.

   Expected API endpoints (not served by the API yet; all JSON, cookie session + X-Colon-Client):
     GET    /browser/session                    -> { session: { tabs:[{id,url,title,back:[],fwd:[]}], active_id, control } }
     PUT    /browser/session   { session }      -> { session }
     GET    /browser/bookmarks                  -> { bookmarks:[{id,url,title,folder_id,created_at}], folders:[{id,name}] }
     POST   /browser/bookmarks { url,title,folder_id } -> { bookmark }
     PATCH  /browser/bookmarks/:id { title?, folder_id? }   DELETE /browser/bookmarks/:id
     POST   /browser/folders { name } -> { folder }   PATCH /browser/folders/:id { name }   DELETE /browser/folders/:id
     GET    /browser/history?q=&limit=          -> { history:[{id,url,title,visited_at}] }
     POST   /browser/history { url,title }      DELETE /browser/history/:id   DELETE /browser/history (clear)
     GET    /browser/downloads                  -> { downloads:[{id,name,type,size,url,status,created_at}] }
     POST   /browser/downloads { url,name }     DELETE /browser/downloads/:id   GET /browser/downloads/:id/file
     POST   /browser/uploads (multipart file)   -> { upload:{id,name,type,size,status} }   GET/DELETE /browser/uploads[/:id]
     GET    /browser/settings  PATCH /browser/settings { ... }
     GET    /browser/fetch?url=                 -> { url, final_url, title, html (server-sanitised), text, status }
            Server must: allow http/https only, resolve DNS and refuse private/loopback/link-local/metadata
            IPs (re-check after every redirect, max 5), cap 2 MB and 10 s, strip scripts/styles/iframes/forms.
     GET    /browser/search?q=&engine=          -> { results:[{title,url,snippet}], provider }
     POST   /browser/plan { goal }              -> { steps:[{kind,label,query?,url?}] }   (Colon Saga planner)
     POST   /browser/data/clear { history,downloads,bookmarks,session } */
(function (root) {
  'use strict';
  var U = root.ColonURL;

  var DEFAULT_SETTINGS = {
    homepage: 'colon://newtab', engine: 'google', theme: 'system-app', restoreSession: true,
    loadImages: true, blockTrackers: true, doNotTrack: true, saveHistory: true,
    permissions: { microphone: 'ask', location: 'block', notifications: 'block', camera: 'ask' },
    askWhereToSave: false, downloadOpenAfter: false, aiApproval: 'sensitive', readerFont: 'md'
  };
  var MAX_PAGE = 2 * 1024 * 1024, TIMEOUT = 12000;

  function now() { return new Date().toISOString(); }
  function id(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function withTimeout(signal, ms) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms);
    if (signal) { if (signal.aborted) c.abort(); else signal.addEventListener('abort', function () { c.abort(); }); }
    return { signal: c.signal, done: function () { clearTimeout(t); } };
  }
  function err(code, message) { return Object.assign(new Error(message), { code: code }); }

  /* ---------- Sanitiser: untrusted HTML -> safe reader HTML ---------- */
  var ALLOWED = { P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, A: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, CODE: 1, EM: 1, STRONG: 1, B: 1, I: 1, U: 1, S: 1, SMALL: 1,
    SUB: 1, SUP: 1, BR: 1, HR: 1, TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1, FIGURE: 1, FIGCAPTION: 1, IMG: 1, SPAN: 1, DIV: 1, SECTION: 1,
    ARTICLE: 1, HEADER: 1, FOOTER: 1, MAIN: 1, DL: 1, DT: 1, DD: 1, ABBR: 1, CITE: 1, Q: 1, MARK: 1, TIME: 1, DETAILS: 1, SUMMARY: 1, KBD: 1, VAR: 1, SAMP: 1 };
  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, NOSCRIPT: 1, LINK: 1, META: 1, TEMPLATE: 1,
    SVG: 1, MATH: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, SOURCE: 1, TRACK: 1, NAV: 1, ASIDE: 1, DIALOG: 1, FRAME: 1, FRAMESET: 1, APPLET: 1, BASE: 1, PORTAL: 1 };
  var JUNK = '.mw-editsection,.navbox,.vertical-navbox,.metadata,.ambox,.hatnote,.noprint,.mw-empty-elt,.reflist .mw-cite-backlink,.sistersitebox,.mw-jump-link,[role=navigation],[aria-hidden=true],.cookie,.advert,.ads,.ad';

  function sanitize(html, base, opts) {
    opts = opts || {};
    var doc = new DOMParser().parseFromString(String(html).slice(0, MAX_PAGE), 'text/html');
    var title = (doc.querySelector('title') || {}).textContent || '';
    var src = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role=main]') || doc.body;
    if (!src) return { html: '', text: '', title: title, links: [] };
    try { src.querySelectorAll(JUNK).forEach(function (n) { n.remove(); }); } catch (e) {}
    var out = document.createElement('div'), links = [];
    function walk(node, parent, depth) {
      if (depth > 40) return;
      node.childNodes.forEach(function (n) {
        if (n.nodeType === 3) { parent.appendChild(document.createTextNode(n.nodeValue)); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName.toUpperCase();
        if (DROP[tag]) return;
        if (!ALLOWED[tag]) { walk(n, parent, depth + 1); return; }  // unwrap unknown tags, keep text
        var el = document.createElement(tag);
        if (tag === 'A') {
          var href = U.resolve(n.getAttribute('href') || '', base);
          if (href && /^https?:/i.test(href)) {
            el.setAttribute('href', href); el.setAttribute('data-nav', href); el.setAttribute('rel', 'noopener noreferrer nofollow');
            if (links.length < 400) links.push({ url: href, text: (n.textContent || '').trim().slice(0, 140) });
          } else if (/^#/.test(n.getAttribute('href') || '')) el.setAttribute('href', n.getAttribute('href'));
        } else if (tag === 'IMG') {
          var s = U.resolve(n.getAttribute('src') || n.getAttribute('data-src') || '', base);
          if (!s || !/^https:/i.test(s)) return;
          if (opts.loadImages === false) { var ph = document.createElement('span'); ph.className = 'cb-img-off'; ph.textContent = '[image: ' + (n.getAttribute('alt') || 'hidden') + ']'; parent.appendChild(ph); return; }
          el.setAttribute('src', s); el.setAttribute('alt', n.getAttribute('alt') || ''); el.setAttribute('loading', 'lazy'); el.setAttribute('referrerpolicy', 'no-referrer'); el.setAttribute('decoding', 'async');
          ['width', 'height'].forEach(function (a) { var v = parseInt(n.getAttribute(a), 10); if (v > 0 && v < 4000) el.setAttribute(a, v); });
        } else if (tag === 'TH' || tag === 'TD') {
          ['colspan', 'rowspan'].forEach(function (a) { var v = parseInt(n.getAttribute(a), 10); if (v > 1 && v < 50) el.setAttribute(a, v); });
        }
        var t = n.getAttribute('title'); if (t && tag !== 'IMG') el.setAttribute('title', t.slice(0, 200));
        if (n.id && /^[\w-]{1,60}$/.test(n.id)) el.id = 'cb-' + n.id;
        parent.appendChild(el); walk(n, el, depth + 1);
      });
    }
    walk(src, out, 0);
    // drop empty wrappers
    out.querySelectorAll('div,span,section,p').forEach(function (n) { if (!n.textContent.trim() && !n.querySelector('img,hr,br,table')) n.remove(); });
    var text = (out.textContent || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    return { html: out.innerHTML, text: text, title: title.trim(), links: links };
  }

  /* ---------- Reader sources the browser itself may read (CORS-enabled) ---------- */
  function wikiTitle(u) {
    var m = /^https?:\/\/([a-z-]{2,12})\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i.exec(u);
    return m ? { lang: m[1], title: decodeURIComponent(m[2]) } : null;
  }
  function wikiLang(u) { var m = /^https?:\/\/([a-z-]{2,12})\.(?:m\.)?wikipedia\.org/i.exec(u || ''); return m ? m[1] : 'en'; }

  function fetchWikipedia(w, signal) {
    var api = 'https://' + w.lang + '.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&origin=*&redirects=1&disableeditsection=1&prop=text%7Cdisplaytitle&page=' + encodeURIComponent(w.title);
    return fetch(api, { signal: signal }).then(function (r) {
      if (r.status === 429) throw err('rate_limited', 'Wikipedia asked us to slow down. Try again in a moment.');
      if (!r.ok) throw err('http_' + r.status, 'The page could not be loaded (' + r.status + ').');
      return r.json();
    }).then(function (d) {
      if (d.error) throw err('not_found', d.error.code === 'missingtitle' ? 'That article doesn’t exist.' : (d.error.info || 'Page not available.'));
      var url = 'https://' + w.lang + '.wikipedia.org/wiki/' + encodeURIComponent(d.parse.title.replace(/ /g, '_'));
      var tmp = document.createElement('div'); tmp.innerHTML = d.parse.displaytitle || d.parse.title;
      return { url: url, html: d.parse.text, title: tmp.textContent || d.parse.title, source: 'Wikipedia' };
    });
  }

  function searchWikipedia(q, lang, signal) {
    var api = 'https://' + (lang || 'en') + '.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=10&srprop=snippet&srsearch=' + encodeURIComponent(q);
    return fetch(api, { signal: signal }).then(function (r) {
      if (r.status === 429) throw err('rate_limited', 'Search is busy right now. Try again in a moment.');
      if (!r.ok) throw err('http_' + r.status, 'Search failed (' + r.status + ').');
      return r.json();
    }).then(function (d) {
      return ((d.query && d.query.search) || []).map(function (x) {
        var tmp = document.createElement('div'); tmp.innerHTML = x.snippet || '';
        return { title: x.title, url: 'https://' + (lang || 'en') + '.wikipedia.org/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_')), snippet: tmp.textContent };
      });
    });
  }

  /* ---------- Local implementation ---------- */
  function LocalBrowserData() {
    var db = root.ColonStore.open('colon-browser', ['kv', 'bookmarks', 'folders', 'history', 'downloads', 'uploads']);
    var settingsCache = null;
    function kvGet(k, d) { return db.get('kv', k).then(function (r) { return r ? r.value : d; }); }
    function kvSet(k, v) { return db.put('kv', { id: k, value: v }).then(function () { return v; }); }
    var self = {
      kind: 'local',
      describe: 'Saved on this device. Web pages open in reader preview.',
      getSession: function () { return kvGet('session', null); },
      saveSession: function (s) { s.updated_at = now(); return kvSet('session', s); },

      getSettings: function () { return settingsCache ? Promise.resolve(settingsCache) : kvGet('settings', {}).then(function (s) { settingsCache = Object.assign({}, DEFAULT_SETTINGS, s, { permissions: Object.assign({}, DEFAULT_SETTINGS.permissions, s && s.permissions) }); return settingsCache; }); },
      saveSettings: function (patch) { return self.getSettings().then(function (s) { settingsCache = Object.assign({}, s, patch); return kvSet('settings', settingsCache); }); },

      listBookmarks: function () { return Promise.all([db.all('bookmarks'), db.all('folders')]).then(function (r) { return { bookmarks: r[0].sort(byDate), folders: r[1].sort(function (a, b) { return a.name.localeCompare(b.name); }) }; }); },
      addBookmark: function (b) { return db.put('bookmarks', { id: id('b'), url: b.url, title: (b.title || b.url).slice(0, 200), folder_id: b.folder_id || null, created_at: now() }); },
      updateBookmark: function (bid, patch) { return db.get('bookmarks', bid).then(function (b) { if (!b) throw err('not_found', 'Bookmark not found.'); return db.put('bookmarks', Object.assign(b, patch)); }); },
      removeBookmark: function (bid) { return db.del('bookmarks', bid); },
      addFolder: function (name) { return db.put('folders', { id: id('f'), name: String(name).slice(0, 60), created_at: now() }); },
      renameFolder: function (fid, name) { return db.get('folders', fid).then(function (f) { f.name = String(name).slice(0, 60); return db.put('folders', f); }); },
      removeFolder: function (fid) {
        return db.all('bookmarks').then(function (all) {
          return Promise.all(all.filter(function (b) { return b.folder_id === fid; }).map(function (b) { b.folder_id = null; return db.put('bookmarks', b); }));
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
          return db.put('history', { id: id('h'), url: h.url, title: (h.title || h.url).slice(0, 200), visited_at: now() }).then(function (rec) {
            return db.all('history').then(function (all) { // keep the newest 2000
              if (all.length <= 2000) return rec;
              all.sort(function (a, b) { return a.visited_at < b.visited_at ? 1 : -1; });
              return Promise.all(all.slice(2000).map(function (x) { return db.del('history', x.id); })).then(function () { return rec; });
            });
          });
        });
      },
      removeHistory: function (hid) { return db.del('history', hid); },
      clearHistory: function () { return db.clear('history'); },

      listDownloads: function () { return db.all('downloads').then(function (a) { return a.sort(byDate).map(function (d) { var o = Object.assign({}, d); delete o.blob; o.has_file = !!d.blob; return o; }); }); },
      addDownload: function (d) { var rec = Object.assign({ id: id('d'), created_at: now(), status: 'complete' }, d); return db.put('downloads', rec).then(function () { var o = Object.assign({}, rec); delete o.blob; return o; }); },
      updateDownload: function (did, patch) { return db.get('downloads', did).then(function (d) { return db.put('downloads', Object.assign(d, patch)); }); },
      getDownloadFile: function (did) { return db.get('downloads', did).then(function (d) { return d && d.blob ? d.blob : null; }); },
      removeDownload: function (did) { return db.del('downloads', did); },

      listUploads: function () { return db.all('uploads').then(function (a) { return a.sort(byDate).map(function (d) { var o = Object.assign({}, d); delete o.blob; return o; }); }); },
      // Reads the file locally (real progress events) and keeps it on this device.
      upload: function (file, onProgress) {
        return new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
          r.onerror = function () { reject(err('read_failed', 'The file couldn’t be read.')); };
          r.onload = function () {
            var rec = { id: id('u'), name: file.name, type: file.type || 'application/octet-stream', size: file.size, status: 'uploaded', created_at: now(), blob: new Blob([r.result], { type: file.type }) };
            db.put('uploads', rec).then(function () { var o = Object.assign({}, rec); delete o.blob; resolve(o); }, reject);
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
          var job = w ? fetchWikipedia(w, t.signal) : fetch(g.url, { signal: t.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) {
            var len = Number(r.headers.get('content-length') || 0);
            if (len > MAX_PAGE) throw err('too_large', 'This page is larger than reader mode allows (2 MB).');
            var ct = r.headers.get('content-type') || '';
            if (!/html|text\/plain/.test(ct)) throw Object.assign(err('not_html', 'This address is a file, not a page.'), { contentType: ct, finalUrl: r.url });
            return r.text().then(function (h) { return { url: r.url || g.url, html: /text\/plain/.test(ct) ? '<pre>' + h.replace(/[&<]/g, function (c) { return c === '&' ? '&amp;' : '&lt;'; }) + '</pre>' : h, title: '', source: U.hostOf(g.url) }; });
          }).catch(function (e) {
            if (e.name === 'AbortError' || e.code) throw e;
            throw err('needs_proxy', 'This site doesn’t allow other websites to read it, so the web reader can’t open it yet.');
          });
          return job.then(function (page) {
            var clean = sanitize(page.html, page.url, { loadImages: s.loadImages });
            return { url: page.url, title: page.title || clean.title || U.hostOf(page.url), html: clean.html, text: clean.text, links: clean.links, source: page.source, mode: 'reader' };
          });
        }).then(function (r) { t.done(); return r; }, function (e) { t.done(); if (e.name === 'AbortError') throw o.signal && o.signal.aborted ? e : err('timeout', 'The page took too long to respond.'); throw e; });
      },
      search: function (q, engine, o) {
        o = o || {};
        var t = withTimeout(o.signal, TIMEOUT);
        return searchWikipedia(q, 'en', t.signal).then(function (results) {
          t.done(); return { query: q, results: results, provider: 'Wikipedia', engine: engine, external: U.searchUrl(q, engine) };
        }, function (e) { t.done(); if (e.name === 'AbortError' && !(o.signal && o.signal.aborted)) throw err('timeout', 'Search took too long.'); throw e; });
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

  /* ---------- Remote implementation (endpoints documented above) ---------- */
  function RemoteBrowserData() {
    var api = root.Colon.api, settingsCache = null;
    var local = LocalBrowserData(); // file blobs for downloads still live on the device
    return {
      kind: 'remote',
      describe: 'Synced with your Colon account.',
      getSession: function () { return api('/browser/session').then(function (d) { return d.session; }); },
      saveSession: function (s) { return api('/browser/session', { method: 'PUT', body: { session: s } }).then(function (d) { return d.session; }); },
      getSettings: function () { return settingsCache ? Promise.resolve(settingsCache) : api('/browser/settings').then(function (d) { settingsCache = Object.assign({}, DEFAULT_SETTINGS, d.settings); return settingsCache; }); },
      saveSettings: function (p) { return api('/browser/settings', { method: 'PATCH', body: p }).then(function (d) { settingsCache = Object.assign({}, DEFAULT_SETTINGS, d.settings); return settingsCache; }); },
      listBookmarks: function () { return api('/browser/bookmarks'); },
      addBookmark: function (b) { return api('/browser/bookmarks', { method: 'POST', body: b }).then(function (d) { return d.bookmark; }); },
      updateBookmark: function (bid, p) { return api('/browser/bookmarks/' + encodeURIComponent(bid), { method: 'PATCH', body: p }).then(function (d) { return d.bookmark; }); },
      removeBookmark: function (bid) { return api('/browser/bookmarks/' + encodeURIComponent(bid), { method: 'DELETE' }); },
      addFolder: function (name) { return api('/browser/folders', { method: 'POST', body: { name: name } }).then(function (d) { return d.folder; }); },
      renameFolder: function (fid, name) { return api('/browser/folders/' + encodeURIComponent(fid), { method: 'PATCH', body: { name: name } }); },
      removeFolder: function (fid) { return api('/browser/folders/' + encodeURIComponent(fid), { method: 'DELETE' }); },
      listHistory: function (o) { o = o || {}; return api('/browser/history?q=' + encodeURIComponent(o.q || '') + '&limit=' + (o.limit || 500)).then(function (d) { return d.history; }); },
      addHistory: function (h) { return /^colon:/.test(h.url) ? Promise.resolve(null) : api('/browser/history', { method: 'POST', body: h }); },
      removeHistory: function (hid) { return api('/browser/history/' + encodeURIComponent(hid), { method: 'DELETE' }); },
      clearHistory: function () { return api('/browser/history', { method: 'DELETE' }); },
      listDownloads: function () { return api('/browser/downloads').then(function (d) { return d.downloads; }); },
      addDownload: function (d) { return local.addDownload(d); },
      updateDownload: local.updateDownload, getDownloadFile: local.getDownloadFile,
      removeDownload: function (did) { return api('/browser/downloads/' + encodeURIComponent(did), { method: 'DELETE' }); },
      listUploads: function () { return api('/browser/uploads').then(function (d) { return d.uploads; }); },
      upload: function (file, onProgress) {
        return new Promise(function (resolve, reject) {
          var x = new XMLHttpRequest(), fd = new FormData(); fd.append('file', file);
          x.open('POST', root.Colon.API + '/browser/uploads'); x.withCredentials = true; x.setRequestHeader('X-Colon-Client', 'browser');
          x.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
          x.onload = function () { var d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} if (x.status < 300) resolve(d.upload); else reject(err(d.error || 'upload_failed', d.message || 'Upload failed.')); };
          x.onerror = function () { reject(err('offline', 'Upload failed. Check your connection.')); };
          x.send(fd);
        });
      },
      removeUpload: function (uid) { return api('/browser/uploads/' + encodeURIComponent(uid), { method: 'DELETE' }); },
      fetchPage: function (url, o) {
        var g = U.guard(url); if (!g.ok) return Promise.reject(err('blocked_' + g.reason, g.message));
        return api('/browser/fetch?url=' + encodeURIComponent(g.url)).then(function (d) {
          var clean = sanitize(d.html, d.final_url || g.url, {}); // defence in depth: sanitise again
          return { url: d.final_url || g.url, title: d.title || clean.title, html: clean.html, text: clean.text, links: clean.links, source: U.hostOf(g.url), mode: 'reader' };
        });
      },
      search: function (q, engine) { return api('/browser/search?q=' + encodeURIComponent(q) + '&engine=' + encodeURIComponent(engine || 'google')).then(function (d) { return { query: q, results: d.results, provider: d.provider, engine: engine, external: U.searchUrl(q, engine) }; }); },
      plan: function (goal) { return api('/browser/plan', { method: 'POST', body: { goal: goal } }).then(function (d) { return d.steps; }).catch(function () { return null; }); },
      clearData: function (what) { return api('/browser/data/clear', { method: 'POST', body: what }); }
    };
  }

  function mode() { try { return root.COLON_DATA || root.localStorage.getItem('colon.data') || 'local'; } catch (e) { return 'local'; } }
  var instance = null;
  function get() { if (!instance) instance = mode() === 'remote' ? RemoteBrowserData() : LocalBrowserData(); return instance; }

  root.ColonBrowserData = { get: get, sanitize: sanitize, DEFAULT_SETTINGS: DEFAULT_SETTINGS, wikiLang: wikiLang };
})(window);
