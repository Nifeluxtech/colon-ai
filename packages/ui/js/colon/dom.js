/* Colon App core · small DOM and formatting helpers: escaping, queries, dates, bytes, ids, clipboard. */

/* ---------- Helpers ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;',
  '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function initials(name, email) { var s = (name || email || '?').trim(); var p = s.split(/\s+/); return ((p[0] || '')[0]
  + ((p[1] || '')[0] || '')).toUpperCase(); }
function ago(d) {
  var s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 604800) return Math.floor(s / 86400) + ' d ago';
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function device(ua) {
  ua = ua || '';
  var os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua)
    ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown device';
  var br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' :
    /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return br + ' on ' + os;
}

/* ---------- Misc helpers ---------- */
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(function () {
    return legacyCopy(text); });
  return legacyCopy(text);
}
function legacyCopy(text) {
  return new Promise(function (resolve, reject) {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e);
      } ta.remove();
  });
}
function fmtBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0)
  + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
function uid(prefix) { return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t);
  t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

export { $, $$, ago, copyText, debounce, device, esc, fmtBytes, initials, uid };
