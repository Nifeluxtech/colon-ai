// Crash Predictor settings: defaults, validation and the guardrail state (docs/crash-predictor/HANDOFF.md).
//   DEFAULTS                  a new user's settings: 1.30x target, demo mode ON, guardrails on
//   validate(patch, current)  -> { settings, changes } (changes: { field: [from, to] }); throws 422 { field } on a
//                             bad value, and 409 confirm_real_money when demo mode is switched off without
//                             confirm_real_money: true (the app shows REAL_MONEY_WARNING first)
//   guardrails(settings, use) -> { status: 'ok'|'stopped', reasons[] } from today's and this session's bets
const DEFAULTS = Object.freeze({
  target_cashout: 1.3, stake: 100, currency: 'NGN', demo_mode: true, stake_cap: 1000, stop_loss: 2000,
  daily_loss_limit: 5000, max_bets_per_session: 20, kill_switch: false, site_url: null,
});
const LIMITS = Object.freeze({
  target_cashout: [1.01, 100], stake: [0.01, 1e7], stake_cap: [0.01, 1e7], stop_loss: [0.01, 1e8],
  daily_loss_limit: [0.01, 1e8], max_bets_per_session: [1, 500],
});
const FIELDS = Object.keys(DEFAULTS);
const REAL_MONEY_WARNING = 'Real money: auto-clicking on a betting site may breach its terms, and at about 97% RTP '
  + 'every bet loses about 3% of its stake on average. No pattern changes that. Only stake what you can lose.';

const err = (status, code, message, field) => Object.assign(new Error(message), { status, code, field });
const bad = (field, message) => { throw err(422, 'invalid', message, field); };

function money(field, v, label) {
  const n = Number(v);
  const [lo, hi] = LIMITS[field];
  if (v === '' || v === null || typeof v === 'boolean' || !Number.isFinite(n)) bad(field, `Enter ${label}.`);
  if (n < lo || n > hi) bad(field, `${label[0].toUpperCase() + label.slice(1)} must be between ${lo} and ${hi}.`);
  return Math.round(n * 100) / 100;
}
function flag(field, v) {
  if (typeof v !== 'boolean') bad(field, 'Send true or false.');
  return v;
}
function siteUrl(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (s.length > 500) bad('site_url', 'That address is too long.');
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); }
  catch { bad('site_url', 'Enter a web address.'); }
  if (!['https:', 'http:'].includes(u.protocol) || !u.hostname.includes('.')) bad('site_url', 'Enter a web address.');
  if (u.username || u.password) bad('site_url', 'Leave your login out of the address.');
  return u.href;
}
const CLEAN = {
  target_cashout: (v) => money('target_cashout', v, 'the target cash-out'),
  stake: (v) => money('stake', v, 'a stake'),
  stake_cap: (v) => money('stake_cap', v, 'a stake cap'),
  stop_loss: (v) => money('stop_loss', v, 'a stop-loss'),
  daily_loss_limit: (v) => money('daily_loss_limit', v, 'a daily loss limit'),
  max_bets_per_session: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < LIMITS.max_bets_per_session[0] || n > LIMITS.max_bets_per_session[1]) {
      bad('max_bets_per_session', 'Max bets per session must be a whole number from 1 to 500.');
    }
    return n;
  },
  currency: (v) => {
    const s = String(v || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(s)) bad('currency', 'Use a 3-letter currency code, such as NGN.');
    return s;
  },
  demo_mode: (v) => flag('demo_mode', v),
  kill_switch: (v) => flag('kill_switch', v),
  site_url: siteUrl,
};

// Stored row (DECIMAL strings, TINYINT) -> plain settings.
function fromRow(r) {
  if (!r) return { ...DEFAULTS };
  const num = (k) => (r[k] == null ? DEFAULTS[k] : Number(r[k]));
  return { target_cashout: num('target_cashout'), stake: num('stake'), currency: r.currency || DEFAULTS.currency,
    demo_mode: r.demo_mode == null ? true : Boolean(Number(r.demo_mode)), stake_cap: num('stake_cap'),
    stop_loss: num('stop_loss'), daily_loss_limit: num('daily_loss_limit'),
    max_bets_per_session: num('max_bets_per_session'), kill_switch: Boolean(Number(r.kill_switch || 0)),
    site_url: r.site_url || null };
}

function validate(patch, current = DEFAULTS) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw err(422, 'invalid', 'Send settings.');
  const next = { ...DEFAULTS, ...current };
  for (const k of FIELDS) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = CLEAN[k](patch[k]);
  if (next.stake > next.stake_cap) bad('stake', 'The stake can’t be more than the stake cap.');
  const changes = {};
  for (const k of FIELDS) {
    if (next[k] !== current[k]) changes[k] = [current[k] === undefined ? null : current[k], next[k]];
  }
  if (current.demo_mode !== false && next.demo_mode === false && patch.confirm_real_money !== true) {
    throw Object.assign(err(409, 'confirm_real_money', REAL_MONEY_WARNING, 'demo_mode'),
      { extra: { warning: REAL_MONEY_WARNING } });
  }
  return { settings: next, changes };
}

// use: { sessionBets, sessionProfit, todayProfit } (profit is negative for a loss).
function guardrails(s, use = {}) {
  const reasons = [];
  const sessionBets = Number(use.sessionBets) || 0;
  const sessionLoss = -Math.min(0, Number(use.sessionProfit) || 0);
  const todayLoss = -Math.min(0, Number(use.todayProfit) || 0);
  if (s.kill_switch) reasons.push({ code: 'kill_switch', message: 'Kill switch is on: no bets.' });
  if (sessionLoss >= s.stop_loss) reasons.push({ code: 'stop_loss', message: 'Session stop-loss reached.' });
  if (todayLoss >= s.daily_loss_limit) {
    reasons.push({ code: 'daily_loss_limit', message: 'Daily loss limit reached.' });
  }
  if (sessionBets >= s.max_bets_per_session) {
    reasons.push({ code: 'max_bets', message: 'Max bets for this session reached.' });
  }
  if (s.stake > s.stake_cap) reasons.push({ code: 'stake_cap', message: 'Stake is above the stake cap.' });
  return { status: reasons.length ? 'stopped' : 'ok', reasons, session_bets: sessionBets,
    session_loss: Math.round(sessionLoss * 100) / 100, today_loss: Math.round(todayLoss * 100) / 100,
    bets_left: Math.max(0, s.max_bets_per_session - sessionBets),
    loss_left_today: Math.max(0, Math.round((s.daily_loss_limit - todayLoss) * 100) / 100) };
}

module.exports = { DEFAULTS, LIMITS, FIELDS, REAL_MONEY_WARNING, validate, guardrails, fromRow, siteUrl };
