/* Colon App core · toasts, sheets, confirm/prompt dialogs, menus, tooltips, the drawer, the on-screen keyboard
   offset and resizable panes. */

import { $, $$, esc } from './dom.js';
import { icon } from './icons.js';

/* ---------- Toast, sheet/modal, confirm, prompt ---------- */
// toast(message, kind?: 'ok'|'bad', action?: { label, fn })
function toast(msg, kind, action) {
  var host = $('.toasts') || document.body.appendChild(Object.assign(document.createElement('div'),
    { className: 'toasts' }));
  host.setAttribute('aria-live', 'polite');
  var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.setAttribute('role', kind === 'bad'
    ? 'alert' : 'status');
  var span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
  if (action) {
    var b = document.createElement('button'); b.className = 'toast-act'; b.type = 'button';
      b.textContent = action.label;
    b.addEventListener('click', function () { action.fn(); t.remove(); }); t.appendChild(b);
  }
  host.appendChild(t);
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 260);
    }, action ? 6000 : 3400);
}
var FOCUSABLE = (
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]'
  + ':not([tabindex="-1"])');
function trapFocus(el, e) {
  if (e.key !== 'Tab') return;
  var f = $$(FOCUSABLE, el).filter(function (x) { return x.offsetParent !== null; }); if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
}
// sheet(html, onMount?, opts?: { cls, label, onClose }) -> close()
function sheet(html, onMount, opts) {
  opts = opts || {};
  var prev = document.activeElement;
  var back = document.createElement('div'); back.className = 'sheet-back';
  var el = document.createElement('div'); el.className = 'sheet ' + (opts.cls || ''); el.setAttribute('role',
    'dialog'); el.setAttribute('aria-modal', 'true');
  if (opts.label) el.setAttribute('aria-label', opts.label);
  el.innerHTML = html;
  var closed = false;
  function close() {
    if (closed) return; closed = true;
    back.remove(); el.remove(); document.removeEventListener('keydown', onKey, true);
    if (prev && prev.focus) try { prev.focus(); } catch (e) {}
    if (opts.onClose) opts.onClose();
  }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } else trapFocus(el, e); }
  back.addEventListener('click', close); document.addEventListener('keydown', onKey, true);
  document.body.appendChild(back); document.body.appendChild(el);
  $$('[data-close]', el).forEach(function (b) { b.addEventListener('click', close); });
  if (onMount) onMount(el, close);
  var f = $('[autofocus]', el) || $('input,textarea,select', el) || $('button', el); if (f) setTimeout(function () {
    f.focus(); }, 50);
  return close;
}
// confirm({ title, body, confirm, cancel, danger }) -> Promise<boolean>
function confirmDialog(o) {
  o = o || {};
  return new Promise(function (resolve) {
    var done = false;
    sheet('<div class="h2">' + esc(o.title || 'Are you sure?') + '</div>' + (o.body
      ? '<p class="small muted" style="margin:6px 0 0">' + esc(o.body) + '</p>' : '') +
      '<div class="sheet-actions"><button type="button" class="btn ghost" data-close>' + esc(o.cancel || 'Cancel')
        + '</button>' +
      '<button type="button" class="btn ' + (o.danger ? 'danger solid' : 'primary') + '" data-ok autofocus>'
        + esc(o.confirm || 'Confirm') + '</button></div>',
      function (el, close) { $('[data-ok]', el).addEventListener('click', function () { done = true; close();
        resolve(true); }); },
      { label: o.title, onClose: function () { if (!done) resolve(false); } });
  });
}
// prompt({ title, label, value, placeholder, confirm, max }) -> Promise<string|null>
function promptDialog(o) {
  o = o || {};
  return new Promise(function (resolve) {
    var done = false;
    sheet('<div class="h2">' + esc(o.title || '') + '</div><form class="form" style="margin-top:14px" novalidate>' +
      '<div class="field"><label for="pd-in">' + esc(o.label || '')
        + '</label><input class="input" id="pd-in" maxlength="' + (o.max || 120) + '" value="' + esc(o.value || '')
        + '" placeholder="' + esc(o.placeholder || '') + '" autofocus><div class="msg"></div></div>' +
      ('<div class="sheet-actions" style="margin-top:4px"><button type="button" class="btn ghost" '
        + 'data-close>Cancel</button><button class="btn primary" type="submit">') + esc(o.confirm || 'Save')
        + '</button></div></form>',
      function (el, close) {
        var inp = $('input', el); setTimeout(function () { inp.select(); }, 60);
        $('form', el).addEventListener('submit', function (e) {
          e.preventDefault(); var v = inp.value.trim();
          if (!v && o.required !== false) { inp.parentNode.classList.add('err'); $('.msg',
            el).textContent = 'This can’t be empty.'; return; }
          done = true; close(); resolve(v);
        });
      }, { label: o.title, onClose: function () { if (!done) resolve(null); } });
  });
}

