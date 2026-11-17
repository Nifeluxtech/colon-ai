/* Colon Admin · billing helpers (v0.14.0): naira from kobo, allowance labels, idempotency keys, status badges. */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon, esc = C.esc;

var FEATURES = { ai_credits: 'AI credits a month', image_credits: 'Image credits', research_tasks: 'Research tasks',
  background_jobs: 'Background jobs', projects: 'Projects', memory: 'Memory tier (1–5)' };
var PAY_TONE = { success: 'ok', pending: 'warn', failed: 'bad', abandoned: '' };

// Money is stored in kobo; staff read and type naira.
function naira(kobo, dp) {
  var n = Number(kobo || 0) / 100;
  return '₦' + n.toLocaleString(undefined, { minimumFractionDigits: dp || 0, maximumFractionDigits: dp == null
    ? 2 : dp });
}
function toKobo(v) { var n = Number(String(v).replace(/[₦,\s]/g, '')); return Number.isFinite(n) ? Math.round(n
  * 100) : NaN; }
// Small spend (fractions of a kobo per call) reads better with more places.
function spend(kobo) { var k = Number(kobo || 0); return k > 0 && k < 100 ? naira(k, 4) : naira(k, 2); }
// One key per dialog: a retried request is applied once on the server.
function newKey() {
  var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}
function payBadge(s) { return '<span class="badge ' + (PAY_TONE[s] || '') + '">' + esc(s) + '</span>'; }
function tokens(n) { n = Number(n || 0); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3)
  + 'k' : n.toLocaleString(); }

export { FEATURES, naira, newKey, payBadge, spend, toKobo, tokens };
