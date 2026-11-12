/* Colon App core · shared state: API base, languages, the signed-in user and config, theme, roles. */

// API base. Override for local development with window.COLON_API = 'http://localhost:3000' before this script.
var API = (typeof window !== 'undefined' && window.COLON_API) || 'https://api.apparatus.name.ng';
var LANGS = { en: 'English', pcm: 'Naijá (Pidgin)', yo: 'Yorùbá', ha: 'Hausa', ig: 'Igbo' };
var state = { user: null, config: null, app: null, mounted: null, online: false };

/* ---------- Theme (dark default · light · system), applied before first paint ---------- */
var theme = (function () {
  var KEY = 'colon.theme', mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null, subs = [];
  function pref() { try { return localStorage.getItem(KEY) || 'dark'; } catch (e) { return 'dark'; } }
  function resolved(p) { p = p || pref(); return p === 'system' ? (mq && mq.matches ? 'light' : 'dark') : p; }
  function apply() {
    var t = resolved(); document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light'
      ? '#FFFFFF' : '#080F24');
    subs.forEach(function (f) { f(t); });
  }
  function set(p) { try { localStorage.setItem(KEY, p); } catch (e) {} apply(); }
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (pref() === 'system') apply(); });
  apply();
  return { get: pref, current: function () { return resolved(); }, set: set, toggle: function () { set(resolved(
    ) === 'dark' ? 'light' : 'dark'); }, on: function (f) { subs.push(f); } };
})();

var RANK = { user: 0, moderator: 1, admin: 2, super_admin: 3 };
function hasRole(role) { return state.user && RANK[state.user.role] >= RANK[role]; }
function roleName(r) { return { user: 'Member', moderator: 'Moderator', admin: 'Admin', super_admin: 'Super Admin' }[r]
  || r; }

export { API, LANGS, hasRole, roleName, state, theme };
