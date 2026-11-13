// GET /browser/fetch: the server reader (contract: docs/phase8-backend-contract.md §1). The route file runs the
// switch/guest gate and the rate limits first; this handler only reads the page.
const reader = require('../reader');

// Answers 501 not_enabled when BROWSER_READER=off and 401 for guests when BROWSER_READER_GUESTS=off.
async function gate(req) {
  if (!reader.enabled()) throw reader.readerError(501, 'not_enabled', reader.MESSAGES.not_enabled[1]);
  if (!req.user && !reader.guestsAllowed()) {
    throw reader.readerError(401, 'unauthenticated', 'Please sign in to open pages in light mode.');
  }
}

async function getFetch(req) {
  const url = req.query.get('url');
  if (!url) throw reader.readerError(400, 'bad_url', 'Give an absolute http or https URL.');
  const page = await reader.read(url, { userId: req.user ? req.user.id : null,
    cacheKey: req.user ? `u${req.user.id}` : `ip:${req.ip}` });
  return [200, page, { 'Cache-Control': 'private, no-store' }];
}

module.exports = { gate, getFetch };
