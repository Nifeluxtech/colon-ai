/* Colon App core · icon set (inline SVG paths), the Colon mark and the logo lockup. */

import { esc } from './dom.js';

/* ---------- Icons (inline SVG, stroke = currentColor) ---------- */
var P = {
  flame: ('<path d="M12 2c2.5 3.2 4.5 5.6 4.5 9a4.5 4.5 0 0 1-9 0c0-1.6.6-3 1.6-4.2.2 1.3.9 2.2 1.9 2.7C10.6 7.6 11 '
    + '4.8 12 2z"/><path d="M12 21a7 7 0 0 0 7-7"/>'),
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  devices: ('<rect x="2" y="5" width="14" height="10" rx="2"/><rect x="17" y="8" width="5" height="11" '
    + 'rx="1.5"/><path d="M6 19h6"/>'),
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/>',
  out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: ('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.3 2 12 2 '
    + '12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  book: ('<path d="M2 5.5C4.5 4 8 4 12 6c4-2 7.5-2 10-.5V19c-2.5-1.5-6-1.5-10 .5-4-2-7.5-2-10-.5z"/><path d="M12 '
    + '6v13.5"/>'),
  cap: '<path d="M2 9l10-5 10 5-10 5L2 9z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>',
  bulb: ('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 '
    + '0 12 3z"/>'),
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
  sparkles: ('<path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6L10 3z"/><path d="M18 14l.8 2.2L21 '
    + '17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"/>'),
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  users: ('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 '
    + '7M18 14a6 6 0 0 1 3.5 6"/>'),
  grid: ('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect '
    + 'x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/>',
  fileText: ('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6M8 '
    + '13h8M8 17h6"/>'),
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  copy: ('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 '
    + '0 2 2h3"/>'),
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  sun: ('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 '
    + '12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  micOff: ('<path d="M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11.2 '
    + '5.6M19 11c0 .8-.1 1.5-.4 2.2M12 18v3"/>'),
  clip: ('<path d="M20.5 11.5l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7L9.7 17.5a1.7 1.7 0 0 '
    + '1-2.4-2.4l7.8-7.8"/>'),
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  play: '<path d="M7 5l12 7-12 7V5z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L3 9M4 13a8 8 0 0 0 14.6 4.5L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/>',
  thumbUp: ('<path d="M7 11v9H4v-9h3zM7 11l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.3 '
    + '20H7"/>'),
  thumbDown:
    '<path d="M17 13V4h3v9h-3zM17 13l-4 8a2.5 2.5 0 0 1-2.5-2.5V15H5.3a2 2 0 0 1-2-2.4l1.4-7A2 2 0 0 1 6.7 4H17"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z"/><path d="M12 14v7"/>',
  archive: ('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 '
    + '13h4"/>'),
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  moreV: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  settings: ('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 '
    + '2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 '
    + '0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 '
    + '0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 '
    + '1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 '
    + '1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3z"/>',
  bookmarkFill: '<path d="M6 3h12v18l-6-4-6 4V3z" fill="currentColor"/>',
  saved: '<path d="M6 3h12v18l-6-4-6 4V3z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  tabs: ('<rect x="3" y="6" width="14" height="14" rx="2.5"/><path d="M7 6V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 '
    + '0 0 1-2 2h-2"/>'),
  maximize: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  minimize: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 14h18"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  collapse: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  link: ('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 '
    + '5.7l1-1"/>'),
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  hand: ('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 '
    + '0v7"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3.8 15a1.5 1.5 0 0 1 2.4-1.8L8 '
    + '15"/>'),
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 17h5"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  explore: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
  wifiOff: ('<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.5M12 20h.01M19 13a10 10 0 0 '
    + '0-2.2-1.6M2 9.5a15 15 0 0 1 4.4-2.8M10.7 5.1A15 15 0 0 1 22 9.5"/>'),
  lightning: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4L4 5z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  reader: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
  cursor: '<path d="M5 3l14 8-6 2-2 6-6-16z"/>',
  language: '<path d="M4 5h9M8.5 3v2c0 4-2.5 7-5 8.5M6 9c1 2.5 3.5 4.5 6.5 5.5"/><path d="M13 21l4-9 4 9M14.5 18h5"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4V9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  database: ('<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 '
    + '3.6 3 8 3s8-1.3 8-3"/>'),
  palette: ('<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.7-.9 1.4-1.9-.4-1.2.3-2.1 1.6-2.1H17a4 4 0 0 0 '
    + '4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" '
    + 'r="1"/>'),
  grip: ('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" '
    + 'cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>'
};
function icon(n, cls) { return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '')
  + (' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
  + 'aria-hidden="true">') + (P[n] || '') + '</svg>'; }
// Colon flame mark: royal-blue outer flame with a warm core (matches the brand mockup).
// Colon flame mark: royal-blue outer flame with a warm core (matches the brand mockup).
// Gradients live once in a shared <defs> block (duplicate ids inside hidden copies break in Chrome).
var MARK_DEFS = (
  '<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" '
  + 'focusable="false"><defs>') +
  ('<linearGradient id="cm-o" x1="10" y1="44" x2="38" y2="4" gradientUnits="userSpaceOnUse"><stop offset="0" '
    + 'stop-color="#3457C7"/><stop offset=".55" stop-color="#4169E1"/><stop offset="1" '
    + 'stop-color="#38BDF8"/></linearGradient>') +
  ('<linearGradient id="cm-i" x1="24" y1="42" x2="24" y2="18" gradientUnits="userSpaceOnUse"><stop offset="0" '
    + 'stop-color="#FF6A1A"/><stop offset=".6" stop-color="#FF9A3D"/><stop offset="1" '
    + 'stop-color="#FFD166"/></linearGradient></defs></svg>');
function injectDefs() { if (!document.getElementById('colon-mark-defs')) { var d = document.createElement('div');
  d.id = 'colon-mark-defs'; d.innerHTML = MARK_DEFS; document.body.insertBefore(d, document.body.firstChild); } }
if (document.body) injectDefs(); else document.addEventListener('DOMContentLoaded', injectDefs);
var MARK = '<svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true">' +
  ('<path fill="url(#cm-o)" d="M24 2c5.6 6.8 12.6 12.4 12.6 22.4A12.6 12.6 0 0 1 24 37a12.6 12.6 0 0 '
    + '1-12.6-12.6c0-4.6 1.8-8.4 4.8-11.6.4 3.6 2.2 6 5 7.2C20.6 13.6 21.4 7.4 24 2z"/>') +
  ('<path fill="url(#cm-i)" d="M24 18.5c2.6 3.4 5.6 6 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-2.1.8-3.8 2.2-5.2.2 1.6 1 2.7 '
    + '2.2 3.2-.3-3.3.1-5.9 1.2-8.4z"/>') +
  '<ellipse cx="24" cy="43" rx="9" ry="2.2" fill="#38BDF8" opacity=".35"/></svg>';
function logo(name, sub, cls) { return '<span class="logo ' + (cls || '') + '">' + MARK + '<span><b>' + esc(name
  || 'COLON AI') + '</b>' + (sub === false ? '' : '<small>' + esc(sub || 'by Nifelux') + '</small>')
  + '</span></span>'; }

export { MARK, icon, logo };
