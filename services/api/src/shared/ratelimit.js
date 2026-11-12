// Fixed-window rate limits stored in MySQL (workers are recycled, so memory can't hold counts).
const db = require('../db');

async function hit(bucket, limit, windowSec) {
  await db.query(
    `INSERT INTO rate_limits (bucket, hits, window_start) VALUES (?, 1, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       hits = IF(window_start < UTC_TIMESTAMP() - INTERVAL ? SECOND, 1, hits + 1),
       window_start = IF(window_start < UTC_TIMESTAMP() - INTERVAL ? SECOND, UTC_TIMESTAMP(), window_start)`,
    [bucket.slice(0, 190), windowSec, windowSec]
  );
  const row = await db.one('SELECT hits FROM rate_limits WHERE bucket = ?', [bucket.slice(0, 190)]);
  if (row && row.hits > limit) {
    throw Object.assign(new Error('Too many attempts. Please wait a few minutes and try again.'), { status: 429, code: 'rate_limited' });
  }
}

module.exports = { hit };
