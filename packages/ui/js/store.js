/* ColonStore: tiny promise wrapper over IndexedDB (records keyed by `id`), used by the
   local data adapters while the matching API endpoints don't exist yet.
   Falls back to localStorage (JSON only, Blobs dropped) and then to memory, so private
   windows and old WebViews still work.
   Usage: const db = ColonStore.open('colon-chat', ['conversations', 'files']);
          await db.put('conversations', { id: 'c1', ... }); await db.all('conversations'); */
// The page's global object in the browser; globalThis under Node (unit tests).
const root = typeof window !== 'undefined' ? window : globalThis;

function idbOpen(name, stores, version) {
  return new Promise(function (resolve, reject) {
    if (!root.indexedDB) return reject(new Error('no indexeddb'));
    var req;
    try { req = root.indexedDB.open(name, version); } catch (e) { return reject(e); }
    req.onupgradeneeded = function () {
      var db = req.result;
      stores.forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('indexeddb open failed')); };
    req.onblocked = function () { reject(new Error('indexeddb blocked')); };
  });
}

function tx(db, store, mode, fn) {
  return new Promise(function (resolve, reject) {
    var t = db.transaction(store, mode), os = t.objectStore(store), out;
    var r = fn(os);
    if (r) r.onsuccess = function () { out = r.result; };
    t.oncomplete = function () { resolve(out); };
    t.onerror = t.onabort = function () { reject(t.error || new Error('transaction failed')); };
  });
}

function lsBackend(name) {
  var mem = {};
  function k(store) { return name + ':' + store; }
  function read(store) {
    try { var v = root.localStorage.getItem(k(store)); return v ? JSON.parse(v) : {}; } catch (e) { return mem[store] || {}; }
  }
  function write(store, obj) {
    try { root.localStorage.setItem(k(store), JSON.stringify(obj)); } catch (e) { mem[store] = obj; }
  }
  function strip(v) { // Blobs can't go into localStorage
    var o = {}; Object.keys(v).forEach(function (key) { if (!(typeof Blob !== 'undefined' && v[key] instanceof Blob)) o[key] = v[key]; }); return o;
  }
  return {
    kind: 'localStorage',
    get: function (s, id) { return Promise.resolve(read(s)[id] || null); },
    put: function (s, v) { var o = read(s); o[v.id] = strip(v); write(s, o); return Promise.resolve(v); },
    del: function (s, id) { var o = read(s); delete o[id]; write(s, o); return Promise.resolve(); },
    all: function (s) { var o = read(s); return Promise.resolve(Object.keys(o).map(function (key) { return o[key]; })); },
    clear: function (s) { write(s, {}); return Promise.resolve(); }
  };
}

function open(name, stores, version) {
  var ready = idbOpen(name, stores, version || 1).then(function (db) {
    return {
      kind: 'indexedDB',
      get: function (s, id) { return tx(db, s, 'readonly', function (os) { return os.get(id); }).then(function (v) { return v || null; }); },
      put: function (s, v) { return tx(db, s, 'readwrite', function (os) { return os.put(v); }).then(function () { return v; }); },
      del: function (s, id) { return tx(db, s, 'readwrite', function (os) { return os.delete(id); }); },
      all: function (s) { return tx(db, s, 'readonly', function (os) { return os.getAll(); }).then(function (v) { return v || []; }); },
      clear: function (s) { return tx(db, s, 'readwrite', function (os) { return os.clear(); }); }
    };
  }).catch(function () { return lsBackend(name); });
  function call(m) { return function () { var a = arguments; return ready.then(function (b) { return b[m].apply(b, a); }); }; }
  return { get: call('get'), put: call('put'), del: call('del'), all: call('all'), clear: call('clear'), kind: function () { return ready.then(function (b) { return b.kind; }); } };
}

// Small synchronous JSON settings helper (localStorage with memory fallback).
var memPrefs = {};
function prefs(key, defaults) {
  function read() { try { var v = root.localStorage.getItem(key); return Object.assign({}, defaults, v ? JSON.parse(v) : memPrefs[key] || {}); } catch (e) { return Object.assign({}, defaults, memPrefs[key] || {}); } }
  return {
    get: read,
    set: function (patch) { var v = Object.assign(read(), patch); try { root.localStorage.setItem(key, JSON.stringify(v)); } catch (e) { memPrefs[key] = v; } return v; },
    reset: function () { try { root.localStorage.removeItem(key); } catch (e) {} delete memPrefs[key]; return read(); }
  };
}

var api = { open: open, prefs: prefs };
if (typeof window !== 'undefined') window.ColonStore = api;

export { api as ColonStore };
