/* Colon App core · API client: cookie session, X-Colon-Client header, JSON errors; refreshing the user. */

import { API, state } from './state.js';

/* ---------- API ---------- */
function api(path, opts) {
  opts = opts || {};
  if (opts.raw) {  // streaming callers (SSE) get the Response itself
    var h = { 'X-Colon-Client': state.app || 'web' }; if (opts.body !== undefined) h['Content-Type'] =
      'application/json';
    return fetch(API + path, { method: opts.method || 'GET', credentials: 'include', headers: h, signal: opts.signal,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  }
  var init = { method: opts.method || 'GET', credentials: 'include', headers: { 'X-Colon-Client': state.app
    || 'web' } };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(
    opts.body); }
  return fetch(API + path, init).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (data) {
      if (!r.ok) { var e = new Error(data.message || 'Something went wrong.'); e.status = r.status;
        e.code = data.error; e.field = data.field; throw e; }
      return data;
    });
  }, function () { var e = new Error("Can't reach Colon right now. Check your connection."); e.code = 'offline';
    throw e; });
}

/* ---------- Boot ---------- */
function refreshUser() { return api('/auth/me').then(function (d) { state.user = d.user; return d.user; }); }

export { api, refreshUser };
