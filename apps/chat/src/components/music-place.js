/* Colon AI · where Colon Music's video card sits in the chat (0.22.0). message.js renderThread() rebuilds #cw-page
   on every render, and moving an iframe restarts its video, so the real card never lives in the thread: it sits in a
   stable layer inside #cw-scroll, after #cw-page (`.cm-layer`, height 0, position:relative, so it scrolls with the
   thread), and is laid over a same-size placeholder (`.cm-slot`) that goes back into the thread after each render,
   right after the message that was last when the music started (or at the end of the page).
   attach(card, anchorId) · place() (CW.placeMusic, after every renderThread) · detach() · reveal() */

import { CW } from '../core/cw.js';
import { $ } from '../core/state.js';

var layer = null, card = null, slot = null, anchor = '', ro = null, raf = 0;

function ensureLayer() {
  var sc = $('#cw-scroll'), page = $('#cw-page');
  if (!sc || !page) return null;
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div'); layer.className = 'cm-layer';
    page.parentNode.insertBefore(layer, page.nextSibling);
  }
  return layer;
}

function ensureSlot() {
  var page = $('#cw-page');
  if (!page || !card) return null;
  if (!slot) {
    slot = document.createElement('div'); slot.className = 'cm-slot'; slot.setAttribute('aria-hidden', 'true');
  }
  var thread = page.querySelector('.cw-thread') || page;
  var after = null;
  if (anchor) {
    var all = thread.querySelectorAll('[data-mid]');
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-mid') === anchor) after = all[i];
  }
  var want = after ? after.nextSibling : null;
  if (slot.parentNode !== thread || (after ? slot.previousSibling !== after : slot !== thread.lastChild)) {
    thread.insertBefore(slot, after ? want : null);
  }
  return slot;
}

/** Lay the card over its placeholder (and size the placeholder to the card). */
function place() {
  if (!card) return;
  var l = ensureLayer(), s = ensureSlot();
  if (!l || !s) return;
  if (card.parentNode !== l) l.appendChild(card);
  var h = card.offsetHeight;
  if (h && s.style.height !== h + 'px') s.style.height = h + 'px';
  var lr = l.getBoundingClientRect(), sr = s.getBoundingClientRect();
  card.style.width = sr.width + 'px';
  card.style.transform = 'translate(' + Math.round(sr.left - lr.left) + 'px,' + Math.round(sr.top - lr.top) + 'px)';
}

function soon() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; place(); }); }

function attach(el, anchorId) {
  detach();
  card = el; anchor = anchorId || '';
  if (!ensureLayer()) { card = null; return false; }
  layer.appendChild(card);
  place();
  if (window.ResizeObserver) {
    ro = new ResizeObserver(soon);
    ro.observe(card); ro.observe($('#cw-page')); ro.observe($('#cw-scroll'));
  }
  window.addEventListener('resize', soon, { passive: true });
  CW.placeMusic = place;
  return true;
}

function detach() {
  if (ro) { ro.disconnect(); ro = null; }
  window.removeEventListener('resize', soon);
  if (card && card.parentNode) card.parentNode.removeChild(card);
  if (slot && slot.parentNode) slot.parentNode.removeChild(slot);
  card = null; slot = null; anchor = '';
  CW.placeMusic = null;
}

/** Scroll the thread so the whole card shows above the floating composer. */
function reveal() {
  var sc = $('#cw-scroll'), s = slot;
  if (!sc || !s || !s.isConnected) return;
  var cover = $('.cw-composer'), sr = s.getBoundingClientRect(), cr = sc.getBoundingClientRect();
  var bottom = cover && !cover.hidden ? Math.min(cr.bottom, cover.getBoundingClientRect().top) : cr.bottom;
  var by = sr.bottom + 12 - bottom;
  if (sr.top - by < cr.top) by = sr.top - cr.top - 12;
  if (Math.abs(by) > 2) sc.scrollTo({ top: sc.scrollTop + by, behavior: 'smooth' });
}

export { attach as attachMusicCard, detach as detachMusicCard, place as placeMusicCard, reveal as revealMusicCard };
