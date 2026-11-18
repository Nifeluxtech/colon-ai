/* Colon AI · maintenance and announcement banners on the welcome screen (moved out of pages/chat.js in v0.15.0). */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;
function noticeBanner() {
  var cfg = C.config || {}, out = '';
  if (cfg.maintenance && cfg.maintenance.on) out += '<div class="banner bad cw-notice" role="status">' + icon('alert')
    + '<span>' + esc(cfg.maintenance.message) + '</span></div>';
  var a = cfg.announcement;
  if (a && a.text) {
    var key = 'colon.banner.' + a.text.length + '.' + a.text.slice(0, 24);
    var hidden = false; try { hidden = sessionStorage.getItem(key) === '1'; } catch (e) {}
    if (!hidden) out += '<div class="banner ' + (a.tone === 'warn' ? '' : 'info')
      + ' cw-notice" role="status" data-banner="' + esc(key) + '">' + icon(a.tone === 'warn' ? 'alert' : 'bell')
      + '<span>' + esc(a.text)
      + '</span><button type="button" class="icon-btn sm" data-banner-x aria-label="Hide announcement">' + icon('x')
      + '</button></div>';
  }
  return out;
}
function bindNotice(root) {
  var b = root.querySelector('[data-banner-x]'); if (!b) return;
  b.addEventListener('click', function () { var box = b.closest('[data-banner]'); try { sessionStorage.setItem(
    box.getAttribute('data-banner'), '1'); } catch (e) {} box.remove(); });
}

export { bindNotice, noticeBanner };