/* ---------- Popover menu: menu(anchor, items, opts) ----------
   items: [{ label, sub?, icon?, onClick, danger?, checked?, disabled? } | '-' | { head }] */
var openMenu = null;
function menu(anchor, items, opts) {
  opts = opts || {};
  if (openMenu) { var same = openMenu.anchor === anchor; openMenu.close(); if (same) return; }
  var el = document.createElement('div'); el.className = 'menu' + (opts.sheetOnMobile ? ' as-sheet' : '');
    el.setAttribute('role', 'menu');
  if (opts.label) el.setAttribute('aria-label', opts.label);
  el.innerHTML = items.map(function (it, i) {
    if (it === '-') return '<hr>';
    if (it.head) return '<div class="menu-head">' + esc(it.head) + '</div>';
    if (it.html) return it.html;
    var role = it.checked !== undefined ? 'menuitemradio' : 'menuitem';
    return '<button type="button" class="mi' + (it.danger ? ' danger' : '') + '" role="' + role + '" data-i="' + i
      + '"' + (it.checked !== undefined ? ' aria-checked="' + !!it.checked + '"' : '') + (it.disabled
      ? ' disabled' : '') + '>' +
      (it.icon ? icon(it.icon) : '') + '<span class="mi-body">' + esc(it.label) + (it.sub ? '<span class="mi-sub">'
        + esc(it.sub) + '</span>' : '') + '</span>' +
      (it.badge ? it.badge : '') + (it.checked ? '<span class="tick">' + icon('check') + '</span>' : '') + '</button>';
  }).join('');
  document.body.appendChild(el);
  var r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  var left = opts.align === 'right' ? r.right - w : r.left; left = Math.max(8, Math.min(left, innerWidth - w - 8));
  var top = r.bottom + 6; if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
  el.style.left = left + 'px'; el.style.top = Math.max(8, top) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  function close() {
    el.remove(); anchor.setAttribute('aria-expanded', 'false'); openMenu = null;
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true);
      removeEventListener('resize', close);
  }
  function outside(e) { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); }
  function key(e) {
    var btns = $$('.mi:not([disabled])', el), i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
    else if (e.key === 'Tab') close();
  }
  el.addEventListener('click', function (e) {
    var b = e.target.closest('.mi'); if (!b) return;
    var it = items[Number(b.getAttribute('data-i'))]; close(); if (it && it.onClick) it.onClick();
  });
  setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
  document.addEventListener('keydown', key, true); addEventListener('resize', close);
  var first = $('.mi[aria-checked="true"]', el) || $('.mi:not([disabled])', el); if (first) first.focus({
    preventScroll: true });
  openMenu = { anchor: anchor, close: close, el: el };
  return close;
}

