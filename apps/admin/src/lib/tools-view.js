/* Colon Admin · Tools (v0.17.0, Blueprint D14): turns one tool from GET /admin/tools into the lines the page shows.
   Pure (no DOM, no imports), so it is unit-tested in packages/ui/test/admin-tools.test.js. */

var RISK_BADGE = { low: ' ok', medium: ' warn', high: ' bad' };
var ENTITLEMENT = { image_credits: 'image credits', research_tasks: 'deep research tasks' };

/** "Every plan" / the plan codes, plus guests, plus the monthly allowance it draws on. */
function planAccess(t) {
  var plans = t.plans == null ? 'Every plan' : t.plans.length ? 'Plans: ' + t.plans.join(', ') : 'No plan';
  var guests = t.guests ? ' · guests too' : ' · signed-in only';
  var ent = t.entitlement ? ' · uses the plan\'s ' + (ENTITLEMENT[t.entitlement] || t.entitlement)
    + ' (Admin › Plans)' : '';
  return plans + guests + ent;
}

function creditCost(t) {
  var n = Number(t.credits) || 0;
  if (!n) return 'No credits';
  return n + ' credit' + (n === 1 ? '' : 's') + (t.defer ? ' (reserved, settled when the work ends)' : ' per call');
}

function timeout(ms) {
  var n = Number(ms) || 0;
  return n < 1000 ? n + ' ms' : n % 1000 ? (n / 1000).toFixed(1) + ' s' : n / 1000 + ' s';
}

/** Why a switched-off tool is off: known feature switches get a hint, others a generic line. */
function offReason(t) {
  if (t.enabled) return '';
  if (t.name === 'generate_image') return 'Off: no image provider (set CF_ACCOUNT_ID and CF_AI_TOKEN, or '
    + 'IMAGE_MODEL).';
  if (t.name === 'read_url') return 'Off: the server reader is switched off.';
  return 'Off: its feature switch is off.';
}

/** The full view model for one tool row. */
function toolView(t) {
  var s = t.stats;
  return {
    name: t.name,
    description: t.description || '',
    risk: t.risk,
    riskClass: RISK_BADGE[t.risk] || '',
    state: t.enabled ? 'on' : 'off',
    stateClass: t.enabled ? ' ok' : '',
    off: offReason(t),
    plans: planAccess(t),
    credits: creditCost(t),
    timeout: timeout(t.timeout_ms),
    consent: t.consent ? 'Asks the user first' : 'No consent step',
    flags: [t.model ? 'chat model' : '', t.defer ? 'background' : '', t.runs_in === 'caller' ? 'runs in its caller'
      : ''].filter(Boolean),
    note: t.note || '',
    stats: s ? s.calls + ' calls · ' + s.ok + ' ok · ' + s.failed + ' failed · ' + s.refused + ' refused · '
      + s.gated + ' gated' + (s.last_error ? ' · last error: ' + s.last_error : '') : 'No calls on this worker yet.'
  };
}

/** 0.17.1: GET /admin/tools image { provider, fallback, edits } -> one line for the banner. */
function imageProviderText(im) {
  if (!im) return '';
  var NAME = { cloudflare: 'Cloudflare Workers AI', gemini: 'Gemini' };
  var name = function (p) { return NAME[p] || p; };
  if (!im.provider || im.provider === 'off') return 'Image provider: off (no Cloudflare keys or IMAGE_MODEL).';
  return 'Image provider: ' + name(im.provider) + (im.fallback ? ', falling back to ' + name(im.fallback) : '')
    + '. Edits: ' + (im.edits && im.edits !== 'off' ? name(im.edits) : 'off (needs IMAGE_MODEL)') + '.';
}

/** Counts for the header tiles. */
function summary(tools) {
  var on = tools.filter(function (t) { return t.enabled; }).length;
  return { total: tools.length, on: on, off: tools.length - on,
    high: tools.filter(function (t) { return t.risk === 'high'; }).length };
}

export { creditCost, imageProviderText, offReason, planAccess, summary, timeout, toolView };
