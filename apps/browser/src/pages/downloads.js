/* Colon Browser · Downloads section (saved pages and files, uploads to your account). */

import { ColonBrowser } from '../../../../packages/ui/js/browser/index.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { errBox, head } from '../components/chrome.js';
import { S, UPLOAD_EXT, UPLOAD_MAX, UPLOAD_TYPES } from '../core/state.js';

var C = Colon, icon = C.icon, esc = C.esc;

function downloadsPage(box) {
  box.innerHTML = head('Downloads', 'Saved pages and files, plus files you upload.', '') +
    '<div class="section-title">Downloads</div><div class="bw-dl"><div class="skel" style="height:80px"></div></div>'
      +
    ('<div class="section-title">Uploads</div><div class="bw-drop" tabindex="0" role="button" aria-label="Choose '
      + 'files to upload">') + icon('upload')
      + ('<b>Choose files or drop them here</b><span class="small muted">Images, PDFs, documents and text · up to '
      + '20 MB each</span><input type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,appl'
      + 'ication/pdf,.txt,.md,.csv,.json,.doc,.docx,.odt,.rtf,.xls,.xlsx,.ppt,.pptx"></div>') +
    '<div class="bw-up-progress"></div><div class="bw-up"></div>';
  function loadDl() {
    var out = box.querySelector('.bw-dl');
    S.data.listDownloads().then(function (list) {
      if (!list.length) { out.innerHTML = '<div class="card empty">' + icon('download')
        + ('<div class="h3">No downloads yet</div><p class="small">Use the download button in the toolbar to save '
        + 'a page for offline reading.</p></div>'); return; }
      out.innerHTML = '<div class="list">' + list.map(function (d) {
        var ext = (d.name.split('.').pop() || '').toUpperCase();
        return '<div class="bw-row"><span class="bw-fileico">' + esc(ext.slice(0,
          4)) + '</span><span class="bw-row-main"><b>' + esc(d.name) + '</b><small>' + esc(d.type) + ' · '
          + C.fmtBytes(d.size || 0) + ' · ' + C.ago(d.created_at) + '</small></span>' +
          '<span class="badge ' + (d.status === 'complete' ? 'ok' : d.status === 'failed' ? 'bad' : '') + '">'
            + esc(d.status === 'complete' ? 'Complete' : d.status) + '</span>' +
          (d.has_file ? '<button class="icon-btn sm" data-dl-open="' + esc(d.id) + '" aria-label="Open '
            + esc(d.name) + '" data-tip="Open">' + icon('external')
            + '</button><button class="icon-btn sm" data-dl-save="' + esc(d.id) + '" aria-label="Save ' + esc(d.name)
            + ' again" data-tip="Save again">' + icon('download') + '</button>' : '') +
          '<button class="icon-btn sm" data-dl-rm="' + esc(d.id) + '" aria-label="Remove ' + esc(d.name)
            + '" data-tip="Remove">' + icon('x') + '</button></div>';
      }).join('') + '</div>';
      out.querySelectorAll('[data-dl-open]').forEach(function (b) { b.addEventListener('click', function () {
        S.data.getDownloadFile(b.getAttribute('data-dl-open')).then(function (blob) { if (!blob) return C.toast(
        'File not found on this device.', 'bad'); window.open(URL.createObjectURL(blob), '_blank', 'noopener'); });
        }); });
      out.querySelectorAll('[data-dl-save]').forEach(function (b) { b.addEventListener('click', function () { var d =
        list.filter(function (x) { return x.id === b.getAttribute('data-dl-save'); })[0]; S.data.getDownloadFile(
        d.id).then(function (blob) { if (blob) ColonBrowser.saveBlob(blob, d.name); }); }); });
      out.querySelectorAll('[data-dl-rm]').forEach(function (b) { b.addEventListener('click', function () {
        S.data.removeDownload(b.getAttribute('data-dl-rm')).then(function () { C.toast('Removed.'); loadDl(); }); });
        });
    }).catch(function (e) { errBox(out, e, loadDl); });
  }
  function loadUp() {
    var out = box.querySelector('.bw-up');
    S.data.listUploads().then(function (list) {
      out.innerHTML = list.length ? '<div class="list" style="margin-top:10px">' + list.map(function (u) {
        return '<div class="bw-row"><span class="bw-fileico">' + esc((u.name.split('.').pop() || '').toUpperCase(
          ).slice(0, 4)) + '</span><span class="bw-row-main"><b>' + esc(u.name) + '</b><small>' + C.fmtBytes(u.size)
          + ' · ' + C.ago(u.created_at) + '</small></span><span class="badge ok">Uploaded</span>' +
          '<button class="icon-btn sm" data-up-rm="' + esc(u.id) + '" aria-label="Remove ' + esc(u.name) + '">'
            + icon('x') + '</button></div>';
      }).join('') + '</div>' : '';
      out.querySelectorAll('[data-up-rm]').forEach(function (b) { b.addEventListener('click', function () {
        S.data.removeUpload(b.getAttribute('data-up-rm')).then(loadUp); }); });
    }).catch(function () {});
  }
  var drop = box.querySelector('.bw-drop'), input = drop.querySelector('input'), prog = box.querySelector(
    '.bw-up-progress');
  function upload(files) {
    Array.prototype.forEach.call(files, function (f) {
      var row = document.createElement('div'); row.className = 'bw-row bw-uprow';
      var okType = UPLOAD_TYPES.test(f.type) || UPLOAD_EXT.test(f.name);
      var err = !okType ? 'Unsupported file type. Use images, PDFs, documents or text.' : f.size > UPLOAD_MAX
        ? 'Too large: ' + C.fmtBytes(f.size) + ' (max 20 MB).' : !f.size ? 'This file is empty.' : null;
      row.innerHTML = '<span class="bw-fileico">' + esc((f.name.split('.').pop() || '').toUpperCase().slice(0,
        4)) + '</span><span class="bw-row-main"><b>' + esc(f.name) + '</b>' + (err
        ? '<small style="color:var(--bad)">' + esc(err) + '</small>' : '<span class="progress"><i></i></span>')
        + '</span>' +
        (err ? '<span class="badge bad">Not uploaded</span>' : '<span class="badge" data-pct>0%</span>')
          + '<button class="icon-btn sm" aria-label="Dismiss">' + icon('x') + '</button>';
      prog.appendChild(row);
      row.querySelector('button').addEventListener('click', function () { row.remove(); });
      if (err) return;
      S.data.upload(f, function (p) { row.querySelector('.progress i').style.width = Math.round(p * 100) + '%';
        row.querySelector('[data-pct]').textContent = Math.round(p * 100) + '%'; })
        .then(function () { row.remove(); C.toast('“' + f.name + '” uploaded.', 'ok'); loadUp(); },
          function (e) { var b = row.querySelector('[data-pct]'); b.textContent = 'Failed';
            b.className = 'badge bad'; row.querySelector('.progress').outerHTML = '<small style="color:var(--bad)">'
            + esc(e.message) + '</small>'; });
    });
  }
  drop.addEventListener('click', function () { input.click(); });
  drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault();
    input.click(); } });
  input.addEventListener('change', function () { upload(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault();
    drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over');
    }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer.files.length) upload(
    e.dataTransfer.files); });
  loadDl(); loadUp();
}

export { downloadsPage };
