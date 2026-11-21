/* Colon AI · memory chips under a sent message (0.24.0). The server says what it did with the message:
   - SSE `memory` { memory, memories[] }: personal facts (or "remember that …") saved. Chip "Saved to memory: …" with
     Undo, which deletes the new note, or puts the old text back when the fact replaced an older note (replaced).
   - SSE `memory_offer` { notes[] }: memory was never turned on and the message shared something personal. Chip
     "Turn on memory so Colon remembers this?" with Turn on (PUT /memory/consent, then POST /memories for the notes)
     and Not now (records memory off, so Colon never asks again). Shown once per device (localStorage): no nagging.
   The chip lives on the user message object (m.memoryChip) for this session only. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { S, data } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc;
var OFFER_KEY = 'colon.memoryOffer';

function offerSeen() { try { return localStorage.getItem(OFFER_KEY) === '1'; } catch (e) { return false; } }
function markOfferSeen() { try { localStorage.setItem(OFFER_KEY, '1'); } catch (e) { /* private mode */ } }

// The user message a stream event belongs to: the one just sent (tempUser) or by id.
function attach(msg, chip) { if (msg) msg.memoryChip = chip; }

/** From the stream: ev = { type: 'memory' | 'memory_offer', … }. -> true when a chip was set. */
function memoryEvent(ev, userMsg) {
  if (!userMsg) return false;
  if (ev.type === 'memory') {
    attach(userMsg, { state: 'saved', items: ev.memories && ev.memories.length ? ev.memories : [ev.memory] });
    return true;
  }
  if (ev.type === 'memory_offer' && !offerSeen()) {
    markOfferSeen(); attach(userMsg, { state: 'offer', notes: ev.notes || [] }); return true;
  }
  return false;
}

function btn(act, label, primary) {
  return '<button type="button" class="cw-memchip-btn' + (primary ? ' primary' : '') + '" data-memchip="' + act + '">'
    + esc(label) + '</button>';
}

/** The chip's HTML for a user message, or ''. */
function memoryChipHtml(m) {
  var c = m && m.memoryChip; if (!c) return '';
  var body;
  if (c.state === 'saved') {
    var text = c.items.map(function (x) { return x.content; }).join(' · ');
    body = '<span class="cw-memchip-text">' + (c.items.some(function (x) { return x.replaced != null; })
      ? 'Memory updated: ' : 'Saved to memory: ') + esc(text) + '</span>' + btn('undo', 'Undo')
      + '<a class="cw-memchip-btn" href="#/memory">Manage</a>';
  } else if (c.state === 'undone') {
    body = '<span class="cw-memchip-text">Not saved.</span>';
  } else if (c.state === 'offer') {
    body = '<span class="cw-memchip-text">Turn on memory so Colon remembers things like this?</span>'
      + btn('on', 'Turn on', true) + btn('no', 'Not now');
  } else if (c.state === 'on') {
    body = '<span class="cw-memchip-text">Memory is on' + (c.items && c.items.length ? '. Saved: '
      + esc(c.items.map(function (x) { return x.content; }).join(' · ')) : '') + '</span>'
      + '<a class="cw-memchip-btn" href="#/memory">Manage</a>';
  } else return '';
  return '<div class="cw-memchip" role="status">' + icon(c.state === 'offer' ? 'bookmark' : 'bookmarkFill') + body
    + '</div>';
}

/** Click on [data-memchip] inside a user message. rerender() redraws the thread. */
function memoryChipAction(el, rerender) {
  var node = el.closest('.cw-msg'), id = node && node.getAttribute('data-mid');
  var m = S.messages.find(function (x) { return x.id === id; }); if (!m || !m.memoryChip) return;
  var c = m.memoryChip, act = el.getAttribute('data-memchip');
  el.disabled = true;
  var done = function (state, items) { m.memoryChip = state ? { state: state, items: items || c.items } : null;
    rerender(); };
  var fail = function (e) { el.disabled = false; C.toast(e.message, 'bad'); };
  if (act === 'undo') {
    Promise.all(c.items.map(function (x) {
      return x.replaced != null ? data.editMemory(x.id, x.replaced) : data.deleteMemory(x.id); }))
      .then(function () { done('undone'); }, fail);
  } else if (act === 'on') {
    // Memory on, then the notes from this message; a note that can't be saved (full) leaves memory on anyway.
    data.setMemoryConsent(true).then(function () {
      return Promise.all((c.notes || []).map(function (n) { return data.addMemory({ content: n }).catch(
        function () { return null; }); }));
    }).then(function (saved) { done('on', saved.filter(Boolean)); }, fail);
  } else if (act === 'no') {
    data.setMemoryConsent(false).then(function () { done(null); }, fail);
  }
}

export { memoryChipAction, memoryChipHtml, memoryEvent };
