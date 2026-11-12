// Per-user daily reply limits, tracked in MySQL (workers recycle, so memory can't hold counts).
// db is injectable for tests; the MySQL pool is loaded only when first needed.
// Subject: "u:<user id>" for accounts, "g:<hash>" per guest browser, "gi:<hash of IP>" per guest IP. Days are UTC.
const crypto = require('crypto');
const config = require('../../config');

const hash = (secret, kind, value) => crypto.createHash('sha256').update(`${secret || 'colon'}|${kind}|${value || ''}`).digest('hex').slice(0, 32);

// Guests are counted per browser (an anonymous "colon_gid" cookie) when it has one, else per IP. Many
// Nigerian mobile users share one IP (carrier NAT), so the IP alone would lump strangers together; a
// separate, higher per-IP cap stops one person from clearing cookies to get unlimited replies.
function guestSubject(ip, secret = config.auth.appSecret, gid = null) {
  return gid ? `g:${hash(secret, 'gid', gid)}` : `g:${hash(secret, 'guest', ip)}`;
}
const ipSubject = (ip, secret = config.auth.appSecret) => `gi:${hash(secret, 'ip', ip)}`;
const validGid = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(v) ? v : null);

function subjectFor(req) {
  return req.user ? `u:${req.user.id}` : guestSubject(req.ip, undefined, validGid(req.cookies && req.cookies.colon_gid));
}

function limitFor(req, cfg = config.chat) {
  if (req.user && req.user.role && req.user.role !== 'user') return Math.max(cfg.dailyLimit, 1000); // staff
  return req.user ? cfg.dailyLimit : cfg.guestDailyLimit;
}

// Every counter a reply is checked against: [{ subject, limit }].
function countersFor(req, cfg = config.chat) {
  const list = [{ subject: subjectFor(req), limit: limitFor(req, cfg) }];
  if (!req.user) list.push({ subject: ipSubject(req.ip), limit: cfg.guestIpDailyLimit });
  return list;
}

// Phase 4: limits editable live from the Admin Dashboard ("limits" setting, cached ~30 s per worker) on top
// of the env defaults, plus a per-user override (user_limits) and optional per-mode daily caps.
const MODE_NAMES = { general: 'General', study: 'Study', developer: 'Developer', research: 'Research' };
const posInt = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== null && v !== '' ? Math.floor(Number(v)) : d);
function mergeLimits(base, s) {
  s = s && typeof s === 'object' ? s : {};
  const modes = {};
  for (const m of Object.keys(MODE_NAMES)) { const n = s.modes && posInt(s.modes[m], null); if (n !== null && n !== undefined) modes[m] = n; }
  return { ...base, dailyLimit: posInt(s.user, base.dailyLimit), guestDailyLimit: posInt(s.guest, base.guestDailyLimit), guestIpDailyLimit: posInt(s.guestIp, base.guestIpDailyLimit), modes };
}
async function effective(db, settings = require('../../shared/settings')) { return mergeLimits(config.chat, await settings.get('limits', db)); }

// Every counter for this request, with live limits, the user's override and the mode's cap. Never throws on
// a settings/database read error (the env defaults apply).
async function resolveCounters(req, mode, db, settings) {
  const cfg = await effective(db, settings);
  const list = countersFor(req, cfg);
  const staff = req.user && req.user.role && req.user.role !== 'user';
  if (req.user) {
    let row = null;
    try { row = await (db || require('../../db')).one('SELECT daily_limit FROM user_limits WHERE user_id = ?', [req.user.id]); } catch { row = null; }
    if (row && row.daily_limit != null) list[0].limit = Number(row.daily_limit);
  }
  const cap = cfg.modes[mode];
  if (!staff && cap !== undefined) list.push({ subject: `${list[0].subject}:${mode}`.slice(0, 80), limit: cap, mode });
  return list;
}

function quotaError(guest, limit) {
  const msg = guest
    ? `You’ve used today’s ${limit} free guest replies. Log in or sign up to keep chatting, or come back tomorrow.`
    : `You’ve reached today’s limit of ${limit} replies. It resets at midnight (UTC).`;
  return Object.assign(new Error(msg), { status: 429, code: 'quota' });
}

// Counts one reply and throws a 'quota' error when the subject is over its limit (the reply is not counted then).
async function consume(subject, limit, db = require('../../db')) {
  if (!(limit > 0)) throw quotaError(subject.startsWith('g:'), 0);
  await db.query(
    `INSERT INTO chat_usage (subject, day, requests) VALUES (?, UTC_DATE(), 1)
     ON DUPLICATE KEY UPDATE requests = requests + 1`,
    [subject]
  );
  const row = await db.one('SELECT requests FROM chat_usage WHERE subject = ? AND day = UTC_DATE()', [subject]);
  const used = row ? Number(row.requests) : 1;
  if (used > limit) {
    await db.query('UPDATE chat_usage SET requests = requests - 1 WHERE subject = ? AND day = UTC_DATE() AND requests > 0', [subject]);
    throw quotaError(subject.startsWith('g:'), limit);
  }
  return { used, limit, remaining: limit - used };
}

// Gives a reply back (for example when no provider could answer at all).
async function refund(subject, db = require('../../db')) {
  await db.query('UPDATE chat_usage SET requests = requests - 1 WHERE subject = ? AND day = UTC_DATE() AND requests > 0', [subject]).catch(() => {});
}

// Consumes several counters; if one is over its limit, the ones already taken are given back.
async function consumeAll(counters, db = require('../../db')) {
  const done = [];
  for (const c of counters) {
    try { await consume(c.subject, c.limit, db); done.push(c); }
    catch (e) {
      for (const d of done) await refund(d.subject, db);
      if (e.code === 'quota' && c.mode) {
        throw Object.assign(new Error(`You’ve reached today’s limit of ${c.limit} replies in ${MODE_NAMES[c.mode] || c.mode} mode. Try another mode, or come back tomorrow.`), { status: 429, code: 'quota' });
      }
      if (e.code === 'quota' && c.subject.startsWith('gi:')) {
        throw Object.assign(new Error('Lots of guests on your network have chatted with Colon today. Log in or sign up (free) to keep chatting.'), { status: 429, code: 'quota' });
      }
      throw e;
    }
  }
}
async function refundAll(counters, db = require('../../db')) { for (const c of counters) await refund(c.subject, db); }

async function usage(subject, limit, db = require('../../db')) {
  const row = await db.one('SELECT requests FROM chat_usage WHERE subject = ? AND day = UTC_DATE()', [subject]);
  const used = row ? Number(row.requests) : 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

module.exports = { mergeLimits, effective, resolveCounters, consume, refund, consumeAll, refundAll, usage, subjectFor, limitFor, countersFor, guestSubject, ipSubject, validGid, quotaError };
