// Builds Saga's curated cookie-banner rules (0.11.5) from a checkout of Consent-O-Matic (MIT, github.com/cavi-au/
// Consent-O-Matic, its LICENSE is kept beside the output). Saga only ever rejects, so a rule keeps its detectors and
// the methods that reject: OPEN_OPTIONS, DO_CONSENT (every category off), SAVE_CONSENT, and any method one of them
// runs (runmethod). HIDE_CMP (cosmetic), UTILITY-only rules, iframe-only rules and rules using actions the phone's
// interpreter does not run (slide, close, runrooted) are left out. The list below is a curated subset: the common
// consent platforms and big sites, about a third of the full set, to keep what the phone parses on every page small.
//   node scripts/vendor-consent-rules.js <Consent-O-Matic checkout> \
//     > apps/android/app/src/main/assets/saga/vendor/consent-o-matic/rules.json
const fs = require('fs');
const path = require('path');

const KEEP = ['onetrust', 'onetrust_banner', 'onetrust_pcpanel', 'onetrust_pctab', 'onetrust_stackoverflow', 'optanon',
  'optanon_alternative', 'cookiebot', 'didomi.io', 'quantcast', 'quantcast2', 'quantcast2b', 'usercentrics',
  'trustarc_bar', 'complianz.io', 'cookiescript', 'iubuenda', 'osano', 'klaro', 'tarteaucitron', 'borlabs',
  'cookieinformation', 'consentmanager.net', 'cookiebar', 'cookiecontrolcivic', 'cookielab', 'cookiewow',
  'cookiesjsr', 'gdprmodal', 'wordpress_gdpr', 'piwikproconsent', 'truendo', 'uniconsent', 'admiral', 'sirdata',
  'sfbx_appconsent', 'pubtech', 'fastcmp', 'gravito', 'liveramp', 'mediavine', 'cassie', 'clickio', 'evidon_banner',
  'chefcookie', 'ez-cookie', 'typo3cookieman', 'tealium.com', 'google_popup', 'google_cwiz', 'google_eomdialog',
  'google_consentdomain_1', 'google_consentdomain_2', 'yahoo_consent', 'facebook', 'instagram', 'linkedin_popup',
  'twitter', 'reddit', 'bing', 'amazon', 'aliexpress.com', 'airbnb', 'paypal_banner', 'deepl.com', 'notion.so',
  'twitch.tv', 'ubuntu.com', 'aws', 'autodesk', 'lenovo', 'ikea_toast', 'whatsapp', 'dailymotion.com', 'xe.com',
  'Etsy.com', 'skyscanner', 'webedia', 'future', 'snigel', 'stcmpv2', 'almacmpv2', 'oil', 'cookieinformation'];
const METHODS = ['OPEN_OPTIONS', 'DO_CONSENT', 'SAVE_CONSENT'];
const UNSUPPORTED = new Set(['slide', 'close', 'runrooted']);

function types(x, out = new Set()) {
  if (Array.isArray(x)) x.forEach((y) => types(y, out));
  else if (x && typeof x === 'object') {
    if (typeof x.type === 'string') out.add(x.type);
    Object.values(x).forEach((y) => types(y, out));
  }
  return out;
}
function runs(x, out = new Set()) {
  if (Array.isArray(x)) x.forEach((y) => runs(y, out));
  else if (x && typeof x === 'object') {
    if (x.type === 'runmethod' && x.method) out.add(x.method);
    Object.values(x).forEach((y) => runs(y, out));
  }
  return out;
}
const iframeOnly = (rule) => JSON.stringify(rule.detectors || []).includes('"iframeFilter":true');

function build(dir) {
  const all = {};
  for (const f of fs.readdirSync(path.join(dir, 'rules')).filter((n) => n.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'rules', f), 'utf8'));
    for (const [name, rule] of Object.entries(j)) if (!name.startsWith('$')) all[name] = rule;
  }
  const out = {};
  for (const name of [...new Set(KEEP)]) {
    const rule = all[name];
    if (!rule || iframeOnly(rule)) continue;
    const byName = Object.fromEntries((rule.methods || []).filter((m) => m && m.action)
      .map((m) => [m.name, m.action]));
    const want = new Set(METHODS.filter((m) => byName[m]));
    for (const m of [...want]) for (const r of runs(byName[m])) if (byName[r]) want.add(r);
    if (!want.size) continue;
    const methods = Object.fromEntries([...want].map((m) => [m, byName[m]]));
    if ([...types(methods)].some((t) => UNSUPPORTED.has(t))) continue;
    out[name] = { detectors: rule.detectors, methods };
  }
  return out;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/vendor-consent-rules.js <Consent-O-Matic checkout>'); process.exit(2);
  }
  const rules = build(dir);
  process.stdout.write(`${JSON.stringify({ source: 'Consent-O-Matic (MIT) rules, curated for Colon AI 0.11.5 by '
    + 'scripts/vendor-consent-rules.js', count: Object.keys(rules).length, rules })}\n`);
}

module.exports = { build, KEEP, METHODS };
