// Colon Browser (Phase 8): route wiring only. Handlers: modules/browser/handlers/*. Contract:
// docs/phase8-backend-contract.md.
// Reader: switch and guest gate first (501 not_enabled / 401), then rate limits: signed in 30 a minute and 500 a
// day per user; guests (BROWSER_READER_GUESTS=on) 60 a minute per IP and only from the Colon apps' own origins.
// A 429 carries retry_after (seconds) and Retry-After. Session and history need a signed-in user.
const Router = require('../router');
const { requireUser } = require('../../modules/auth').guards;
const { hit, perUser } = require('../middleware/ratelimit');
const { guestOrigin } = require('../middleware/origin');
const h = require('../../modules/browser').handlers;

// hit() with the contract's 429 shape: { error: 'rate_limited', message, retry_after }.
async function limited(bucket, max, windowSec) {
  try { await hit(bucket, max, windowSec); } catch (e) {
    if (e.code !== 'rate_limited') throw e;
    throw Object.assign(new Error('Too many pages at once. Wait a moment and try again.'), { status: 429,
      code: 'rate_limited', extra: { retry_after: windowSec }, headers: { 'Retry-After': String(windowSec) } });
  }
}

const perReader = async (req) => {
  if (req.user) {
    await limited(`reader:u${req.user.id}`, 30, 60);
    return limited(`reader-day:u${req.user.id}`, 500, 86400);
  }
  guestOrigin(req);
  return limited(`reader-guest:${req.ip}`, 60, 60);
};

const r = new Router();
r.get('/browser/fetch', h.reader.gate, perReader, h.reader.getFetch);

r.get('/browser/session', requireUser, perUser('browser-session-read', 600, 3600), h.session.getSession);
// A session with 30 tabs and their back/forward stacks can pass the default 64 KB JSON cap.
r.put('/browser/session', { bodyLimit: 512 * 1024 }, requireUser, perUser('browser-session', 1200, 3600),
  h.session.putSession);
r.delete('/browser/session', requireUser, perUser('browser-session', 1200, 3600), h.session.deleteSession);
r.get('/browser/sessions', requireUser, perUser('browser-session-read', 600, 3600), h.session.listSessions);

r.get('/browser/history', requireUser, perUser('browser-history-read', 600, 3600), h.history.listHistory);
r.post('/browser/history', requireUser, perUser('browser-history', 2000, 3600), h.history.addHistory);
r.delete('/browser/history/:id', requireUser, perUser('browser-history', 2000, 3600), h.history.removeHistory);
r.delete('/browser/history', requireUser, perUser('browser-history', 2000, 3600), h.history.clearHistory);

module.exports = r;
