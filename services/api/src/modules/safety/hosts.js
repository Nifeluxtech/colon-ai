// Host block list for anything that fetches or opens web pages for a user (the Colon Browser server reader, Phase 8;
// ADR 0003). Rule-based and in-process: well-known adult sites (refused for everyone in the reader: it serves the
// web light mode, where there is no age check), known malware / phishing test hosts, plus the extra hosts the
// operator lists (BROWSER_READER_BLOCKLIST, read by the caller). A host matches itself and all its subdomains.
// This is a hook, not a threat feed: a hosted list (for example a Safe Browsing lookup) can be added behind
// blockedHost() later without changing the callers.

const ADULT = ['pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com', 'youporn.com', 'tube8.com',
  'brazzers.com', 'onlyfans.com', 'chaturbate.com', 'livejasmin.com', 'stripchat.com', 'bongacams.com',
  'spankbang.com', 'eporner.com', 'beeg.com', 'motherless.com', 'fapello.com', 'rule34.xxx', 'e-hentai.org',
  'nhentai.net'];
// Labels that only adult sites use ("porn", "xxx", "hentai" anywhere in a label; whole-label "sex" only, so
// sussex.ac.uk or essex.gov.uk are not caught).
const ADULT_LABEL = /porn|xxx|hentai/i;
const ADULT_TLD = /\.(xxx|porn|sex|adult)$/i;
const MALWARE = ['malware.testing.google.test', 'testsafebrowsing.appspot.com', 'malware.wicar.org'];

const norm = (h) => String(h || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
const matches = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));

// "a.example, b.example" -> ['a.example', 'b.example']
function parseList(raw) {
  return String(raw || '').split(/[\s,]+/).map(norm).filter((h) => /^[a-z0-9.-]{1,253}$/.test(h));
}

/**
 * blockedHost(host, { extra: ['bad.example'] }) -> { blocked: true, category: 'adult'|'malware'|'listed' } or
 * { blocked: false }.
 */
function blockedHost(rawHost, o = {}) {
  const host = norm(rawHost);
  if (!host) return { blocked: false };
  if (matches(host, parseList((o.extra || []).join(',')))) return { blocked: true, category: 'listed' };
  if (matches(host, MALWARE)) return { blocked: true, category: 'malware' };
  const labels = host.split('.');
  if (matches(host, ADULT) || ADULT_TLD.test(host) || labels.some((l) => ADULT_LABEL.test(l) || l === 'sex')) {
    return { blocked: true, category: 'adult' };
  }
  return { blocked: false };
}

module.exports = { blockedHost, parseList };
