/* Colon App core: API client, router with smooth transitions, UI helpers, and the
   shared account screens (sign in, sign up, reset, verify, 2FA, sessions, profile).
   Used by every Colon web app: Colon.start({ app, title, nav, routes, home }). */
(function () {
  'use strict';
  var API = 'https://api.apparatus.name.ng';
  var LANGS = { en: 'English', pcm: 'Naijá (Pidgin)', yo: 'Yorùbá', ha: 'Hausa', ig: 'Igbo' };
  var state = { user: null, config: null, app: null };

  /* ---------- Icons (inline SVG, stroke = currentColor) ---------- */
  var P = {
    flame: '<path d="M12 2c2.5 3.2 4.5 5.6 4.5 9a4.5 4.5 0 0 1-9 0c0-1.6.6-3 1.6-4.2.2 1.3.9 2.2 1.9 2.7C10.6 7.6 11 4.8 12 2z"/><path d="M12 21a7 7 0 0 0 7-7"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
    devices: '<rect x="2" y="5" width="14" height="10" rx="2"/><rect x="17" y="8" width="5" height="11" rx="1.5"/><path d="M6 19h6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3"/>',
    out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    send: '<path d="M5 12l14-7-5 14-2.5-5.5L5 12z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M8 7h7"/>',
    code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>'
  };
  function icon(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || '') + '</svg>'; }
  var MARK = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2c2.6 3.3 4.8 5.8 4.8 9.4A4.8 4.8 0 0 1 12 16.2a4.8 4.8 0 0 1-4.8-4.8c0-1.7.6-3.1 1.7-4.4.2 1.4.9 2.3 2 2.8C10.5 7.6 11 4.7 12 2z"/><rect x="10" y="18.2" width="4" height="3.8" rx="1.9"/></svg>';

  /* ---------- Helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function initials(name, email) { var s = (name || email || '?').trim(); var p = s.split(/\s+/); return ((p[0] || '')[0] + ((p[1] || '')[0] || '')).toUpperCase(); }
  function ago(d) {
    var s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 604800) return Math.floor(s / 86400) + ' d ago';
    return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function device(ua) {
    ua = ua || '';
    var os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown device';
    var br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return br + ' on ' + os;
  }

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', headers: { 'X-Colon-Client': state.app || 'web' } };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.message || 'Something went wrong.'); e.status = r.status; e.code = data.error; e.field = data.field; throw e; }
        return data;
      });
    }, function () { var e = new Error("Can't reach Colon right now. Check your connection."); e.code = 'offline'; throw e; });
  }

  /* ---------- Toast & sheet ---------- */
  function toast(msg, kind) {
    var host = $('.toasts') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }));
    var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.setAttribute('role', 'status'); t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 260); }, 3200);
  }
  function sheet(html, onMount) {
    var back = document.createElement('div'); back.className = 'sheet-back';
    var el = document.createElement('div'); el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.innerHTML = html;
    function close() { back.remove(); el.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('click', close); document.addEventListener('keydown', onKey);
    document.body.appendChild(back); document.body.appendChild(el);
    $$('[data-close]', el).forEach(function (b) { b.addEventListener('click', close); });
    if (onMount) onMount(el, close);
    var f = $('input,button', el); if (f) setTimeout(function () { f.focus(); }, 50);
    return close;
  }

  /* ---------- Forms ---------- */
  function field(o) {
    var id = 'f-' + o.name, type = o.type || 'text';
    var input = type === 'select'
      ? '<select class="select" id="' + id + '" name="' + o.name + '">' + o.options.map(function (op) { return '<option value="' + op[0] + '"' + (op[0] === o.value ? ' selected' : '') + '>' + esc(op[1]) + '</option>'; }).join('') + '</select>'
      : '<input class="input' + (o.cls ? ' ' + o.cls : '') + '" id="' + id + '" name="' + o.name + '" type="' + type + '"' +
        (o.value != null ? ' value="' + esc(o.value) + '"' : '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
        (o.auto ? ' autocomplete="' + o.auto + '"' : '') + (o.mode ? ' inputmode="' + o.mode + '"' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.required === false ? '' : ' required') + '>';
    if (type === 'password') input = '<div class="pw-wrap">' + input + '<button type="button" class="icon-btn" data-pw aria-label="Show password">' + icon('eye') + '</button></div>';
    return '<div class="field" data-field="' + o.name + '"><label for="' + id + '">' + esc(o.label) + '</label>' + input + (o.meter ? '<div class="meter"><i></i></div>' : '') + '<div class="msg"></div></div>';
  }
  function bindForm(form, submit) {
    $$('[data-pw]', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var i = b.previousElementSibling, show = i.type === 'password';
        i.type = show ? 'text' : 'password'; b.innerHTML = icon(show ? 'eyeoff' : 'eye'); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
    $$('.meter', form).forEach(function (m) {
      var i = $('input', m.parentNode);
      i.addEventListener('input', function () {
        var v = i.value, s = 0; if (v.length >= 10) s++; if (v.length >= 14) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
        var bar = $('i', m); bar.style.width = (s * 20) + '%'; bar.style.background = s < 3 ? 'var(--bad)' : s < 4 ? 'var(--warn)' : 'var(--ok)';
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      $$('.field', form).forEach(function (f) { f.classList.remove('err'); $('.msg', f).textContent = ''; });
      var btn = $('button[type=submit]', form), label = btn.innerHTML;
      var data = {}; new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() === v ? v : (k.indexOf('password') > -1 ? v : v.trim()) : v; });
      $$('input[type=checkbox]', form).forEach(function (c) { data[c.name] = c.checked; });
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
      Promise.resolve().then(function () { return submit(data); }).catch(function (err) {
        var f = err.field && $('[data-field="' + err.field + '"]', form);
        if (f) { f.classList.add('err'); $('.msg', f).textContent = err.message; var inp = $('input', f); if (inp) inp.focus(); }
        else toast(err.message, 'bad');
      }).then(function () { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = label; } });
    });
  }

  /* ---------- Router (hash-based, smooth transitions, scroll memory) ---------- */
  var routes = [], scrolls = {}, current = null;
  function parse() {
    var h = location.hash.replace(/^#/, '') || '/';
    var q = h.indexOf('?'), path = q > -1 ? h.slice(0, q) : h;
    return { path: path, query: new URLSearchParams(q > -1 ? h.slice(q + 1) : '') };
  }
  function go(path, replace) {
    if (replace) { history.replaceState(null, '', '#' + path); render(); }
    else location.hash = path;
  }
  function findRoute(path) {
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i].re); if (m) return { r: routes[i], params: m.slice(1) };
    }
    return null;
  }
  function render() {
    var loc = parse(), found = findRoute(loc.path) || findRoute('/');
    var r = found.r;
    if (r.auth === true && !state.user) return go('/login?next=' + encodeURIComponent(loc.path), true);
    if (r.auth === 'guest' && state.user) return go(loc.query.get('next') || '/', true);
    if (r.role && !hasRole(r.role)) return go('/', true);
    if (current) scrolls[current] = window.scrollY;
    current = loc.path;
    var swap = function () {
      var root = $('#app');
      root.innerHTML = r.bare ? '<div class="view">' + '</div>' : shell(r, loc);
      var view = r.bare ? $('.view', root) : $('#view', root);
      document.title = (r.title ? r.title + ' · ' : '') + (state.title || 'Colon AI');
      try { r.render(view, { params: found.params, query: loc.query }); }
      catch (e) { view.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
      window.scrollTo(0, scrolls[loc.path] || 0);
      var h = $('h1, .h1', view); if (h && !r.bare) h.setAttribute('tabindex', '-1');
    };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
    else swap();
  }

  var RANK = { user: 0, moderator: 1, admin: 2, super_admin: 3 };
  function hasRole(role) { return state.user && RANK[state.user.role] >= RANK[role]; }
  function roleName(r) { return { user: 'Member', moderator: 'Moderator', admin: 'Admin', super_admin: 'Super Admin' }[r] || r; }

  function shell(r, loc) {
    var nav = state.nav.filter(function (n) { return !n.role || hasRole(n.role); });
    var active = function (n) { return n.match ? n.match.test(loc.path) : loc.path === n.href; };
    var links = function (cls) { return nav.map(function (n) { return '<a href="#' + n.href + '" class="' + (active(n) ? 'active' : '') + '"' + (active(n) ? ' aria-current="page"' : '') + '>' + icon(n.icon) + '<span>' + esc(n.label) + '</span></a>'; }).join(''); };
    var brand = '<div class="brand"><span class="mark">' + MARK + '</span><span>COLON<small>' + esc(state.subtitle) + '</small></span></div>';
    var back = r.back ? '<a class="icon-btn" href="#' + r.back + '" aria-label="Back">' + icon('back') + '</a>' : '';
    return '<div class="app has-nav">' +
      '<aside class="sidebar">' + brand + '<nav>' + links() + '</nav><div class="foot small muted">Colon AI by Nifelux</div></aside>' +
      '<header class="topbar">' + (back || brand) + '<h1>' + (back ? esc(r.title || '') : '') + '</h1>' + (r.action ? r.action() : '') + '</header>' +
      '<main class="main' + (r.wide ? ' wide' : '') + (r.composer ? ' with-composer' : '') + '"><div id="view" class="view"></div></main>' +
      '<nav class="tabbar" aria-label="Main">' + links() + '</nav></div>';
  }

  /* ---------- Shared account screens ---------- */
  function authPage(view, title, lead, body) {
    view.innerHTML = '<div class="auth"><div class="inner"><div class="brand"><span class="mark">' + MARK + '</span><span>COLON</span></div>' +
      '<h1 class="h1">' + title + '</h1><p class="lead">' + lead + '</p>' + body + '</div>' +
      '<div class="legal">Colon AI by Nifelux · <a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a></div></div>';
  }
  function afterAuth(q) {
    return refreshUser().then(function () { go((q && q.get('next')) || '/', true); });
  }
  function googleButton(view, q, onTotp) {
    var cid = state.config && state.config.google_client_id; if (!cid) return;
    var slot = $('#g-slot', view); if (!slot) return;
    slot.innerHTML = '<div class="divider">or</div><div id="g-btn" style="display:flex;justify-content:center;min-height:44px"></div>';
    var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = function () {
      google.accounts.id.initialize({ client_id: cid, callback: function (resp) {
        api('/auth/google', { method: 'POST', body: { credential: resp.credential } }).then(function (d) {
          if (d.need_totp) return onTotp(function (code) { return api('/auth/google', { method: 'POST', body: { credential: resp.credential, code: code } }); });
          return afterAuth(q);
        }).catch(function (e) { toast(e.message, 'bad'); });
      } });
      google.accounts.id.renderButton($('#g-btn'), { theme: 'filled_black', size: 'large', shape: 'pill', width: Math.min(380, view.clientWidth - 40), text: 'continue_with' });
    };
    document.head.appendChild(s);
  }
  function totpStep(view, q, submitCode) {
    authPage(view, 'Two-step check', 'Enter the 6-digit code from your authenticator app.',
      '<form class="form" novalidate>' + field({ name: 'code', label: 'Authentication code', mode: 'numeric', auto: 'one-time-code', max: 6, cls: 'code-input', placeholder: '••••••' }) +
      '<button class="btn primary block" type="submit">Verify</button></form><p class="alt"><a href="#/login">Use a different account</a></p>');
    bindForm($('form', view), function (d) { return submitCode(d.code).then(function () { return afterAuth(q); }); });
  }

  var authRoutes = [
    { path: '/login', auth: 'guest', bare: true, title: 'Sign in', render: function (view, ctx) {
      authPage(view, 'Welcome back', 'Sign in to continue to ' + esc(state.title) + '.',
        '<form class="form" novalidate>' +
        field({ name: 'email', label: 'Email', type: 'email', auto: 'email', mode: 'email', placeholder: 'you@example.com' }) +
        field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) +
        '<div style="text-align:right;margin-top:-4px"><a class="link small" href="#/forgot">Forgot password?</a></div>' +
        '<button class="btn primary block" type="submit">Sign in</button></form><div id="g-slot"></div>' +
        (state.allowSignup ? '<p class="alt">New to Colon? <a href="#/register' + (ctx.query.get('next') ? '?next=' + encodeURIComponent(ctx.query.get('next')) : '') + '">Create an account</a></p>' : ''));
      var withTotp = function (fn) { totpStep(view, ctx.query, fn); };
      bindForm($('form', view), function (d) {
        return api('/auth/login', { method: 'POST', body: d }).then(function (r) {
          if (r.need_totp) return withTotp(function (code) { return api('/auth/login', { method: 'POST', body: { email: d.email, password: d.password, code: code } }); });
          return afterAuth(ctx.query);
        });
      });
      googleButton(view, ctx.query, withTotp);
    } },
    { path: '/register', auth: 'guest', bare: true, title: 'Create account', render: function (view, ctx) {
      if (!state.allowSignup) return go('/login', true);
      authPage(view, 'Create your account', 'Free to start. Built for Africa.',
        '<form class="form" novalidate>' +
        field({ name: 'name', label: 'Your name', auto: 'name', max: 80, placeholder: 'Ada Okafor' }) +
        field({ name: 'email', label: 'Email', type: 'email', auto: 'email', mode: 'email', placeholder: 'you@example.com' }) +
        field({ name: 'password', label: 'Password', type: 'password', auto: 'new-password', meter: true, placeholder: 'At least 10 characters' }) +
        field({ name: 'language', label: 'Preferred language', type: 'select', value: 'en', options: Object.keys(LANGS).map(function (k) { return [k, LANGS[k]]; }) }) +
        '<div class="field" data-field="accept_terms"><label class="check"><input type="checkbox" name="accept_terms"> <span>I agree to the <a class="link" href="#/terms">Terms</a> and <a class="link" href="#/privacy">Privacy Policy</a>.</span></label><div class="msg"></div></div>' +
        '<button class="btn primary block" type="submit">Create account</button></form><div id="g-slot"></div>' +
        '<p class="alt">Already have an account? <a href="#/login">Sign in</a></p>');
      bindForm($('form', view), function (d) {
        return api('/auth/register', { method: 'POST', body: d }).then(function (r) {
          toast(r.verification_sent ? 'Account created. Check your email to confirm it.' : 'Account created. Welcome to Colon!', 'ok');
          return afterAuth(ctx.query);
        });
      });
      googleButton(view, ctx.query, function (fn) { totpStep(view, ctx.query, fn); });
    } },
    { path: '/forgot', bare: true, title: 'Reset password', render: function (view) {
      authPage(view, 'Reset your password', "Enter your email and we'll send you a reset link.",
        '<form class="form" novalidate>' + field({ name: 'email', label: 'Email', type: 'email', auto: 'email', mode: 'email' }) +
        '<button class="btn primary block" type="submit">Send reset link</button></form><p class="alt"><a href="#/login">Back to sign in</a></p>');
      bindForm($('form', view), function (d) {
        return api('/auth/forgot', { method: 'POST', body: d }).then(function () {
          authPage(view, 'Check your email', 'If an account exists for ' + esc(d.email) + ', a reset link is on its way. It works for 1 hour.', '<a class="btn block" href="#/login">Back to sign in</a>');
        });
      });
    } },
    { path: '/reset', bare: true, title: 'New password', render: function (view, ctx) {
      authPage(view, 'Choose a new password', "You'll be signed out on all devices.",
        '<form class="form" novalidate>' + field({ name: 'password', label: 'New password', type: 'password', auto: 'new-password', meter: true }) +
        '<button class="btn primary block" type="submit">Save password</button></form>');
      bindForm($('form', view), function (d) {
        return api('/auth/reset', { method: 'POST', body: { token: ctx.query.get('token'), password: d.password } }).then(function () {
          toast('Password updated. Please sign in.', 'ok'); state.user = null; go('/login', true);
        });
      });
    } },
    { path: '/verify', bare: true, title: 'Confirm email', render: function (view, ctx) {
      authPage(view, 'Confirming…', 'One moment.', '<div class="skel" style="height:50px"></div>');
      api('/auth/verify-email', { method: 'POST', body: { token: ctx.query.get('token') } }).then(function () {
        return refreshUser().then(function () { authPage(view, 'Email confirmed', 'Thanks! Your account is fully set up.', '<a class="btn primary block" href="#/">Continue</a>'); });
      }).catch(function (e) { authPage(view, 'Link not valid', esc(e.message), '<a class="btn block" href="#/account">Go to account</a>'); });
    } },
    { path: '/terms', bare: true, title: 'Terms', render: function (view) { legal(view, 'Terms of Service', TERMS); } },
    { path: '/privacy', bare: true, title: 'Privacy', render: function (view) { legal(view, 'Privacy Policy', PRIVACY); } },

    { path: '/account', auth: true, title: 'Account', render: accountHome },
    { path: '/account/profile', auth: true, title: 'Profile', back: '/account', render: profilePage },
    { path: '/account/security', auth: true, title: 'Security', back: '/account', render: securityPage },
    { path: '/account/sessions', auth: true, title: 'Devices', back: '/account', render: sessionsPage }
  ];

  var TERMS = '<p><b>Draft, November 2026.</b> These terms will be finalised before public launch (Roadmap Phase 11).</p><p>Colon AI is provided by Nifelux. Use it lawfully and respectfully. Do not use Colon to harm others, break the law, or attack the service. AI answers can be wrong: check important information, especially medical, legal and financial matters.</p><p>You can delete your account at any time from Account → Security.</p>';
  var PRIVACY = '<p><b>Draft, November 2026.</b> This policy will be finalised for NDPR/NDPA compliance before public launch.</p><p>We store your name, email, language choice, sign-in sessions (device and IP) and security logs to run and protect your account. Passwords are stored as one-way hashes. We never sell your data.</p><p>Deleting your account removes your profile and sign-in sessions immediately. Security logs are kept for a limited time to protect the service.</p>';
  function legal(view, title, html) {
    view.innerHTML = '<div class="auth"><div class="inner" style="max-width:640px"><a class="btn ghost sm" href="javascript:history.back()">' + icon('back') + ' Back</a><h1 class="h1" style="text-align:left;margin-top:16px">' + title + '</h1><div class="card" style="color:var(--text-2);line-height:1.7">' + html + '</div></div></div>';
  }

  function verifyBanner() {
    if (!state.user || state.user.email_verified) return '';
    return '<div class="banner">' + icon('mail') + '<span>Confirm your email to secure your account.</span><button class="btn sm" data-resend>Resend</button></div>';
  }
  function bindBanner(view) {
    var b = $('[data-resend]', view); if (!b) return;
    b.addEventListener('click', function () {
      b.disabled = true;
      api('/auth/resend-verification', { method: 'POST' }).then(function (r) { toast(r.sent === false ? 'Email isn’t switched on yet. We’ll confirm you later.' : 'Confirmation email sent.', r.sent === false ? '' : 'ok'); })
        .catch(function (e) { toast(e.message, 'bad'); b.disabled = false; });
    });
  }

  function accountHome(view) {
    var u = state.user;
    view.innerHTML = verifyBanner() +
      '<div class="card" style="display:flex;align-items:center;gap:14px"><div class="avatar" style="width:56px;height:56px;font-size:20px">' + esc(initials(u.name, u.email)) + '</div>' +
      '<div style="min-width:0"><div class="h2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(u.name || 'Your account') + '</div><div class="small muted" style="overflow:hidden;text-overflow:ellipsis">' + esc(u.email) + '</div>' +
      '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="badge flame">' + roleName(u.role) + '</span>' + (u.totp_enabled ? '<span class="badge ok">2FA on</span>' : '') + '</div></div></div>' +
      '<div class="section-title">Settings</div><div class="list">' +
      row('#/account/profile', 'user', 'Profile', 'Name and language: ' + LANGS[u.language]) +
      row('#/account/security', 'shield', 'Security', u.totp_enabled ? 'Two-factor on · Password' : 'Turn on two-factor · Password') +
      row('#/account/sessions', 'devices', 'Devices', 'Where you’re signed in') + '</div>' +
      '<div class="section-title">About</div><div class="list">' + row('#/terms', 'file', 'Terms of Service', '') + row('#/privacy', 'lock', 'Privacy Policy', '') + '</div>' +
      '<div style="margin-top:24px"><button class="btn block" data-logout>' + icon('out') + ' Sign out</button></div>' +
      '<p class="tiny muted" style="text-align:center;margin-top:18px">Colon AI by Nifelux</p>';
    bindBanner(view);
    $('[data-logout]', view).addEventListener('click', function () {
      api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () { state.user = null; go('/login', true); });
    });
  }
  function row(href, ic, title, sub) {
    return '<a class="row" href="' + href + '"><span class="ico">' + icon(ic) + '</span><span class="body"><div class="title">' + esc(title) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</span><span class="chev">' + icon('chev') + '</span></a>';
  }

  function profilePage(view) {
    var u = state.user;
    view.innerHTML = '<h1 class="h1">Profile</h1><p class="lead">How Colon greets you and the language it answers in.</p><form class="form card" novalidate>' +
      field({ name: 'name', label: 'Name', value: u.name, auto: 'name', max: 80 }) +
      field({ name: 'language', label: 'Preferred language', type: 'select', value: u.language, options: Object.keys(LANGS).map(function (k) { return [k, LANGS[k]]; }) }) +
      '<div class="field"><label>Email</label><input class="input" value="' + esc(u.email) + '" disabled></div>' +
      '<button class="btn primary block" type="submit">Save changes</button></form>';
    bindForm($('form', view), function (d) {
      return api('/account/profile', { method: 'PATCH', body: d }).then(function (r) { state.user = r.user; toast('Profile saved.', 'ok'); });
    });
  }

  function securityPage(view) {
    var u = state.user, staff = u.role !== 'user';
    view.innerHTML = '<h1 class="h1">Security</h1><p class="lead">Keep your Colon account safe.</p>' +
      '<div class="section-title">Two-factor authentication</div><div class="card">' +
      '<div style="display:flex;gap:12px;align-items:flex-start"><span class="ico" style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--surface-2);flex:none">' + icon('phone') + '</span>' +
      '<div style="flex:1"><div class="h3">Authenticator app ' + (u.totp_enabled ? '<span class="badge ok">On</span>' : '<span class="badge">Off</span>') + '</div><p class="small muted" style="margin:4px 0 0">' +
      (u.totp_enabled ? 'You’ll enter a code from your app when you sign in.' : 'Add a 6-digit code from Google Authenticator or Authy at sign-in.' + (staff ? ' Required for admin roles.' : '')) + '</p></div></div>' +
      '<div style="margin-top:14px">' + (u.totp_enabled ? (staff ? '<p class="tiny muted">Admin accounts must keep two-factor on.</p>' : '<button class="btn block danger" data-2fa-off>Turn off</button>') : '<button class="btn primary block" data-2fa-on>Set up two-factor</button>') + '</div></div>' +
      (u.has_password ? '<div class="section-title">Password</div><form class="form card" novalidate>' +
        field({ name: 'current_password', label: 'Current password', type: 'password', auto: 'current-password' }) +
        field({ name: 'new_password', label: 'New password', type: 'password', auto: 'new-password', meter: true }) +
        '<button class="btn block" type="submit">Change password</button><p class="tiny muted" style="margin:0">Other devices will be signed out.</p></form>' : '') +
      '<div class="section-title">Danger zone</div><div class="list"><button class="row" data-delete><span class="ico" style="color:var(--bad)">' + icon('trash') + '</span><span class="body"><div class="title" style="color:#ff8a96">Delete account</div><div class="sub">Permanently remove your account</div></span></button></div>';

    var pf = $('form', view);
    if (pf) bindForm(pf, function (d) { return api('/account/password', { method: 'POST', body: d }).then(function () { pf.reset(); toast('Password changed.', 'ok'); }); });

    var on = $('[data-2fa-on]', view);
    if (on) on.addEventListener('click', function () {
      on.disabled = true;
      api('/account/2fa/setup', { method: 'POST' }).then(function (s) {
        on.disabled = false;
        var key = s.secret.replace(/(.{4})/g, '$1 ').trim();
        sheet('<div class="h2">Set up two-factor</div><p class="small muted">1. Open your authenticator app, or tap below if it’s on this phone.</p>' +
          '<a class="btn block" href="' + esc(s.otpauth) + '">' + icon('key') + ' Open authenticator app</a>' +
          '<p class="small muted">Or enter this key manually:</p><div class="card mono" style="display:flex;align-items:center;gap:8px;padding:12px 14px"><span style="flex:1;word-break:break-all">' + esc(key) + '</span><button class="icon-btn" data-copy aria-label="Copy key">' + icon('copy') + '</button></div>' +
          '<p class="small muted">2. Enter the 6-digit code it shows.</p><form class="form" novalidate>' + field({ name: 'code', label: 'Code', mode: 'numeric', auto: 'one-time-code', max: 6, cls: 'code-input', placeholder: '••••••' }) +
          '<button class="btn primary block" type="submit">Turn on</button></form>', function (el, close) {
          $('[data-copy]', el).addEventListener('click', function () { navigator.clipboard && navigator.clipboard.writeText(s.secret).then(function () { toast('Key copied.'); }); });
          bindForm($('form', el), function (d) {
            return api('/account/2fa/enable', { method: 'POST', body: d }).then(function () { close(); toast('Two-factor is on.', 'ok'); return refreshUser().then(function () { securityPage(view); }); });
          });
        });
      }).catch(function (e) { on.disabled = false; toast(e.code === 'app_secret_missing' ? 'Two-factor isn’t available yet. The server needs its security key.' : e.message, 'bad'); });
    });

    var off = $('[data-2fa-off]', view);
    if (off) off.addEventListener('click', function () {
      sheet('<div class="h2">Turn off two-factor?</div><p class="small muted">Your account will be protected by password only.</p><form class="form" novalidate>' +
        (u.has_password ? field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) : '') +
        field({ name: 'code', label: 'Code from your app', mode: 'numeric', auto: 'one-time-code', max: 6, cls: 'code-input' }) +
        '<button class="btn danger block" type="submit">Turn off</button><button class="btn ghost block" type="button" data-close>Cancel</button></form>', function (el, close) {
        bindForm($('form', el), function (d) { return api('/account/2fa/disable', { method: 'POST', body: d }).then(function () { close(); toast('Two-factor is off.'); return refreshUser().then(function () { securityPage(view); }); }); });
      });
    });

    $('[data-delete]', view).addEventListener('click', function () {
      sheet('<div class="h2" style="color:#ff8a96">Delete your account?</div><p class="small muted">This permanently removes your profile and signs you out everywhere. It can’t be undone.</p><form class="form" novalidate>' +
        (u.has_password ? field({ name: 'password', label: 'Password', type: 'password', auto: 'current-password' }) : '') +
        field({ name: 'confirm', label: 'Type DELETE to confirm', auto: 'off', placeholder: 'DELETE' }) +
        '<button class="btn danger block" type="submit">Delete account</button><button class="btn ghost block" type="button" data-close>Cancel</button></form>', function (el, close) {
        bindForm($('form', el), function (d) { return api('/account/delete', { method: 'POST', body: d }).then(function () { close(); state.user = null; toast('Your account was deleted.'); go('/login', true); }); });
      });
    });
  }

  function sessionsPage(view) {
    view.innerHTML = '<h1 class="h1">Devices</h1><p class="lead">Where your account is signed in.</p><div class="list" id="sl"><div style="padding:16px"><div class="skel" style="height:44px"></div><div class="skel" style="height:44px;margin-top:12px"></div></div></div>' +
      '<button class="btn block" style="margin-top:16px" data-others>' + icon('out') + ' Sign out all other devices</button>';
    function load() {
      api('/account/sessions').then(function (d) {
        $('#sl', view).innerHTML = d.sessions.map(function (s) {
          return '<div class="row"><span class="ico">' + icon(/Android|iPhone/.test(s.user_agent) ? 'phone' : 'devices') + '</span><span class="body"><div class="title">' + esc(device(s.user_agent)) + (s.current ? ' <span class="badge ok">This device</span>' : '') + '</div><div class="sub">' + esc(s.ip) + ' · Active ' + ago(s.last_seen_at) + '</div></span>' +
            (s.current ? '' : '<button class="btn sm" data-revoke="' + s.id + '">Sign out</button>') + '</div>';
        }).join('');
        $$('[data-revoke]', view).forEach(function (b) {
          b.addEventListener('click', function () { b.disabled = true; api('/account/sessions/' + b.getAttribute('data-revoke'), { method: 'DELETE' }).then(function () { toast('Device signed out.'); load(); }).catch(function (e) { toast(e.message, 'bad'); b.disabled = false; }); });
        });
      }).catch(function (e) { $('#sl', view).innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    }
    load();
    $('[data-others]', view).addEventListener('click', function (e) {
      var b = e.currentTarget; b.disabled = true;
      api('/account/sessions/revoke-others', { method: 'POST' }).then(function () { toast('Other devices signed out.', 'ok'); load(); }).catch(function (err) { toast(err.message, 'bad'); }).then(function () { b.disabled = false; });
    });
  }

  /* ---------- Boot ---------- */
  function refreshUser() { return api('/auth/me').then(function (d) { state.user = d.user; return d.user; }); }

  function start(opts) {
    state.app = opts.app; state.title = opts.title; state.subtitle = opts.subtitle || ''; state.nav = opts.nav || [];
    state.allowSignup = opts.allowSignup !== false;
    var all = (opts.routes || []).concat(authRoutes);
    routes = all.map(function (r) { return Object.assign({}, r, { re: new RegExp('^' + r.path.replace(/:[a-z]+/g, '([^/]+)') + '$') }); });
    var root = $('#app');
    root.innerHTML = '<div class="auth"><div class="inner" style="text-align:center"><div class="brand"><span class="mark">' + MARK + '</span><span>COLON</span></div><div class="skel" style="height:8px;width:120px;margin:0 auto"></div></div></div>';
    Promise.all([refreshUser().catch(function () { return null; }), api('/auth/config').then(function (c) { state.config = c; }).catch(function () {})]).then(function () {
      window.addEventListener('hashchange', render);
      render();
    });
  }

  window.Colon = { start: start, api: api, icon: icon, esc: esc, $: $, $$: $$, toast: toast, sheet: sheet, field: field, bindForm: bindForm, go: go,
    ago: ago, device: device, initials: initials, roleName: roleName, hasRole: hasRole, LANGS: LANGS, MARK: MARK,
    get user() { return state.user; }, refreshUser: refreshUser, verifyBanner: verifyBanner, bindBanner: bindBanner, row: row };
})();
