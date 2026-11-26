/* Colon AI · Workspace chat photos (0.38.0): the photo button picks up to 3 images, uploads each (POST /uploads,
   the same files as the chat) and shows them above the message box with a remove button; the next message sends
   their ids and Colon builds from them. photoPicker(tray, button, data) -> { ids, uploading, clear } */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, icon = C.icon, esc = C.esc;
var MAX = 3;

export function photoPicker(tray, button, data) {
  var items = [];   // { key, name, url, id?, busy }
  function draw() {
    tray.hidden = !items.length;
    tray.innerHTML = items.map(function (p) {
      return '<span class="wk-photo' + (p.busy ? ' busy' : '') + '"><img src="' + esc(p.url) + '" alt="'
        + esc(p.name) + '"><button type="button" class="wk-photo-x" data-rm="' + p.key + '" aria-label="Remove '
        + esc(p.name) + '">' + icon('x') + '</button></span>';
    }).join('');
  }
  tray.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-rm]');
    if (!b) return;
    items = items.filter(function (p) { return String(p.key) !== b.getAttribute('data-rm'); }); draw();
  });
  function add(file) {
    if (items.length >= MAX) { C.toast('Send up to ' + MAX + ' photos at a time.'); return; }
    var p = { key: C.uid('p'), name: file.name || 'photo', url: URL.createObjectURL(file), busy: true };
    items.push(p); draw();
    data.upload(file).then(function (a) {
      if (!a || a.kind !== 'image') throw new Error('That file isn’t a photo.');
      p.id = a.id; p.busy = false; draw();
    }).catch(function (e) {
      items = items.filter(function (x) { return x !== p; }); draw(); C.toast(e.message, 'bad');
    });
  }
  button.addEventListener('click', function () {
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.addEventListener('change', function () { [].slice.call(input.files || []).forEach(add); });
    input.click();
  });
  return {
    ids: function () { return items.filter(function (p) { return p.id; }).map(function (p) { return p.id; }); },
    uploading: function () { return items.some(function (p) { return p.busy; }); },
    clear: function () { items = []; draw(); },
  };
}
