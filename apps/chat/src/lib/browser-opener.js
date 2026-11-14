/* Colon AI · which reply opened each chat's browser (0.11.1). 0.10.5 kept it in memory (S.browser.liveAnchor) and
   dropped it whenever the chat on screen changed, so after leaving a chat and coming back the live card fell back
   to an old task's message (next to that task's picture: a duplicate) or to "now" (the bottom of the thread). Kept
   per conversation in the page's storage now, with when the page first saw the browser open there (seenAt), so the
   card always goes back under the same message. At most MAX chats are kept (the oldest go first).
   No imports and every dependency injected: unit-tested in packages/ui/test/browser-opener.test.js. */

var KEY = 'colon.browserOpeners';
var MAX = 40;

function read(storage) {
  try {
    var v = JSON.parse((storage && storage.getItem(KEY)) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

function write(storage, all) {
  var keys = Object.keys(all).sort(function (a, b) { return (all[b].t || 0) - (all[a].t || 0); });
  var kept = {};
  keys.slice(0, MAX).forEach(function (k) { kept[k] = all[k]; });
  try { if (storage) storage.setItem(KEY, JSON.stringify(kept)); } catch (e) { /* full or blocked: memory only */ }
}

/** storage: localStorage-like (getItem, setItem). Returns { get(conv), set(conv, id, at), seen(conv, at),
 *  unseen(conv), forget(conv) }. get -> { id, at, seenAt } or null. */
function openerStore(storage) {
  var mem = read(storage);
  function entry(conv) { return conv ? mem[String(conv)] || null : null; }
  return {
    get: function (conv) {
      var e = entry(conv);
      return e ? { id: e.id || null, at: Number(e.at) || 0, seenAt: Number(e.s) || 0 } : null;
    },
    set: function (conv, id, at) {
      if (!conv || !id) return;
      var e = entry(conv) || {};
      mem[String(conv)] = { id: String(id), at: Number(at) || 0, s: e.s || 0, t: Number(at) || 0 };
      write(storage, mem);
    },
    // The first time this page saw the browser open on the chat (only once: the card never follows "now").
    seen: function (conv, at) {
      if (!conv) return;
      var e = entry(conv) || {};
      if (e.s) return;
      mem[String(conv)] = { id: e.id || null, at: e.at || 0, s: Number(at) || 0, t: Number(at) || 0 };
      write(storage, mem);
    },
    // The browser closed on this chat: the next open counts from then.
    unseen: function (conv) {
      var e = entry(conv);
      if (!e || !e.s) return;
      e.s = 0;
      write(storage, mem);
    },
    forget: function (conv) {
      if (!conv || !mem[String(conv)]) return;
      delete mem[String(conv)];
      write(storage, mem);
    }
  };
}

export { KEY, MAX, openerStore };
