/* Colon AI · Workspace "Download as ZIP" (v0.31.0). Every file and folder of the workspace (empty folders too) as
   one .zip, made on Colon's server (GET /workspaces/:id/export, owner only; no secret keys or tokens are in it).
   Used by the Files panel's Download button and by the Download ZIP card Colon adds in the chat when asked.
   In the Android app the file goes to Downloads through the app; on the web the browser saves it.
     downloadZip(data, id, btn?) -> Promise (never rejects; shows a toast) */
import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon;

function saveLink(blob, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function downloadZip(data, id, btn) {
  if (!data || !data.workspaceZip) {
    C.toast('Sign in to download your files.', 'bad');
    return Promise.resolve();
  }
  if (btn) btn.disabled = true;
  C.toast('Packing your files…');
  return data.workspaceZip(id).then(function (z) {
    return C.native.saveBlob(z.blob, z.name).then(function (saved) {
      if (!saved) saveLink(z.blob, z.name);
      C.toast((saved ? 'Saved to Downloads: ' : 'Downloaded ') + z.name, 'ok');
    });
  }).catch(function (e) { C.toast(e.message || 'The ZIP couldn’t be saved.', 'bad'); })
    .then(function () { if (btn) btn.disabled = false; });
}

export { downloadZip };
