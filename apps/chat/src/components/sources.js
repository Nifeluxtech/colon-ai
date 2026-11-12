/* Colon AI · the Sources row under Research replies (favicons, site names, links). */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { ColonURL } from '../../../../packages/ui/js/url.js';

var C = Colon, icon = C.icon, esc = C.esc;

function sourcesHtml(src) {
  if (!src || !src.length) return '';
  return '<div class="cw-sources"><div class="cw-sources-h">' + icon('link')
    + 'Sources</div><div class="cw-sources-list no-scrollbar">' + src.map(function (s, i) {
    var host = s.site || ColonURL.hostOf(s.url);
    // Web search sources (they carry .site) open in a new tab; the favicon comes from the site itself, if it has one.
    var ico = s.site && /^https:\/\//i.test(s.url) ? '<img class="cw-source-ico" src="https://' + esc(rawHost(s.url))
      + '/favicon.ico" alt="" width="14" height="14" loading="lazy" decoding="async" referrerpolicy="no-referrer">' :
      '';
    return '<a class="cw-source" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer"' + (s.site
      ? ' data-web' : '') + ' data-source="' + esc(s.url) + '"><span class="cw-source-n">' + (s.n || i + 1)
      + '</span><span class="cw-source-b"><b>' + esc(s.title) + '</b><small>' + ico + esc(host) + '</small></span></a>';
  }).join('') + '</div></div>';
}
function rawHost(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }

export { sourcesHtml };
