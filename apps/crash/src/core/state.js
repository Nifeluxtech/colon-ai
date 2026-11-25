/* Colon JetX · the window.ColonCrash namespace and number formatting shared by every screen. */

var X = window.ColonCrash = {};

function pct(p, digits) { return p == null ? '—' : (p * 100).toFixed(digits == null ? 1 : digits) + '%'; }
function mult(m) { return m == null ? '—' : Number(m).toFixed(2) + 'x'; }
function money(n, currency) {
  var v = Number(n || 0), s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2,
    maximumFractionDigits: 2 });
  return (v < 0 ? '−' : '') + (currency ? currency + ' ' : '') + s;
}
function signed(n, currency) { return (Number(n) > 0 ? '+' : '') + money(n, currency); }
// The browser's offset from UTC in minutes, so "today" on the dashboard is the user's own day.
function tzOffset() { return new Date().getTimezoneOffset(); }

export { X, money, mult, pct, signed, tzOffset };
