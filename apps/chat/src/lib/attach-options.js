/* Colon AI · the composer's attach sheet (0.24.0): which items it lists and how each one sets up the hidden
   <input type="file">. Camera takes a photo (capture="environment": the Android app's WebChromeClient opens the
   camera), Photos picks images (the Android photo picker), Files picks any accepted type (the document picker).
   Inside a project chat a fourth item, Repository, shows only when a repository hook is installed.
   No DOM beyond the input apply() is handed; unit-tested in packages/ui/test/newchat.test.js. */

var ITEMS = {
  camera: { key: 'camera', label: 'Camera', sub: 'Take a photo', icon: 'camera' },
  photos: { key: 'photos', label: 'Photos', sub: 'Pick from your gallery', icon: 'image' },
  files: { key: 'files', label: 'Files', sub: 'PDFs, documents, code and text', icon: 'folder' },
  repository: { key: 'repository', label: 'Repository', sub: 'Attach a project repository', icon: 'code' }
};

/** o: { project (the chat belongs to a project), repoHook (a function that attaches a repository, or nothing) }. */
function attachItems(o) {
  o = o || {};
  var keys = ['camera', 'photos', 'files'];
  if (o.project && typeof o.repoHook === 'function') keys.push('repository');
  return keys.map(function (k) { return ITEMS[k]; });
}

/** The file input's settings for one item. accept: the composer's full accepted list (data.LIMITS.accept). */
function pickerAttrs(kind, accept) {
  if (kind === 'camera') return { accept: 'image/*', capture: 'environment', multiple: false };
  if (kind === 'photos') return { accept: 'image/*', capture: null, multiple: true };
  return { accept: accept || '', capture: null, multiple: true };
}

/** Sets the hidden file input up for one item (only its accept, multiple and capture attributes). */
function apply(input, kind, accept) {
  var a = pickerAttrs(kind, accept);
  input.accept = a.accept; input.multiple = a.multiple;
  if (a.capture) input.setAttribute('capture', a.capture); else input.removeAttribute('capture');
  return input;
}

export var AttachOptions = { ITEMS: ITEMS, attachItems: attachItems, pickerAttrs: pickerAttrs, apply: apply };
