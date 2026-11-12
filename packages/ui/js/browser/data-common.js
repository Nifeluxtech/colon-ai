/* ColonBrowserData · defaults and small helpers shared by the local and account adapters. */

var DEFAULT_SETTINGS = {
  homepage: 'colon://newtab', engine: 'google', theme: 'system-app', restoreSession: true,
  loadImages: true, blockTrackers: true, doNotTrack: true, saveHistory: true,
  permissions: { microphone: 'ask', location: 'block', notifications: 'block', camera: 'ask' },
  askWhereToSave: false, downloadOpenAfter: false, aiApproval: 'sensitive', readerFont: 'md'
};
var MAX_PAGE = 2 * 1024 * 1024, TIMEOUT = 12000;

function now() { return new Date().toISOString(); }
function id(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function withTimeout(signal, ms) {
  var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms);
  if (signal) { if (signal.aborted) c.abort(); else signal.addEventListener('abort', function () { c.abort(); }); }
  return { signal: c.signal, done: function () { clearTimeout(t); } };
}
function err(code, message) { return Object.assign(new Error(message), { code: code }); }

export { DEFAULT_SETTINGS, MAX_PAGE, TIMEOUT, err, id, now, withTimeout };
