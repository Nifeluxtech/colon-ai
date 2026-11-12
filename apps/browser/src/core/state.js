/* Colon Browser · shared state and constants: the window.CB namespace, the S object, sections, upload limits. */

var B = window.CB = window.CB || {};
var S = { el: null, inst: null, section: 'home', data: null };
var NAV = [['home', '/', 'home', 'Home'], ['tabs', '/tabs', 'tabs', 'Tabs'], ['bookmarks', '/bookmarks', 'bookmark',
  'Bookmarks'], ['history', '/history', 'history', 'History'],
  ['downloads', '/downloads', 'download', 'Downloads'], ['ai', '/ai', 'sparkles', 'AI Browse'], ['settings',
    '/settings', 'settings', 'Settings'], ['help', '/help', 'help', 'Help']];
var UPLOAD_TYPES = new RegExp(
  String.raw`^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/|application\/(json|msword|vnd\.openxmlformats|`
  + String.raw`vnd\.oasis|rtf))`);
var UPLOAD_EXT = /\.(png|jpe?g|webp|gif|pdf|txt|md|csv|json|docx?|odt|rtf|xlsx?|pptx?)$/i;
var UPLOAD_MAX = 20 * 1048576;

function $(s) { return S.el.querySelector(s); }
function isMobile() { return innerWidth < 900; }

export { $, B, NAV, S, UPLOAD_EXT, UPLOAD_MAX, UPLOAD_TYPES };
