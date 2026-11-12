/* Colon AI · attachments on messages: chips, image thumbnails and opening a file. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { data } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc;

function attachmentsHtml(list) {
  if (!list || !list.length) return '';
  return '<div class="cw-atts">' + list.map(function (a) {
    if (a.kind === 'image') return '<button type="button" class="cw-att-img" data-att-open="' + esc(a.id)
      + '" data-kind="image" aria-label="Open image ' + esc(a.name) + '"><img alt="' + esc(a.name) + '" data-thumb="'
      + esc(a.id) + '"></button>';
    return '<button type="button" class="cw-att-file" data-att-open="' + esc(a.id) + '" data-kind="' + esc(a.kind)
      + '" data-name="' + esc(a.name) + '">' + icon(a.kind === 'audio' ? 'mic' : a.kind === 'text'
      ? 'file' : 'fileText') + '<span><b>' + esc(a.name) + '</b><small>' + C.fmtBytes(a.size || 0) + (a.duration
      ? ' · ' + a.duration + ' s' : '') + '</small></span></button>';
  }).join('') + '</div>';
}
var thumbUrls = {};
function loadAttachmentThumbs(root) {
  root.querySelectorAll('img[data-thumb]').forEach(function (img) {
    var id = img.getAttribute('data-thumb');
    if (thumbUrls[id]) { img.src = thumbUrls[id]; return; }
    data.fileBlob(id).then(function (b) { if (b) { thumbUrls[id] = URL.createObjectURL(b); img.src = thumbUrls[id];
      } else img.closest('.cw-att-img').classList.add('missing'); });
  });
}
function openAttachment(id, kind, name) {
  data.fileBlob(id).then(function (b) {
    if (!b) return C.toast('This file is no longer available on this device.', 'bad');
    var url = URL.createObjectURL(b);
    if (kind === 'image') C.sheet('<img src="' + url
      + ('" alt="" style="width:100%;height:auto;border-radius:12px;max-height:70dvh;object-fit:contain"><div '
      + 'class="sheet-actions"><a class="btn" href="') + url + '" download>' + icon('download')
      + 'Download</a><button class="btn primary" data-close>Close</button></div>', null, { cls: 'wide',
      label: 'Image preview' });
    else if (kind === 'audio') C.sheet('<div class="h2">' + esc(name) + '</div><audio controls src="' + url
      + ('" style="width:100%;margin-top:14px"></audio><div class="sheet-actions"><button class="btn primary" '
      + 'data-close>Close</button></div>'), null, { label: name });
    else if (kind === 'text') b.text().then(function (t) { C.sheet('<div class="h2">' + esc(name)
      + ('</div><pre class="mono" style="max-height:60dvh;overflow:auto;white-space:pre-wrap;background:var(--bg-2)'
      + ';padding:12px;border-radius:12px;border:1px solid var(--line)">') + esc(t.slice(0, 20000))
      + '</pre><div class="sheet-actions"><button class="btn primary" data-close>Close</button></div>', null,
      { cls: 'wide', label: name }); });
    else window.open(url, '_blank', 'noopener');
  });
}

export { attachmentsHtml, loadAttachmentThumbs, openAttachment };