/* ---------- Tooltips: any element with data-tip="…" (hover / keyboard focus) ---------- */
(function () {
  var tip = null, timer = null;
  function hide() { clearTimeout(timer); if (tip) { tip.remove(); tip = null; } }
  function show(t) {
    hide(); var text = t.getAttribute('data-tip'); if (!text) return;
    timer = setTimeout(function () {
      tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip');
        tip.textContent = text; document.body.appendChild(tip);
      var r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      var top = r.top - h - 8; if (top < 6) top = r.bottom + 8;
      tip.style.left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 6)) + 'px';
        tip.style.top = top + 'px';
    }, 350);
  }
  document.addEventListener('pointerover', function (e) { if (e.pointerType === 'touch') return;
    var t = e.target.closest && e.target.closest('[data-tip]'); if (t) show(t); });
  document.addEventListener('pointerout', function (e) { if (e.target.closest && e.target.closest('[data-tip]')) hide(
    ); });
  document.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('[data-tip]');
    if (t && t.matches(':focus-visible')) show(t); else hide(); });
  document.addEventListener('pointerdown', hide, true); document.addEventListener('keydown', function (e) { if (
    e.key === 'Escape') hide(); });
})();

/* ---------- Drawer: drawer(el) -> { open, close, toggle, isOpen } ---------- */
function drawer(el, opts) {
  opts = opts || {};
  var back = document.createElement('div'); back.className = 'drawer-back'; el.parentNode.insertBefore(back, el);
  var prev = null, open = false;
  function key(e) { if (e.key === 'Escape') ctl.close(); else trapFocus(el, e); }
  var ctl = {
    open: function () { if (open) return; open = true; prev = document.activeElement; el.classList.add('open');
      back.classList.add('open'); el.removeAttribute('inert'); el.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', key, true); var f = $(FOCUSABLE, el); if (f) setTimeout(function () {
        f.focus(); }, 60); if (opts.onChange) opts.onChange(true); },
    close: function () { if (!open) return; open = false; el.classList.remove('open'); back.classList.remove('open');
      el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', key, true); if (prev && prev.focus) prev.focus();
        if (opts.onChange) opts.onChange(false); },
    toggle: function () { open ? ctl.close() : ctl.open(); },
    isOpen: function () { return open; },
    destroy: function () { document.removeEventListener('keydown', key, true); back.remove(); }
  };
  back.addEventListener('click', ctl.close);
  el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true');
  return ctl;
}

/* ---------- Mobile keyboard: --kb = on-screen keyboard height (visualViewport) ---------- */
var kbBound = false;
function keyboard() {
  if (kbBound || !window.visualViewport) return; kbBound = true;
  var vv = window.visualViewport;
  function upd() {
    var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', (kb > 60 ? kb : 0) + 'px');
    // visible height above the keyboard
    document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    document.documentElement.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
    document.documentElement.classList.toggle('kb-open', kb > 60);
  }
  vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd); upd();
}

/* ---------- Resizable split: resizable(handle, { min, max, get, set, axis }) ---------- */
function resizable(handle, o) {
  var start = 0, startVal = 0, axis = o.axis || 'x';
  handle.setAttribute('role', 'separator'); handle.setAttribute('tabindex', '0'); handle.setAttribute(
    'aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
  function clamp(v) { return Math.max(o.min, Math.min(o.max(), v)); }
  function aria() { handle.setAttribute('aria-valuenow', Math.round(o.get())); handle.setAttribute('aria-valuemin',
    o.min); handle.setAttribute('aria-valuemax', Math.round(o.max())); }
  handle.addEventListener('pointerdown', function (e) {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add('dragging');
    start = axis === 'x' ? e.clientX : e.clientY; startVal = o.get(); document.body.style.userSelect = 'none';
  });
  handle.addEventListener('pointermove', function (e) {
    if (!handle.classList.contains('dragging')) return;
    var d = (axis === 'x' ? e.clientX : e.clientY) - start; o.set(clamp(startVal + (o.invert ? -d : d))); aria();
  });
  function end() { handle.classList.remove('dragging'); document.body.style.userSelect = ''; if (o.done) o.done(o.get(
    )); }
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 60 : 20, dir = 0;
    if (e.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp')) dir = -1; else if (e.key === (axis === 'x'
      ? 'ArrowRight' : 'ArrowDown')) dir = 1; else return;
    e.preventDefault(); o.set(clamp(o.get() + dir * step * (o.invert ? -1 : 1))); aria(); if (o.done) o.done(o.get());
  });
  aria();
}

export { confirmDialog, drawer, keyboard, menu, promptDialog, resizable, sheet, toast, trapFocus };
