// Rate-limit middleware. The counters live in MySQL (shared/ratelimit.js).
const { hit } = require('../../shared/ratelimit');

// Middleware factory: limit per IP for a route group.
const limit = (name, max, windowSec) => async (req) => { await hit(`${name}:${req.ip}`, max, windowSec); };
// Middleware factory: limit per signed-in user (run after requireUser).
const perUser = (name, max, windowSec) => async (req) => { await hit(`${name}:u${req.user.id}`, max, windowSec); };

module.exports = { hit, limit, perUser };
