/* ColonBrowser · constants and helpers shared by the browser module's parts: quick links, control modes,
   favicon letters and saving a file. */

import { ColonURL } from '../url.js';

var U = ColonURL;

var QUICK = [
  { t: 'Nigeria', u: 'https://en.wikipedia.org/wiki/Nigeria', c: '#16A34A' },
  { t: 'Lagos', u: 'https://en.wikipedia.org/wiki/Lagos', c: '#4169E1' },
  { t: 'Nigerian naira', u: 'https://en.wikipedia.org/wiki/Nigerian_naira', c: '#0EA5E9' },
  { t: 'Afrobeats', u: 'https://en.wikipedia.org/wiki/Afrobeats', c: '#A855F7' },
  { t: 'Jollof rice', u: 'https://en.wikipedia.org/wiki/Jollof_rice', c: '#F97316' },
  { t: 'African Union', u: 'https://en.wikipedia.org/wiki/African_Union', c: '#EAB308' }
];
var MODES = {
  ai: { label: 'AI Mode', short: 'AI', icon: 'sparkles',
    desc: 'Saga performs authorised browsing actions. You watch every step.' },
  manual: { label: 'Manual', short: 'Manual', icon: 'hand', desc: 'You control the browser. AI automation is paused.' },
  shared: { label: 'Shared', short: 'Shared', icon: 'users',
    desc: 'You and Saga collaborate. Saga asks before each action.' }
};

// "en.wikipedia.org" -> "W", "punchng.com" -> "P"
function siteLetter(u) { var parts = U.hostOf(u).split('.'); var name = parts.length > 2 ? parts[parts.length
  - 2] : parts[0]; return ((name || '•')[0] || '•').toUpperCase(); }
function saveBlob(blob, name) {
  // Android app (v0.7.1): WebView can't follow <a download> to a blob, so the app saves it into Downloads.
  var N = window.Colon && window.Colon.native;
  if (N && N.hasBridge()) { N.saveBlob(blob, name).catch(function () { window.Colon.toast('Couldn’t save the file.',
    'bad'); }); return; }
  var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}

export { MODES, QUICK, saveBlob, siteLetter };
