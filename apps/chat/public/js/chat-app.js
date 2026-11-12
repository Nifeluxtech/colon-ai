/* Colon AI · workspace: layout, sidebar, header, welcome, conversation thread, streaming,
   composer, modes, model selector and the integrated browser panel (embedded / split).
   Data only through ColonChatData (chat-data.js); browser only through ColonBrowser. */
(function () {
  'use strict';
  var C = window.Colon, icon = C.icon, esc = C.esc, MD = window.ColonMarkdown;
  var data = null;  // picked in mount(): your account, a guest chat, or the offline Preview (chat-data.js)

  var MODES = {
    general: { label: 'General', sub: 'General Assistant', icon: 'sparkle', hint: 'Ask Colon anything…' },
    study: { label: 'Study', sub: 'Study Mode', icon: 'book', hint: 'Ask a study question…' },
    developer: { label: 'Developer', sub: 'Developer Mode', icon: 'code', hint: 'Describe code or paste an error…' },
    research: { label: 'Research', sub: 'Research Mode', icon: 'search', hint: 'What should I research? I’ll search the web…' }
  };
  var PROMPTS = [
    { icon: 'cap', title: 'Learn something new', text: 'Help me understand a difficult topic', prompt: 'Help me understand photosynthesis step by step', mode: 'study' },
    { icon: 'code', title: 'Build a website', text: 'Build a website with me', prompt: 'Build a website with me for my small food business in Lagos', mode: 'developer' },
    { icon: 'search', title: 'Research a topic', text: 'Research an important subject', prompt: 'Research the history of Lagos and its economy', mode: 'research' },
    { icon: 'bulb', title: 'Get help with code', text: 'Debug, explain or write code', prompt: 'Help me fix a bug in my Node.js code', mode: 'developer' }
  ];
  var CAPS = { text: 'Text', reasoning: 'Reasoning', code: 'Code', vision: 'Images', web: 'Web', citations: 'Citations', voice: 'Voice' };

  var S = {
    el: null, models: [], settings: null, convs: [], q: '', current: null, messages: [], streaming: null, loadingConv: false,
    draftMode: 'general', draftModel: null, view: 'chat', collapsed: false, drawer: false,
    browser: { inst: null, layout: 'none', collapsed: false, full: false, mtab: 'chat', width: 0 }, media: null, speaking: null,
    stick: true, lastTop: 0, userInput: 0, seen: {}, ro: null
  };
  var CW = window.CW = window.CW || {};
  CW.S = S; CW.MODES = MODES;

  function isMobile() { return innerWidth < 900; }
  // Phase 4: brand name, announcement banner and maintenance notice come from the Admin Dashboard (GET /auth/config).
  function brandName() { return String((C.config && C.config.brand_name) || 'Colon AI').toUpperCase(); }
  function noticeBanner() {
    var cfg = C.config || {}, out = '';
    if (cfg.maintenance && cfg.maintenance.on) out += '<div class="banner bad cw-notice" role="status">' + icon('alert') + '<span>' + esc(cfg.maintenance.message) + '</span></div>';
    var a = cfg.announcement;
    if (a && a.text) {
      var key = 'colon.banner.' + a.text.length + '.' + a.text.slice(0, 24);
      var hidden = false; try { hidden = sessionStorage.getItem(key) === '1'; } catch (e) {}
      if (!hidden) out += '<div class="banner ' + (a.tone === 'warn' ? '' : 'info') + ' cw-notice" role="status" data-banner="' + esc(key) + '">' + icon(a.tone === 'warn' ? 'alert' : 'bell') + '<span>' + esc(a.text) + '</span><button type="button" class="icon-btn sm" data-banner-x aria-label="Hide announcement">' + icon('x') + '</button></div>';
    }
    return out;
  }
  function bindNotice(root) {
    var b = root.querySelector('[data-banner-x]'); if (!b) return;
    b.addEventListener('click', function () { var box = b.closest('[data-banner]'); try { sessionStorage.setItem(box.getAttribute('data-banner'), '1'); } catch (e) {} box.remove(); });
  }
  // Signed out: chat works, nothing is saved (guest adapter), and Log in / Sign up replace the account menu.
  function signedIn() { return !!C.user; }
  function ephemeral() { return data && data.kind === 'guest'; }
  function login(mode) { if (typeof C.authModal === 'function') C.authModal({ mode: mode || 'login', lead: mode === 'signup' ? 'Save your chats, upload images and pick up on any device.' : 'Log in to save your chats and pick up on any device.' }); else C.go(mode === 'signup' ? '/register' : '/login'); }
  CW.login = login;
  function $(s) { return S.el.querySelector(s); }
  function mode() { return S.current ? S.current.mode : S.draftMode; }
  function modelId() { return (S.current && S.current.model) || S.draftModel || defaultModel(); }
  function defaultModel() { var d = S.models.filter(function (m) { return m.default; })[0] || S.models.filter(function (m) { return m.available; })[0]; return d ? d.id : null; }
  function modelName(id) { var m = S.models.filter(function (x) { return x.id === id; })[0]; return m ? m.name : 'Colon Saga'; }

  /* ================= Mount ================= */
  function mount(view, ctx) {
    // Optional kit helpers are feature-checked: an older cached kit must never crash the app.
    if (typeof C.keyboard === 'function') C.keyboard();
    data = CW.data = window.ColonChatData.get();
    document.documentElement.classList.add('app-lock');
    view.innerHTML =
      '<a class="skip-link" href="#cw-input">Skip to message box</a>' +
      '<div class="cw" data-layout="none" data-view="chat">' +
      '<aside class="cw-side" id="cw-side" aria-label="Conversations">' +
        '<div class="cw-side-top"><a href="#/" class="cw-logo" aria-label="Colon AI home">' + C.logo(brandName(), 'by Nifelux') + '</a>' +
        '<button class="icon-btn sm cw-side-close" data-a="drawer-close" aria-label="Close menu">' + icon('x') + '</button></div>' +
        '<button class="btn primary block cw-new" data-a="new">' + icon('plus') + 'New Chat</button>' +
        '<label class="cw-search">' + icon('search') + '<input type="search" placeholder="Search chats…" aria-label="Search conversations" id="cw-q"><span class="kbd cw-hide-touch">Ctrl K</span></label>' +
        '<nav class="nav-list cw-nav" aria-label="Main">' +
          navLink('/', 'home', 'Home') + navLink('/explore', 'explore', 'Explore') +
          (ephemeral() ? '' : navLink('/saved', 'saved', 'Saved') + navLink('/history', 'history', 'History')) +
          (signedIn() ? navLink('/settings', 'settings', 'Settings') : '') + navLink('/help', 'help', 'Help & Support') + '</nav>' +
        '<div class="cw-convs scroll-y" id="cw-convs" aria-label="Recent conversations"></div>' +
        (signedIn()
          ? '<button class="cw-account" data-a="profile" aria-haspopup="menu"><span class="avatar sm" data-avatar></span><span class="cw-account-body"><b data-uname></b><small data-urole></small></span><span class="status-dot" title="Online"></span></button>'
          : '<div class="cw-auth-btns"><button type="button" class="btn primary sm" data-a="login">Log in</button><button type="button" class="btn sm" data-a="signup">Sign up</button></div>') +
      '</aside>' +
      '<div class="cw-main">' +
        '<header class="cw-head">' +
          '<button class="icon-btn" data-a="sidebar" aria-label="Toggle sidebar" aria-controls="cw-side" data-tip="Sidebar">' + icon('sidebar') + '</button>' +
          '<a href="#/" class="cw-head-logo" aria-label="Colon AI home">' + C.logo(brandName(), false) + '</a>' +
          '<button class="cw-model" data-a="model" aria-haspopup="menu" aria-label="Choose model"><span class="cw-model-mark">' + C.MARK + '</span><span class="cw-model-t"><b data-model-name>Colon Saga</b><small data-mode-sub>General Assistant</small></span>' + icon('chevDown') + '</button>' +
          '<button class="cw-title" data-a="rename-current" aria-label="Rename conversation" data-tip="Rename"><span data-title></span>' + icon('edit') + '</button>' +
          '<span class="cw-head-sp"></span>' +
          '<button class="icon-btn" data-a="new" aria-label="New chat" data-tip="New chat (Ctrl Shift O)">' + icon('plus') + '</button>' +
          '<button class="icon-btn cw-hide-xs" data-a="browser" aria-label="Open browser panel" aria-pressed="false" data-tip="Browser">' + icon('globe') + '<span class="dot" hidden></span></button>' +
          '<button class="cw-theme cw-hide-xs" data-a="theme" aria-label="Toggle light or dark theme" data-tip="Theme"><span class="cw-theme-sun">' + icon('sun') + '</span><span class="cw-theme-track"><i></i></span></button>' +
          '<button class="icon-btn cw-show-xs" data-a="more" aria-label="More options" aria-haspopup="menu">' + icon('moreV') + '</button>' +
          (signedIn() ? '<button class="cw-avatar-btn cw-hide-xs" data-a="profile" aria-haspopup="menu" aria-label="Profile menu"><span class="avatar sm" data-avatar></span></button>'
            : '<span class="cw-head-auth"><button type="button" class="btn primary sm" data-a="login">Log in</button><button type="button" class="btn sm cw-hide-xs" data-a="signup">Sign up</button></span>') +
        '</header>' +
        '<div class="cw-mswitch seg block" role="tablist" aria-label="Chat or browser"><button type="button" data-a="mtab" data-t="chat" aria-pressed="true">' + icon('chat') + 'Chat</button><button type="button" data-a="mtab" data-t="browser" aria-pressed="false">' + icon('globe') + 'Browser</button></div>' +
        '<div class="cw-body">' +
          '<section class="cw-chat" aria-label="Conversation">' +
            '<div class="cw-scroll scroll-y" id="cw-scroll"><div class="cw-page" id="cw-page"></div><div class="cw-embed-host"></div></div>' +
            composerHtml() +
          '</section>' +
          '<div class="resizer cw-resizer" aria-label="Resize browser panel"></div>' +
          '<section class="cw-split" aria-label="Browser panel"><div class="cw-split-head"><span class="status-dot" data-bdot></span><b>Colon Browser</b><span class="tiny muted cw-ellipsis" data-burl></span>' +
            '<button class="icon-btn sm" data-a="layout-embed" aria-label="Show inside the conversation" data-tip="Embed in chat">' + icon('panel') + '</button>' +
            '<button class="icon-btn sm" data-a="browser-close" aria-label="Close browser" data-tip="Close">' + icon('x') + '</button></div><div class="cw-split-body"></div></section>' +
        '</div>' +
      '</div>' +
      '<div class="cw-drawer-back" data-a="drawer-close"></div></div>';
    S.el = view.querySelector('.cw');
    fillUser();
    bind();
    S.media = window.ChatMedia.create({
      data: data, tray: $('.att-tray'), voiceBar: $('.cv-voice'), getSettings: function () { return S.settings || {}; },
      onChange: syncComposer, onVoiceState: function (on) { $('[data-a=mic]').classList.toggle('rec', on); $('[data-a=mic]').setAttribute('aria-pressed', on); },
      onTranscript: function (text, final) {
        var ta = $('#cw-input');
        if (final === 'cancel') { ta.value = ta.dataset.before || ''; autoGrow(); return; }
        if (ta.dataset.before === undefined) ta.dataset.before = ta.value ? ta.value + ' ' : '';
        ta.value = ta.dataset.before + text; autoGrow(); syncComposer();
        if (final === true) { delete ta.dataset.before; if (S.settings.voice.autoSend && text) send(); else ta.focus(); }
      }
    });
    S.collapsed = localStorage.getItem('colon.sidebar') === 'closed';
    applySidebar();
    Promise.all([
      data.getSettings().then(function (s) { S.settings = s; S.draftMode = s.defaultMode || 'general'; applyTextSize(); }),
      data.listModels().then(function (m) { S.models = m; }).catch(function () { S.models = []; C.toast('Couldn’t load the model list. Using Colon Saga.', 'bad'); })
    ]).then(function () { refreshConvs(); route(ctx); });
    return function unmount() {
      if (S.streaming) S.streaming.ctl.abort(); if (S.media) S.media.destroy(); document.removeEventListener('keydown', onKey);
      if (S.ro) S.ro.disconnect(); document.documentElement.classList.remove('app-lock');
    };
  }
  function navLink(href, ic, label) { return '<a href="#' + href + '" data-nav="' + href + '">' + icon(ic) + '<span>' + label + '</span></a>'; }
  function composerHtml() {
    // Floating composer: a pill that hovers above the bottom edge; the thread scrolls underneath it.
    return '<div class="cw-composer"><button type="button" class="cw-jump btn sm" data-a="jump" hidden aria-label="Jump to latest message">' + icon('chevDown') + 'Latest</button><div class="cw-composer-in">' +
      '<div class="att-tray" hidden aria-label="Attachments"></div>' +
      '<div class="cv-voice" hidden></div>' +
      '<form class="cw-input" id="cw-form" novalidate>' +
        '<button type="button" class="icon-btn" data-a="attach" aria-label="Attach files" data-tip="Attach files">' + icon('clip') + '</button>' +
        '<button type="button" class="cw-mode-btn" data-a="mode-menu" aria-haspopup="menu" aria-label="Mode: General" data-tip="Mode"></button>' +
        '<textarea id="cw-input" rows="1" maxlength="16000" enterkeyhint="send" aria-label="Message Colon" placeholder="Ask Colon anything…"></textarea>' +
        '<button type="button" class="icon-btn" data-a="mic" aria-label="Voice input" aria-pressed="false" data-tip="Voice input">' + icon('mic') + '</button>' +
        '<button type="submit" class="cw-send" data-a="send" aria-label="Send message" disabled>' + icon('send') + '</button>' +
      '</form>' +
      '<div class="cw-pills" aria-label="Quick actions"><button type="button" class="chip sm" data-a="attach">' + icon('clip') + 'Attach File</button><button type="button" class="chip sm" data-a="mic">' + icon('mic') + 'Voice Input</button><button type="button" class="chip sm" data-a="browse-web">' + icon('globe') + 'Browse the Web</button></div>' +
      '<p class="cw-disclaimer">' + disclaimer() + '</p>' +
      '</div></div>';
  }
  function disclaimer() {
    if (data.kind === 'local') return '<span class="badge cyan" data-tip="' + esc(data.describe) + '">' + icon('info') + 'Preview</span><span>Can’t reach Colon right now, so replies are generated on this device.</span>';
    if (data.kind === 'guest') return '<span class="badge cyan" data-tip="' + esc(data.describe) + '">' + icon('info') + 'Not saved</span><span>Colon Saga can make mistakes. <button type="button" class="link cw-inline-link" data-a="login">Log in</button> to save your chats.</span>';
    return '<span class="badge cyan" data-tip="' + esc(data.describe) + '">' + icon('info') + 'Synced</span><span>Colon Saga can make mistakes. Check important information.</span>';
  }
  function fillUser() {
    var u = C.user || {};
    S.el.querySelectorAll('[data-avatar]').forEach(function (a) { a.textContent = C.initials(u.name, u.email); });
    var n = $('[data-uname]'), r = $('[data-urole]');
    if (n) n.textContent = u.name || 'Your account';
    if (r) r.textContent = C.roleName(u.role || 'user') + (u.email_verified ? '' : ' · unverified');
  }

  /* ================= Routing inside the workspace ================= */
  // Called as route(ctx) internally and as update(view, ctx) by the Colon router.
  function route(a, b) {
    var ctx = (b && b.path !== undefined) ? b : a;
    if (!S.settings || !ctx) return;
    var p = ctx.path || '/';
    closeDrawer();
    S.el.querySelectorAll('[data-nav]').forEach(function (a) { var on = a.getAttribute('data-nav') === (p.indexOf('/c/') === 0 ? '/' : p); a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    var m = /^\/c\/([^/]+)$/.exec(p);
    if (m) return openConversation(decodeURIComponent(m[1]));
    var sh = /^\/share\/([^/]+)$/.exec(p);
    if (sh) return showShared(decodeURIComponent(sh[1]));
    var pages = { '/history': 'history', '/saved': 'saved', '/explore': 'explore', '/settings': 'settings', '/help': 'help' };
    if (pages[p] && ((ephemeral() && (p === '/history' || p === '/saved')) || (!signedIn() && p === '/settings'))) return showPage('login', ctx);
    if (pages[p]) return showPage(pages[p], ctx);
    newChat(true);
  }
  CW.route = route;

  function setView(v) {
    S.view = v; S.el.setAttribute('data-view', v);
    S.stick = true; syncJump();
    $('.cw-composer').hidden = v !== 'chat' && v !== 'welcome';  // pages and shared chats have no composer
    $('.cw-embed-host').hidden = v !== 'chat';
    if (v !== 'chat' && v !== 'welcome' && S.browser.layout === 'split' && isMobile()) setMobileTab('chat');
  }
  function showPage(name, ctx) {
    if (S.streaming) { /* keep streaming in background */ }
    S.current = null; S.messages = []; setView(name);
    var page = $('#cw-page'); page.className = 'cw-page cw-page-' + name;
    updateHeader();
    var fn = CW.pages && CW.pages[name];
    if (fn) fn(page, ctx); else page.innerHTML = '<div class="empty">Page not found.</div>';
    $('#cw-scroll').scrollTop = 0;
    renderConvs();
  }

  function newChat(fromRoute) {
    if (S.streaming) stopStreaming();
    S.current = null; S.messages = []; S.draftModel = null;
    S.draftMode = (S.settings && S.settings.defaultMode) || 'general';
    setView('welcome');
    if (!fromRoute && location.hash !== '#/' && location.hash !== '') { C.go('/'); return; }
    renderWelcome(); updateHeader(); syncComposer(); renderConvs();
    if (!isMobile()) setTimeout(function () { $('#cw-input').focus(); }, 30);
  }

  function openConversation(id) {
    setView('chat');
    if (S.current && S.current.id === id && S.messages) { renderThread(); updateHeader(); syncComposer(); renderConvs(); return; }
    if (S.streaming) stopStreaming();
    S.loadingConv = true; S.current = { id: id, title: 'Loading…', mode: S.draftMode };
    updateHeader();
    $('#cw-page').className = 'cw-page'; $('#cw-page').innerHTML = '<div class="cw-thread">' + [1, 2, 3].map(function (i) { return '<div class="cw-skel ' + (i % 2 ? 'u' : 'a') + '"><div class="skel" style="height:' + (i % 2 ? 44 : 96) + 'px"></div></div>'; }).join('') + '</div>';
    data.getConversation(id).then(function (r) {
      if (!S.current || S.current.id !== id) return;
      S.current = r.conversation; S.messages = r.messages; S.loadingConv = false;
      S.messages.forEach(function (m) { S.seen[m.id] = 1; });  // history appears without replaying entry animations
      renderThread(); updateHeader(); syncComposer(); renderConvs(); scrollBottom(true);
    }).catch(function (e) {
      S.loadingConv = false;
      $('#cw-page').innerHTML = '<div class="empty cw-error-page">' + icon(e.code === 'not_found' ? 'search' : 'alert') + '<div class="h3">' + (e.code === 'not_found' ? 'Conversation not found' : 'Couldn’t open this conversation') + '</div><p class="small">' + esc(e.message) + '</p>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' + (e.code === 'not_found' ? '' : '<button class="btn" data-a="retry-open">' + icon('refresh') + 'Try again</button>') + '<a class="btn primary" href="#/">' + icon('plus') + 'New chat</a></div></div>';
      var b = $('[data-a=retry-open]'); if (b) b.addEventListener('click', function () { S.current = null; openConversation(id); });
      S.current = null; updateHeader();
    });
  }
  CW.open = function (id) { C.go('/c/' + encodeURIComponent(id)); };

  /* ================= Header ================= */
  function updateHeader() {
    var m = mode(), inChat = S.view === 'chat';
    $('[data-model-name]').textContent = modelName(modelId());
    $('[data-mode-sub]').textContent = MODES[m].sub;
    var t = $('.cw-title'); t.hidden = !inChat || !S.current;
    $('[data-title]').textContent = S.current ? S.current.title : '';
    var titles = { welcome: 'New chat', history: 'History', saved: 'Saved', explore: 'Explore', settings: 'Settings', help: 'Help & Support', login: 'Log in', shared: 'Shared chat' };
    document.title = (inChat && S.current ? S.current.title : titles[S.view] || 'Colon AI') + ' · Colon AI';
    var mb = $('.cw-mode-btn');
    mb.classList.toggle('on', m !== 'general'); mb.setAttribute('aria-label', 'Mode: ' + MODES[m].label + '. Change mode');
    mb.innerHTML = icon(MODES[m].icon) + '<span class="cw-mode-l">' + MODES[m].label + '</span>' + icon('chevDown');
    $('#cw-input').placeholder = MODES[m].hint;
    renderModeChips(); if (S.view === 'welcome' || S.view === 'chat') autoGrow();
  }
  function renderModeChips() {
    var m = mode(), box = $('.cw-welcome-modes');
    if (!box) return;  // the chips live on the welcome screen; in a chat the mode button in the pill takes over
    box.innerHTML = ['study', 'developer', 'research'].map(function (k) {
      return '<button type="button" class="chip" role="radio" aria-checked="' + (m === k) + '" data-mode="' + k + '">' + icon(MODES[k].icon) + MODES[k].label + '</button>';
    }).join('');
  }
  function setMode(k) {
    var next = mode() === k ? 'general' : k;
    if (S.current && !S.loadingConv) {
      var prev = S.current.mode; S.current.mode = next; updateHeader();
      data.updateConversation(S.current.id, { mode: next }).then(function (c) {
        S.current = Object.assign(S.current, c);
        if (S.messages.length) { S.messages.push({ id: C.uid('e'), role: 'event', content: 'Switched to ' + next + ' mode', created_at: new Date().toISOString() }); renderThread(); scrollBottom(); }
        refreshConvs();
      }).catch(function (e) { S.current.mode = prev; updateHeader(); C.toast(e.message, 'bad'); });
    } else { S.draftMode = next; updateHeader(); }
    C.toast(next === 'general' ? 'General mode' : MODES[next].label + ' mode on. Your chat history stays.');
  }

  function setModeTo(k) { if (mode() !== k) setMode(k); }
  function modeMenu(anchor) {
    var m = mode();
    C.menu(anchor, [{ head: 'Mode' }].concat(['general', 'study', 'developer', 'research'].map(function (k) {
      return { label: MODES[k].label, sub: MODES[k].sub, icon: MODES[k].icon, checked: m === k, onClick: function () { setModeTo(k); } };
    })).concat(['-', { label: 'Browse the Web', sub: 'Let Saga browse for you', icon: 'globe', onClick: function () { S.el.querySelector('.cw-pills [data-a=browse-web]').click(); } }]), { label: 'Mode', sheetOnMobile: true });
  }
  function modelMenu(anchor) {
    if (!S.models.length) { C.toast('No models are configured yet.', 'bad'); return; }
    var cur = modelId();
    C.menu(anchor, [{ head: 'Choose a model' }].concat(S.models.map(function (m) {
      return {
        label: m.name, sub: m.description + (m.capabilities && m.capabilities.length ? ' · ' + m.capabilities.map(function (c) { return CAPS[c] || c; }).join(', ') : ''),
        checked: m.id === cur, disabled: !m.available,
        badge: '<span class="badge ' + (m.available ? 'ok' : '') + '" style="margin-left:6px">' + (m.available ? 'Available' : m.status === 'coming_soon' ? 'Coming soon' : 'Unavailable') + '</span>',
        onClick: function () {
          if (S.current) data.updateConversation(S.current.id, { model: m.id }).then(function (c) { S.current = Object.assign(S.current, c); updateHeader(); C.toast('Using ' + m.name + '.'); });
          else { S.draftModel = m.id; updateHeader(); C.toast('Using ' + m.name + '.'); }
        }
      };
    })), { label: 'Models', sheetOnMobile: true });
  }

  /* ================= Sidebar ================= */
  var refreshConvs = C.debounce(function () {
    data.listConversations({ q: S.q }).then(function (list) { S.convs = list; renderConvs(); })
      .catch(function (e) { $('#cw-convs').innerHTML = '<div class="cw-convs-msg">' + esc(e.message) + ' <button class="link" data-a="retry-convs" style="background:none;border:0">Retry</button></div>'; });
  }, 120);
  CW.refreshConvs = refreshConvs;
  function renderConvs() {
    var box = $('#cw-convs'); if (!box) return;
    if (ephemeral()) {
      box.innerHTML = '<div class="cw-guest-card"><b>Log in to save your chats</b><span>Your conversations will be saved to your account, so you can pick them up on any device.</span>' +
        '<div class="cw-guest-btns"><button type="button" class="btn primary sm" data-a="login">Log in</button><button type="button" class="btn sm" data-a="signup">Sign up</button></div></div>';
      return;
    }
    if (!S.convs) { box.innerHTML = '<div class="skel" style="height:36px;margin:6px"></div>'; return; }
    var cur = S.current && S.current.id;
    function item(c) {
      return '<div class="cw-conv' + (c.id === cur ? ' on' : '') + '"><a href="#/c/' + encodeURIComponent(c.id) + '"' + (c.id === cur ? ' aria-current="page"' : '') + '><span class="cw-conv-t">' + (c.pinned ? icon('pin', 'cw-pin') : '') + esc(c.title) + '</span>' +
        '<span class="cw-conv-m">' + esc(MODES[c.mode] ? MODES[c.mode].label : '') + ' · ' + esc(C.ago(c.updated_at)) + (c.temporary ? ' · temporary' : '') + '</span></a>' +
        '<button class="icon-btn sm cw-conv-more" data-conv-menu="' + esc(c.id) + '" aria-label="Options for ' + esc(c.title) + '" aria-haspopup="menu">' + icon('more') + '</button></div>';
    }
    if (S.q) {
      box.innerHTML = '<div class="cw-convs-h">Results</div>' + (S.convs.length ? S.convs.map(item).join('') : '<div class="cw-convs-msg">No chats match “' + esc(S.q) + '”.</div>');
      return;
    }
    var pinned = S.convs.filter(function (c) { return c.pinned; }), recent = S.convs.filter(function (c) { return !c.pinned; }).slice(0, 30);
    box.innerHTML = (pinned.length ? '<div class="cw-convs-h">' + icon('saved') + 'Saved</div>' + pinned.map(item).join('') : '') +
      '<div class="cw-convs-h">' + icon('clock') + 'Recent</div>' + (recent.length ? recent.map(item).join('') : '<div class="cw-convs-msg">' + (S.convs.length ? 'All your chats are saved above.' : 'Your conversations will appear here.') + '</div>') +
      (!signedIn() && data.kind === 'local' ? '<div class="cw-convs-msg">Saved on this device only. <button type="button" class="link cw-inline-link" data-a="login">Log in</button> to sync.</div>' : '') +
      (S.convs.length > 30 + pinned.length ? '<a class="cw-convs-all" href="#/history">See all history</a>' : '');
  }
  CW.convMenu = function (anchor, c, after) {
    var canShare = data.kind === 'remote' && !c.temporary;
    C.menu(anchor, [
      { label: 'Rename', icon: 'edit', onClick: function () { renameConv(c, after); } }].concat(canShare ? [
      { label: c.shared ? 'Copy share link' : 'Share link', icon: 'link', onClick: function () { shareConv(c, after); } }] : []).concat([
      { label: c.pinned ? 'Remove from Saved' : 'Save (pin)', icon: 'pin', onClick: function () { patchConv(c, { pinned: !c.pinned }, c.pinned ? 'Removed from Saved.' : 'Saved.', after); } },
      { label: c.archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: function () { patchConv(c, { archived: !c.archived }, c.archived ? 'Moved back to Recent.' : 'Archived. Find it in History.', after); } },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, onClick: function () { deleteConv(c, after); } }
    ]), { align: 'right', label: 'Conversation options' });
  };
  // Share link: anyone with it can read the chat (not your files). Copied straight away; can be turned off.
  function shareConv(c, after) {
    data.share(c.id).then(function (sh) {
      c.shared = true; if (S.current && S.current.id === c.id) S.current.shared = true;
      var stop = { label: 'Stop sharing', fn: function () { data.unshare(c.id).then(function () { c.shared = false; C.toast('Sharing turned off. The old link no longer works.'); refreshConvs(); }).catch(function (e) { C.toast(e.message, 'bad'); }); } };
      C.copyText(sh.url).then(function () { C.toast('Share link copied. Anyone with it can read this chat.', 'ok', stop); }, function () {
        C.prompt({ title: 'Share link', label: 'Copy this link', value: sh.url, confirm: 'Done', max: 300 });
      });
      refreshConvs(); if (after) after();
    }).catch(function (e) { C.toast(e.message, 'bad'); });
  }
  CW.shareConv = shareConv;
  function patchConv(c, patch, msg, after) {
    data.updateConversation(c.id, patch).then(function (n) {
      if (S.current && S.current.id === c.id) { S.current = Object.assign(S.current, n); updateHeader(); if (patch.archived) C.go('/'); }
      C.toast(msg, 'ok'); refreshConvs(); if (after) after();
    }).catch(function (e) { C.toast(e.message, 'bad'); });
  }
  function renameConv(c, after) {
    C.prompt({ title: 'Rename conversation', label: 'Title', value: c.title, max: 80 }).then(function (v) { if (v && v !== c.title) patchConv(c, { title: v }, 'Renamed.', after); });
  }
  function deleteConv(c, after) {
    C.confirm({ title: 'Delete this conversation?', body: '“' + c.title + '” and its messages will be permanently deleted. This can’t be undone.', confirm: 'Delete', danger: true }).then(function (ok) {
      if (!ok) return;
      data.deleteConversation(c.id).then(function () {
        C.toast('Conversation deleted.'); refreshConvs(); if (after) after();
        if (S.current && S.current.id === c.id) { S.current = null; C.go('/'); }
      }).catch(function (e) { C.toast(e.message, 'bad'); });
    });
  }
  function applySidebar() {
    S.el.classList.toggle('side-collapsed', S.collapsed && !isMobile());
    var side = $('#cw-side');
    if (isMobile()) { if (!S.drawer) side.setAttribute('inert', ''); } else side.removeAttribute('inert');
  }
  function openDrawer() { S.drawer = true; S.el.classList.add('drawer-open'); document.querySelector('.cw-drawer-back').classList.add('open'); $('#cw-side').removeAttribute('inert'); setTimeout(function () { var f = $('#cw-side .cw-new'); if (f) f.focus(); }, 60); }
  function closeDrawer() { if (!S.drawer) return; S.drawer = false; S.el.classList.remove('drawer-open'); var b = document.querySelector('.cw-drawer-back'); if (b) b.classList.remove('open'); if (isMobile()) $('#cw-side').setAttribute('inert', ''); }
  function toggleSidebar() {
    if (isMobile()) { S.drawer ? closeDrawer() : openDrawer(); return; }
    S.collapsed = !S.collapsed; localStorage.setItem('colon.sidebar', S.collapsed ? 'closed' : 'open'); applySidebar();
  }

  function profileMenu(anchor) {
    var u = C.user || {};
    C.menu(anchor, [
      { html: '<div class="cw-menu-user"><span class="avatar">' + esc(C.initials(u.name, u.email)) + '</span><span><b>' + esc(u.name || 'Your account') + '</b><small>' + esc(u.email || '') + '</small></span></div>' }, '-',
      { label: 'Settings', icon: 'settings', onClick: function () { C.go('/settings'); } },
      { label: 'Account & security', icon: 'shield', onClick: function () { C.go('/account'); } },
      { label: C.theme.current() === 'dark' ? 'Light mode' : 'Dark mode', icon: C.theme.current() === 'dark' ? 'sun' : 'moon', onClick: toggleTheme },
      { label: 'Help & Support', icon: 'help', onClick: function () { C.go('/help'); } }, '-',
      { label: 'Sign out', icon: 'out', danger: true, onClick: signOut }
    ], { align: 'right', label: 'Profile' });
  }
  function moreMenu(anchor) {
    if (!signedIn()) {
      C.menu(anchor, [
        { label: 'Log in', icon: 'user', onClick: function () { login('login'); } },
        { label: 'Sign up', icon: 'sparkle', onClick: function () { login('signup'); } }, '-',
        { label: S.browser.layout === 'none' ? 'Open browser' : 'Close browser', icon: 'globe', onClick: function () { S.browser.layout === 'none' ? openBrowser() : setLayout('none'); } },
        { label: C.theme.current() === 'dark' ? 'Light mode' : 'Dark mode', icon: C.theme.current() === 'dark' ? 'sun' : 'moon', onClick: toggleTheme },
        { label: 'Help & Support', icon: 'help', onClick: function () { C.go('/help'); } }
      ], { align: 'right', label: 'More' });
      return;
    }
    var shareItem = S.current && S.view === 'chat' && data.kind === 'remote' && !S.current.temporary && !S.loadingConv ? [{ label: 'Share chat', icon: 'link', onClick: function () { shareConv(S.current); } }] : [];
    C.menu(anchor, shareItem.concat([
      { label: S.browser.layout === 'none' ? 'Open browser' : 'Close browser', icon: 'globe', onClick: function () { S.browser.layout === 'none' ? openBrowser() : setLayout('none'); } },
      { label: C.theme.current() === 'dark' ? 'Light mode' : 'Dark mode', icon: C.theme.current() === 'dark' ? 'sun' : 'moon', onClick: toggleTheme },
      { label: 'Settings', icon: 'settings', onClick: function () { C.go('/settings'); } },
      { label: 'Account & security', icon: 'shield', onClick: function () { C.go('/account'); } }, '-',
      { label: 'Sign out', icon: 'out', danger: true, onClick: signOut }
    ]), { align: 'right', label: 'More' });
  }
  function signOut() { C.confirm({ title: 'Sign out of Colon?', body: 'Your chats stay in your account. You can keep chatting as a guest, but new chats won’t be saved.', confirm: 'Sign out' }).then(function (ok) { if (ok) C.logout(); }); }
  CW.signOut = signOut;
  function toggleTheme() { C.theme.toggle(); }

  /* ================= Welcome ================= */
  function renderWelcome() {
    var page = $('#cw-page'); page.className = 'cw-page cw-page-welcome';
    page.innerHTML = noticeBanner() + (typeof C.verifyBanner === 'function' ? C.verifyBanner() : '') + '<section class="cw-welcome">' +
      '<div class="cw-hero-mark" aria-hidden="true">' + C.MARK + '</div>' +
      '<h1 class="cw-hero-h">What can we explore today?</h1>' +
      '<p class="cw-hero-p">Your ideas, questions and ambitions start here.</p>' +
      '<div class="cw-prompts">' + PROMPTS.map(function (p, i) {
        return '<button type="button" class="cw-prompt" data-prompt="' + i + '"><span class="cw-prompt-ico i' + i + '">' + icon(p.icon) + '</span><b>' + esc(p.title) + '</b><span>' + esc(p.text) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="cw-welcome-modes chips" role="radiogroup" aria-label="Mode"></div></section>';
    if (typeof C.bindBanner === 'function') C.bindBanner(page);
    bindNotice(page);
    renderModeChips();  // mode chips scroll with the welcome content, above the floating composer
  }

  /* ================= Thread ================= */
  function renderThread() {
    var page = $('#cw-page'); page.className = 'cw-page cw-page-chat';
    if (!S.messages.length) { page.innerHTML = '<div class="empty">' + icon('chat') + '<div class="h3">Say hello to Colon Saga</div><p class="small">Ask anything to start this conversation.</p></div>'; return; }
    var lastA = lastAssistant();
    page.innerHTML = '<div class="cw-thread" role="log" aria-live="off">' + S.messages.map(function (m) { return msgHtml(m, m === lastA); }).join('') + '</div>';
    S.messages.forEach(function (m) { S.seen[m.id] = 1; });
    loadAttachmentThumbs(page);
  }
  function lastAssistant() { for (var i = S.messages.length - 1; i >= 0; i--) if (S.messages[i].role === 'assistant') return S.messages[i]; return null; }
  function msgHtml(m, isLast) {
    var fresh = S.seen[m.id] ? '' : ' fresh';  // entry animation only the first time a message appears
    if (m.role === 'event') return '<div class="cw-event"><span>' + esc(m.content) + '</span></div>';
    if (m.role === 'user') {
      return '<div class="cw-msg user' + fresh + '" data-mid="' + esc(m.id) + '"><div class="cw-bubble">' + attachmentsHtml(m.attachments) + (m.content ? '<div class="cw-user-text">' + esc(m.content) + '</div>' : '') + '</div>' +
        '<div class="cw-actions"><button class="icon-btn sm" data-msg="copy" aria-label="Copy message" data-tip="Copy">' + icon('copy') + '</button>' +
        (S.streaming || /^tmp/.test(m.id) ? '' : '<button class="icon-btn sm" data-msg="edit" aria-label="Edit message" data-tip="Edit">' + icon('edit') + '</button>') + '</div></div>';
    }
    var streaming = m.status === 'streaming', fb = m.feedback && m.feedback.rating;
    var body = aiBody(m);
    var meta = (S.settings && S.settings.showMeta) ? '<span class="badge">' + icon(MODES[m.mode] ? MODES[m.mode].icon : 'sparkle') + (MODES[m.mode] ? MODES[m.mode].label : 'General') + '</span>' : '';
    return '<div class="cw-msg ai' + fresh + (streaming ? ' is-streaming' : '') + '" data-mid="' + esc(m.id) + '">' +
      '<div class="cw-ai-head"><span class="cw-ai-mark">' + C.MARK + '</span><b>' + esc(modelName(m.model)) + '</b>' + meta +
      (m.origin === 'browse' ? '<span class="badge cyan">' + icon('globe') + 'AI Browse</span>' : '') +
      (m.web && !streaming ? (m.web.ok ? '<span class="badge cyan" data-tip="Answered from a web search just now">' + icon('globe') + 'Web</span>' : '<span class="badge warn" data-tip="Web search wasn’t available for this answer">No web</span>') : '') + (m.preview ? '<span class="badge" data-tip="Generated on this device. Colon Saga isn’t connected yet.">Preview</span>' : '') +
      (m.status === 'stopped' ? '<span class="badge warn">Stopped</span>' : '') + '</div>' +
      '<div class="cw-ai-body">' + body + '</div>' +
      (m.status === 'error' ? errorCard(m) : '') +
      sourcesHtml(m.sources) +
      (streaming ? '' : '<div class="cw-actions">' +
        '<button class="icon-btn sm" data-msg="copy" aria-label="Copy response" data-tip="Copy">' + icon('copy') + '</button>' +
        (isLast ? '<button class="icon-btn sm" data-msg="regen" aria-label="Regenerate response" data-tip="Regenerate">' + icon('refresh') + '</button>' : '') +
        '<button class="icon-btn sm" data-msg="up" aria-label="Good response" aria-pressed="' + (fb === 'up') + '" data-tip="Good response">' + icon('thumbUp') + '</button>' +
        '<button class="icon-btn sm" data-msg="down" aria-label="Bad response" aria-pressed="' + (fb === 'down') + '" data-tip="Bad response">' + icon('thumbDown') + '</button>' +
        ('speechSynthesis' in window ? '<button class="icon-btn sm" data-msg="speak" aria-label="Read aloud" aria-pressed="' + (S.speaking === m.id) + '" data-tip="Read aloud">' + icon('volume') + '</button>' : '') +
        (m.version > 1 ? '<span class="tiny muted">Version ' + m.version + '</span>' : '') + '</div>') +
      '</div>';
  }
  // Research mode: what the server is doing before the answer starts (SSE "status" events).
  var STAGES = {
    searching: function () { return 'Searching the web…'; },
    reading: function (n) { return 'Reading ' + n + ' source' + (n === 1 ? '' : 's') + '…'; },
    writing: function (n) { return n ? 'Writing from ' + n + ' source' + (n === 1 ? '' : 's') + '…' : 'Writing…'; },
    unavailable: function () { return 'Web search unavailable. Answering anyway…'; }
  };
  function aiBody(m) {
    var streaming = m.status === 'streaming';
    if (streaming && !m.content) {
      var st = m.stage && STAGES[m.stage] ? STAGES[m.stage](m.stage === 'writing' ? (m.sources || []).length : m.stageCount || 0) : esc(modelName(m.model)) + ' is thinking…';
      return '<div class="cw-thinking' + (m.stage ? ' cw-stage' : '') + '" role="status">' + (m.stage === 'searching' || m.stage === 'reading' ? icon('globe') : '') + '<span class="typing"><i></i><i></i><i></i></span><span>' + (m.stage ? esc(st) : st) + '</span></div>';
    }
    return '<div class="md' + (streaming ? ' streaming' : '') + '">' + MD.render(m.content, { sources: m.sources }) + '</div>';
  }
  function errorCard(m) {
    var e = m.error || {}, noProv = e.code === 'no_provider', needLogin = !signedIn() && (e.code === 'quota' || e.code === 'login_required');
    var title = noProv ? 'Colon Saga isn’t connected to an AI provider yet' : e.code === 'quota' ? 'You’ve reached today’s limit' : e.code === 'no_vision' ? 'Images can’t be read yet' : e.code === 'offline' ? 'You’re offline' : 'This reply didn’t finish';
    var body = noProv ? 'An admin needs to add a provider in the Admin Dashboard.' + (ephemeral() ? '' : ' Your message is saved.') : e.message || 'Something went wrong.';
    return '<div class="cw-err" role="alert">' + icon('alert') + '<div><b>' + title + '</b><span>' + esc(body) + '</span></div>' +
      (needLogin ? '<button class="btn sm primary" data-a="login">Log in</button>' : noProv || e.code === 'quota' ? '' : '<button class="btn sm" data-msg="regen">' + icon('refresh') + 'Retry</button>') + '</div>';
  }
  function sourcesHtml(src) {
    if (!src || !src.length) return '';
    return '<div class="cw-sources"><div class="cw-sources-h">' + icon('link') + 'Sources</div><div class="cw-sources-list no-scrollbar">' + src.map(function (s, i) {
      var host = s.site || window.ColonURL.hostOf(s.url);
      // Web search sources (they carry .site) open in a new tab; the favicon comes from the site itself, if it has one.
      var ico = s.site && /^https:\/\//i.test(s.url) ? '<img class="cw-source-ico" src="https://' + esc(rawHost(s.url)) + '/favicon.ico" alt="" width="14" height="14" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '';
      return '<a class="cw-source" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer"' + (s.site ? ' data-web' : '') + ' data-source="' + esc(s.url) + '"><span class="cw-source-n">' + (s.n || i + 1) + '</span><span class="cw-source-b"><b>' + esc(s.title) + '</b><small>' + ico + esc(host) + '</small></span></a>';
    }).join('') + '</div></div>';
  }
  function rawHost(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
  function attachmentsHtml(list) {
    if (!list || !list.length) return '';
    return '<div class="cw-atts">' + list.map(function (a) {
      if (a.kind === 'image') return '<button type="button" class="cw-att-img" data-att-open="' + esc(a.id) + '" data-kind="image" aria-label="Open image ' + esc(a.name) + '"><img alt="' + esc(a.name) + '" data-thumb="' + esc(a.id) + '"></button>';
      return '<button type="button" class="cw-att-file" data-att-open="' + esc(a.id) + '" data-kind="' + esc(a.kind) + '" data-name="' + esc(a.name) + '">' + icon(a.kind === 'audio' ? 'mic' : a.kind === 'text' ? 'file' : 'fileText') + '<span><b>' + esc(a.name) + '</b><small>' + C.fmtBytes(a.size || 0) + (a.duration ? ' · ' + a.duration + ' s' : '') + '</small></span></button>';
    }).join('') + '</div>';
  }
  var thumbUrls = {};
  function loadAttachmentThumbs(root) {
    root.querySelectorAll('img[data-thumb]').forEach(function (img) {
      var id = img.getAttribute('data-thumb');
      if (thumbUrls[id]) { img.src = thumbUrls[id]; return; }
      data.fileBlob(id).then(function (b) { if (b) { thumbUrls[id] = URL.createObjectURL(b); img.src = thumbUrls[id]; } else img.closest('.cw-att-img').classList.add('missing'); });
    });
  }
  function openAttachment(id, kind, name) {
    data.fileBlob(id).then(function (b) {
      if (!b) return C.toast('This file is no longer available on this device.', 'bad');
      var url = URL.createObjectURL(b);
      if (kind === 'image') C.sheet('<img src="' + url + '" alt="" style="width:100%;height:auto;border-radius:12px;max-height:70dvh;object-fit:contain"><div class="sheet-actions"><a class="btn" href="' + url + '" download>' + icon('download') + 'Download</a><button class="btn primary" data-close>Close</button></div>', null, { cls: 'wide', label: 'Image preview' });
      else if (kind === 'audio') C.sheet('<div class="h2">' + esc(name) + '</div><audio controls src="' + url + '" style="width:100%;margin-top:14px"></audio><div class="sheet-actions"><button class="btn primary" data-close>Close</button></div>', null, { label: name });
      else if (kind === 'text') b.text().then(function (t) { C.sheet('<div class="h2">' + esc(name) + '</div><pre class="mono" style="max-height:60dvh;overflow:auto;white-space:pre-wrap;background:var(--bg-2);padding:12px;border-radius:12px;border:1px solid var(--line)">' + esc(t.slice(0, 20000)) + '</pre><div class="sheet-actions"><button class="btn primary" data-close>Close</button></div>', null, { cls: 'wide', label: name }); });
      else window.open(url, '_blank', 'noopener');
    });
  }

  /* ================= Streaming send ================= */
  function send() {
    var ta = $('#cw-input'), text = ta.value.trim(), atts = S.media.ready(), st = S.media.state();
    if (S.streaming) return;
    if (st.uploading) { C.toast('Wait for your files to finish uploading.'); return; }
    if (!text && !atts.length) return;
    if (S.media.voiceActive()) S.media.stopVoice();
    var conv = S.current && !S.loadingConv ? Promise.resolve(S.current) : data.createConversation({ mode: S.draftMode, model: S.draftModel || defaultModel() });
    ta.value = ''; autoGrow(); S.media.clear(true); syncComposer();
    conv.then(function (c) {
      var fresh = !S.current || S.current.id !== c.id;
      if (fresh) {
        S.current = c; S.messages = [];
        var w = $('.cw-welcome'); if (w) w.classList.add('leaving');
        history.replaceState(null, '', '#/c/' + encodeURIComponent(c.id)); setView('chat');
        S.el.querySelectorAll('[data-nav]').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-nav') === '/'); });
      }
      var temp = { id: C.uid('tmp'), role: 'user', content: text, attachments: atts, created_at: new Date().toISOString() };
      S.messages.push(temp); renderThread(); updateHeader(); scrollBottom(true);
      run(function (o) { return data.send(Object.assign({ conversationId: c.id, content: text, attachments: atts, mode: c.mode, model: c.model || defaultModel() }, o)); }, temp);
    }).catch(function (e) { ta.value = text; autoGrow(); syncComposer(); C.toast(e.message, 'bad'); });
  }
  function run(call, tempUser, replaceId) {
    var ctl = new AbortController(), msg = null;
    S.streaming = { ctl: ctl }; syncComposer();
    var paint = rafThrottle(function () { if (msg) paintMessage(msg); });
    call({
      signal: ctl.signal,
      onEvent: function (ev) {
        if (ev.type === 'user' && tempUser) { S.seen[ev.message.id] = 1; tempUser.id = ev.message.id; if (ev.conversation) S.current = Object.assign(S.current || {}, ev.conversation); updateHeader(); }
        else if (ev.type === 'start') {
          msg = ev.message; msg.content = msg.content || ''; S.streaming.msgId = msg.id;
          var at = replaceId ? S.messages.findIndex(function (m) { return m.id === replaceId; }) : -1;
          if (at > -1) S.messages.splice(at, 1, msg); else S.messages.push(msg);
          renderThread(); scrollBottom();
        }
        else if (ev.type === 'sources' && msg) { msg.sources = ev.sources; renderThread(); scrollBottom(); }
        else if (ev.type === 'status' && msg) { msg.stage = ev.stage; msg.stageCount = ev.count || 0; paint(); }
        else if (ev.type === 'delta' && msg) { if (data.kind === 'remote') msg.content += ev.text; paint(); }
        else if (ev.type === 'done' && msg) { Object.assign(msg, ev.message || {}); }
      }
    }).then(function () { finish(); }, function (e) {
      if (msg && msg.status === 'streaming') { msg.status = 'error'; msg.error = { code: e.code, message: e.message }; }
      else if (!msg) S.messages.push({ id: C.uid('m'), role: 'assistant', content: '', status: 'error', error: { code: e.code, message: e.message }, model: modelId(), mode: mode(), created_at: new Date().toISOString() });
      finish();
    });
    function finish() {
      S.streaming = null; renderThread(); syncComposer(); scrollBottom(); refreshConvs(); updateHeader();
      if (msg && msg.status === 'complete') announce('Colon Saga replied.');
    }
  }
  function paintMessage(msg) {
    var node = S.el.querySelector('.cw-msg[data-mid="' + CSS.escape(msg.id) + '"] .cw-ai-body');
    if (!node) { renderThread(); return; }
    node.innerHTML = aiBody(msg);
    scrollBottom();
  }
  function stopStreaming() { if (S.streaming) S.streaming.ctl.abort(); }
  function regenerate(mid) {
    if (S.streaming || !S.current) return;
    run(function (o) { return data.regenerate(Object.assign({ conversationId: S.current.id, messageId: mid }, o)); }, null, mid);
  }
  function rafThrottle(fn) { var q = false; return function () { if (q) return; q = true; requestAnimationFrame(function () { q = false; fn(); }); }; }
  function announce(t) { var a = document.getElementById('cw-live') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'cw-live', className: 'sr-only' })); a.setAttribute('aria-live', 'polite'); a.textContent = t; }

  /* ================= Edit a sent message ================= */
  // Rewrites the question in place; everything after it is replaced by a fresh answer (like ChatGPT).
  function editMessage(m) {
    if (S.streaming || !S.current) return;
    var node = S.el.querySelector('.cw-msg[data-mid="' + CSS.escape(m.id) + '"]'); if (!node) return;
    node.classList.add('editing');
    var bubble = node.querySelector('.cw-bubble');
    bubble.innerHTML = '<form class="cw-edit" novalidate><textarea class="textarea" maxlength="16000" aria-label="Edit your message">' + esc(m.content) + '</textarea>' +
      '<div class="cw-edit-actions"><button type="button" class="btn sm ghost" data-edit-cancel>Cancel</button><button type="submit" class="btn sm primary">Send</button></div></form>';
    node.querySelector('.cw-actions').hidden = true;
    var ta = bubble.querySelector('textarea');
    var grow = function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 320) + 'px'; };
    ta.addEventListener('input', grow); setTimeout(function () { grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 20);
    ta.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); renderThread(); } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && S.settings.enterToSend && !('ontouchstart' in window && isMobile())) { e.preventDefault(); bubble.querySelector('form').requestSubmit(); } });
    bubble.querySelector('[data-edit-cancel]').addEventListener('click', function () { renderThread(); });
    bubble.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      if (!text && !(m.attachments && m.attachments.length)) { C.toast('Type a message first.', 'bad'); return; }
      if (text === m.content) { renderThread(); return; }
      var idx = S.messages.indexOf(m);
      m.content = text; S.messages.splice(idx + 1);
      renderThread(); scrollBottom(true);
      run(function (o) { return data.edit(Object.assign({ conversationId: S.current.id, messageId: m.id, content: text }, o)); }, null, null);
    });
  }

  /* ================= Shared chat (read-only, anyone with the link) ================= */
  function showShared(token) {
    if (S.streaming) stopStreaming();
    S.current = null; S.messages = []; setView('shared');
    var page = $('#cw-page'); page.className = 'cw-page cw-page-chat cw-page-shared';
    updateHeader(); renderConvs();
    page.innerHTML = '<div class="cw-thread">' + [1, 2].map(function (i) { return '<div class="cw-skel ' + (i % 2 ? 'u' : 'a') + '"><div class="skel" style="height:' + (i % 2 ? 44 : 96) + 'px"></div></div>'; }).join('') + '</div>';
    C.api('/shared/' + encodeURIComponent(token)).then(function (d) {
      var c = d.conversation;
      document.title = c.title + ' · Colon AI';
      page.innerHTML = '<div class="cw-shared-head"><span class="badge">' + icon('link') + 'Shared chat</span><h1 class="h2">' + esc(c.title) + '</h1>' +
        '<p class="small muted">' + (c.owner ? esc(c.owner) + ' shared this conversation' : 'A shared conversation') + ' · ' + esc(C.ago(c.shared_at || c.created_at)) + '. It’s read-only.</p></div>' +
        '<div class="cw-thread">' + d.messages.map(function (m) {
          if (m.role === 'user') return '<div class="cw-msg user"><div class="cw-bubble">' + (m.attachments && m.attachments.length ? '<div class="cw-atts">' + m.attachments.map(function (a) { return '<span class="cw-att-file">' + icon(a.kind === 'image' ? 'image' : 'fileText') + '<span><b>' + esc(a.name) + '</b></span></span>'; }).join('') + '</div>' : '') + (m.content ? '<div class="cw-user-text">' + esc(m.content) + '</div>' : '') + '</div></div>';
          return '<div class="cw-msg ai"><div class="cw-ai-head"><span class="cw-ai-mark">' + C.MARK + '</span><b>' + esc(modelName(m.model)) + '</b></div><div class="cw-ai-body"><div class="md">' + MD.render(m.content, { sources: m.sources }) + '</div></div>' + sourcesHtml(m.sources) + '</div>';
        }).join('') + '</div>' +
        '<div class="cw-shared-cta"><a class="btn primary" href="#/">' + icon('plus') + 'Start your own chat</a><button type="button" class="btn ghost sm" data-report>' + icon('alert') + 'Report this chat</button></div>';
      var rb = page.querySelector('[data-report]');
      if (rb) rb.addEventListener('click', function () { reportShared(token, rb); });
    }).catch(function (e) {
      page.innerHTML = '<div class="empty cw-error-page">' + icon('link') + '<div class="h3">This link doesn’t work</div><p class="small">' + esc(e.message) + '</p><a class="btn primary" href="#/">' + icon('plus') + 'New chat</a></div>';
    });
  }

  // Anyone can report a shared chat; it goes to the Admin Dashboard moderation queue.
  var REPORT_REASONS = ['Harmful or dangerous', 'Hate or harassment', 'Sexual content', 'Spam or scam', 'Private information', 'Other'];
  function reportShared(token, btn) {
    C.sheet('<div class="h2">Report this chat</div><p class="small muted">Tell the Colon team what’s wrong. Reports are reviewed by moderators.</p><form class="form" novalidate>' +
      C.field({ name: 'reason', label: 'Reason', type: 'select', value: REPORT_REASONS[0], options: REPORT_REASONS.map(function (r) { return [r, r]; }) }) +
      C.field({ name: 'comment', label: 'Details (optional)', required: false, max: 1000 }) +
      '<button class="btn primary block" type="submit">Send report</button><button class="btn ghost block" type="button" data-close>Cancel</button></form>', function (el, close) {
      C.bindForm(el.querySelector('form'), function (d) {
        return C.api('/shared/' + encodeURIComponent(token) + '/report', { method: 'POST', body: d }).then(function () { close(); C.toast('Thanks. Our moderators will review it.', 'ok'); btn.disabled = true; });
      });
    });
  }

  /* ================= Composer ================= */
  function autoGrow() { var ta = $('#cw-input'); if (!ta.value) { ta.style.height = ''; ta.classList.remove('scrolling'); return; } ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, isMobile() ? 140 : 220) + 'px'; ta.classList.toggle('scrolling', ta.scrollHeight > (isMobile() ? 140 : 220)); }
  function syncComposer() {
    if (!S.el || !S.media) return;
    var ta = $('#cw-input'), st = S.media.state(), btn = $('[data-a=send]');
    if (S.streaming) { btn.disabled = false; btn.classList.add('stop'); btn.innerHTML = icon('stop'); btn.setAttribute('aria-label', 'Stop generating'); btn.type = 'button'; }
    else { btn.classList.remove('stop'); btn.innerHTML = icon('send'); btn.setAttribute('aria-label', st.uploading ? 'Waiting for uploads' : 'Send message'); btn.type = 'submit'; btn.disabled = st.uploading || (!ta.value.trim() && !st.ready); }
    S.el.classList.toggle('has-text', !!ta.value.trim());
  }
  // Follow the stream only while the reader is at the bottom; once they scroll up, stay put and offer "Latest".
  function scrollBottom(force) {
    var sc = $('#cw-scroll'); if (!sc) return;
    if (force) S.stick = true;
    if (S.stick) { sc.scrollTop = sc.scrollHeight; S.lastTop = sc.scrollTop; }
    syncJump();
  }
  function syncJump() { var j = $('[data-a=jump]'); if (j) j.hidden = S.stick || S.view !== 'chat'; }
  function onThreadScroll() {
    var sc = $('#cw-scroll'), dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    var up = sc.scrollTop < S.lastTop - 1, byUser = Date.now() - S.userInput < 1200;
    S.lastTop = sc.scrollTop;
    if (up && byUser && dist > 8) S.stick = false; else if (dist < 64) S.stick = true;
    syncJump();
  }
  function trackComposerHeight() {
    // The thread scrolls under the floating composer: pad it by the composer's live height.
    var comp = $('.cw-composer'), chat = $('.cw-chat');
    function upd() { chat.style.setProperty('--composer-h', Math.ceil(comp.offsetHeight) + 'px'); }
    if (window.ResizeObserver) { S.ro = new ResizeObserver(function () { var keep = S.stick; upd(); if (keep) scrollBottom(); }); S.ro.observe(comp); }
    upd();
  }

  /* ================= Browser panel ================= */
  function ensureBrowser() {
    if (S.browser.inst) return S.browser.inst;
    var holder = document.createElement('div'); holder.className = 'cw-browser-holder';
    S.browser.inst = window.ColonBrowser.create(holder, {
      variant: 'panel',
      onSummary: function (md, sources, goal) { addBrowseNote(md, sources, goal); },
      onAsk: function (url) { var ta = $('#cw-input'); ta.value = 'Summarise this page for me: ' + url; autoGrow(); syncComposer(); setMobileTab('chat'); ta.focus(); },
      onNavigateApp: function (section) { window.open('https://browser.apparatus.name.ng/#/' + section, '_blank', 'noopener'); }
    });
    S.browser.inst.on('change', browserIndicator);
    return S.browser.inst;
  }
  function browserIndicator() {
    var b = S.browser.inst; if (!b) return; var st = b.state(); if (!st) return;
    var activeTask = st.task && /planning|running|awaiting_approval/.test(st.task.status);
    var dot = $('[data-a=browser] .dot'); dot.hidden = !activeTask;
    S.el.querySelectorAll('[data-bdot]').forEach(function (d) { d.className = 'status-dot' + (activeTask || st.loading ? ' live' : '') + (st.task && st.task.status === 'paused' ? ' warn' : ''); });
    var label = st.active ? (/^colon:/.test(st.active.url) ? 'New tab' : window.ColonURL.displayUrl(st.active.url)) : '';
    S.el.querySelectorAll('[data-burl]').forEach(function (u) { u.textContent = (activeTask ? 'Saga: ' + (st.task.site || 'working') + ' · ' : '') + label; });
  }
  function openBrowser(url) {
    var b = ensureBrowser();
    if (S.browser.layout === 'none') setLayout(isMobile() ? 'embedded' : (S.settings.browserLayout || 'split'));
    else if (S.browser.layout === 'embedded' && S.browser.collapsed) { S.browser.collapsed = false; renderEmbed(); }
    if (S.browser.layout === 'split' && isMobile()) setMobileTab('browser');
    if (url) b.navigate(url);
    return b;
  }
  function setLayout(l) {
    var b = ensureBrowser(); S.browser.layout = l; S.el.setAttribute('data-layout', l);
    $('[data-a=browser]').setAttribute('aria-pressed', l !== 'none');
    var embedHost = $('.cw-embed-host');
    if (l === 'embedded') { renderEmbed(); b.mount(embedHost.querySelector('.cw-embed-body')); setTimeout(function () { embedHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 50); }
    else { embedHost.innerHTML = ''; }
    if (l === 'split') { b.mount($('.cw-split-body')); applySplitWidth(); if (isMobile()) setMobileTab('browser'); }
    if (l === 'none') { if (b.el.parentNode) b.el.parentNode.removeChild(b.el); setMobileTab('chat'); }
    if (l !== 'none' && S.settings.browserLayout !== l && !isMobile()) data.saveSettings({ browserLayout: l }).then(function (s) { S.settings = s; });
    browserIndicator();
  }
  function renderEmbed() {
    var host = $('.cw-embed-host'), b = S.browser.inst;
    var existing = host.querySelector('.cw-embed');
    if (!existing) {
      host.innerHTML = '<div class="cw-embed" role="region" aria-label="Colon Browser (embedded)"><div class="cw-embed-head"><span class="status-dot" data-bdot></span><b>Colon Browser</b><span class="tiny muted cw-ellipsis" data-burl></span>' +
        '<button class="icon-btn sm" data-a="embed-collapse" aria-label="Collapse browser" aria-expanded="true" data-tip="Collapse">' + icon('chevDown') + '</button>' +
        '<button class="icon-btn sm cw-hide-xs" data-a="layout-split" aria-label="Split screen" data-tip="Split screen">' + icon('split') + '</button>' +
        '<button class="icon-btn sm" data-a="embed-full" aria-label="Expand to full screen" data-tip="Full screen">' + icon('expand') + '</button>' +
        '<button class="icon-btn sm" data-a="browser-close" aria-label="Close browser" data-tip="Close">' + icon('x') + '</button></div><div class="cw-embed-body"></div></div>';
      existing = host.querySelector('.cw-embed');
      if (b && b.el.parentNode !== existing.querySelector('.cw-embed-body')) b.mount(existing.querySelector('.cw-embed-body'));
    }
    existing.classList.toggle('collapsed', S.browser.collapsed); existing.classList.toggle('full', S.browser.full);
    var cb = existing.querySelector('[data-a=embed-collapse]'); cb.setAttribute('aria-expanded', !S.browser.collapsed); cb.setAttribute('aria-label', S.browser.collapsed ? 'Expand browser' : 'Collapse browser');
    var fb = existing.querySelector('[data-a=embed-full]'); fb.innerHTML = icon(S.browser.full ? 'collapse' : 'expand'); fb.setAttribute('aria-label', S.browser.full ? 'Exit full screen' : 'Expand to full screen');
    browserIndicator();
  }
  function setMobileTab(t) {
    S.browser.mtab = t; S.el.setAttribute('data-mtab', t);
    S.el.querySelectorAll('[data-a=mtab]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-t') === t); });
  }
  function applySplitWidth() {
    var w = S.browser.width || Number(localStorage.getItem('colon.splitw')) || Math.round(($('.cw-body').clientWidth || 1000) * 0.45);
    S.browser.width = w; $('.cw-split').style.width = w + 'px';
  }
  function addBrowseNote(md, sources, goal) {
    var c = S.current && !S.loadingConv ? Promise.resolve(S.current) : data.createConversation({ mode: 'research', model: S.draftModel || defaultModel() }).then(function (c) { S.current = c; S.messages = []; history.replaceState(null, '', '#/c/' + encodeURIComponent(c.id)); setView('chat'); return c; });
    c.then(function (conv) { return data.addNote(conv.id, { content: md, sources: sources, origin: 'browse', title: goal }); })
      .then(function (m) { S.messages.push(m); renderThread(); scrollBottom(true); refreshConvs(); updateHeader(); C.toast('AI Browse summary added to the chat.', 'ok'); setMobileTab('chat'); })
      .catch(function (e) { C.toast(e.message, 'bad'); });
  }
  function applyTextSize() { document.documentElement.setAttribute('data-text', (S.settings && S.settings.textSize) || 'md'); }
  CW.applySettings = function (s) { S.settings = s; applyTextSize(); if (S.view === 'chat') renderThread(); };
  CW.media = function () { return S.media; };

  /* ================= Events ================= */
  function bind() {
    var ta = $('#cw-input');
    ta.addEventListener('input', function () { autoGrow(); syncComposer(); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && S.settings && S.settings.enterToSend && !('ontouchstart' in window && isMobile())) { e.preventDefault(); if (!S.streaming) send(); }
    });
    ta.addEventListener('paste', function (e) {
      var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
      if (files.length) { e.preventDefault(); S.media.addFiles(files); }
    });
    $('#cw-form').addEventListener('submit', function (e) { e.preventDefault(); if (S.streaming) stopStreaming(); else send(); });
    var chat = $('.cw-chat');
    ['dragenter', 'dragover'].forEach(function (t) { chat.addEventListener(t, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') > -1) { e.preventDefault(); chat.classList.add('dropping'); } }); });
    ['dragleave', 'drop'].forEach(function (t) { chat.addEventListener(t, function (e) { if (t === 'dragleave' && chat.contains(e.relatedTarget)) return; chat.classList.remove('dropping'); }); });
    chat.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); S.media.addFiles(e.dataTransfer.files); } });
    var sc = $('#cw-scroll');
    sc.addEventListener('scroll', onThreadScroll, { passive: true });
    ['wheel', 'touchstart', 'touchmove', 'pointerdown'].forEach(function (t) { sc.addEventListener(t, function () { S.userInput = Date.now(); }, { passive: true }); });
    sc.addEventListener('keydown', function (e) { if (/^(PageUp|ArrowUp|Home| )$/.test(e.key)) S.userInput = Date.now(); });
    trackComposerHeight();
    var q = $('#cw-q');
    q.addEventListener('input', C.debounce(function () { S.q = q.value.trim(); refreshConvs(); }, 180));
    q.addEventListener('keydown', function (e) { if (e.key === 'Escape') { q.value = ''; S.q = ''; refreshConvs(); q.blur(); } });

    // A site without a favicon: drop the broken image quietly (error events don't bubble, so capture).
    S.el.addEventListener('error', function (e) { var t = e.target; if (t && t.classList && t.classList.contains('cw-source-ico')) t.remove(); }, true);
    S.el.addEventListener('click', function (e) {
      var t = e.target;
      var pr = t.closest('[data-prompt]');
      if (pr) { var p = PROMPTS[Number(pr.getAttribute('data-prompt'))]; S.draftMode = p.mode; updateHeader(); ta.value = p.prompt; autoGrow(); syncComposer(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return; }
      var md = t.closest('[data-mode]'); if (md && md.closest('.cw-welcome-modes')) { setMode(md.getAttribute('data-mode')); return; }
      var cm = t.closest('[data-conv-menu]');
      if (cm) { e.preventDefault(); var c = S.convs.filter(function (x) { return x.id === cm.getAttribute('data-conv-menu'); })[0]; if (c) CW.convMenu(cm, c); return; }
      var copyCode = t.closest('[data-copy-code]');
      if (copyCode) { var code = copyCode.closest('.md-code').querySelector('code').textContent; C.copyText(code).then(function () { copyCode.textContent = 'Copied'; copyCode.classList.add('done'); setTimeout(function () { copyCode.textContent = 'Copy'; copyCode.classList.remove('done'); }, 1600); }, function () { C.toast('Couldn’t copy.', 'bad'); }); return; }
      var att = t.closest('[data-att-open]'); if (att) { openAttachment(att.getAttribute('data-att-open'), att.getAttribute('data-kind'), att.getAttribute('data-name') || ''); return; }
      var link = t.closest('.cw-msg a[href^="http"], .cw-source');
      // Citation chips and web-search sources open in a new tab (target=_blank, rel=noopener), not the panel.
      if (link && (link.closest('.cite') || link.hasAttribute('data-web'))) return;
      if (link && S.settings && S.settings.linksInPanel && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openBrowser(link.getAttribute('href')); return; }
      var mb = t.closest('[data-msg]'); if (mb) { msgAction(mb); return; }
      if (t.closest('.cw-conv a') && isMobile()) closeDrawer();
      var a = t.closest('[data-a]'); if (!a) return;
      var act = a.getAttribute('data-a');
      var acts = {
        'new': function () { closeDrawer(); newChat(); }, sidebar: toggleSidebar, 'drawer-close': closeDrawer,
        model: function () { modelMenu(a); }, profile: function () { profileMenu(a); }, more: function () { moreMenu(a); }, theme: toggleTheme,
        'rename-current': function () { if (S.current) renameConv(S.current); },
        attach: function () { S.media.pick(); }, mic: function () { S.media.startVoice(); },
        'mode-menu': function () { modeMenu(a); },
        'browse-web': function () { var v = ta.value.trim(); var b = openBrowser(); if (v) { b.startTask(v); ta.value = ''; autoGrow(); syncComposer(); C.toast('Saga is browsing. Watch every step in the panel.'); } },
        browser: function () { S.browser.layout === 'none' ? openBrowser() : setLayout('none'); },
        'browser-close': function () { S.browser.full = false; setLayout('none'); },
        'layout-split': function () { S.browser.full = false; setLayout('split'); }, 'layout-embed': function () { setLayout('embedded'); },
        'embed-collapse': function () { S.browser.collapsed = !S.browser.collapsed; renderEmbed(); },
        'embed-full': function () { S.browser.full = !S.browser.full; S.browser.collapsed = false; renderEmbed(); document.body.classList.toggle('cw-noscroll', S.browser.full); },
        mtab: function () { setMobileTab(a.getAttribute('data-t')); }, jump: function () { scrollBottom(true); },
        'retry-convs': refreshConvs,
        login: function () { closeDrawer(); login('login'); }, signup: function () { closeDrawer(); login('signup'); }
      };
      if (acts[act]) acts[act]();
    });

    if (typeof C.resizable === 'function') C.resizable($('.cw-resizer'), {
      min: 320, invert: true,
      max: function () { return Math.max(360, $('.cw-body').clientWidth - 380); },
      get: function () { return S.browser.width || $('.cw-split').offsetWidth; },
      set: function (v) { S.browser.width = v; $('.cw-split').style.width = v + 'px'; },
      done: function (v) { localStorage.setItem('colon.splitw', Math.round(v)); }
    });

    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', C.debounce(function () { applySidebar(); if (!isMobile()) closeDrawer(); if (S.browser.layout === 'split' && !isMobile()) applySplitWidth(); }, 120));
    window.addEventListener('offline', function () { C.toast(data.kind === 'local' ? 'You’re offline. Chats stay on this device; sources need a connection.' : 'You’re offline. Colon Saga needs a connection to answer.', 'bad'); });
    window.addEventListener('online', function () { C.toast('Back online.', 'ok'); });
    C.theme.on(function () { var s = S.el && S.el.querySelector('.cw-theme'); if (s) s.setAttribute('aria-pressed', C.theme.current() === 'light'); });
  }
  function onKey(e) {
    if (!S.el || !document.body.contains(S.el)) return;
    var k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'k') { e.preventDefault(); if (isMobile()) openDrawer(); $('#cw-q').focus(); }
    else if (mod && e.shiftKey && k === 'o') { e.preventDefault(); newChat(); }
    else if (k === 'escape' && S.streaming) { stopStreaming(); }
    else if (k === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); $('#cw-input').focus(); }
  }
  function msgAction(b) {
    var node = b.closest('.cw-msg'), mid = node && node.getAttribute('data-mid'), m = S.messages.filter(function (x) { return x.id === mid; })[0], act = b.getAttribute('data-msg');
    if (!m) return;
    if (act === 'edit') { editMessage(m); return; }
    if (act === 'copy') C.copyText(m.content).then(function () { C.toast('Copied.'); }, function () { C.toast('Couldn’t copy.', 'bad'); });
    else if (act === 'regen') regenerate(m.id);
    else if (act === 'up') sendFeedback(m, m.feedback && m.feedback.rating === 'up' ? {} : { rating: 'up' });
    else if (act === 'down') {
      if (m.feedback && m.feedback.rating === 'down') return sendFeedback(m, {});
      C.sheet('<div class="h2">What went wrong?</div><p class="small muted" style="margin:4px 0 12px">Your feedback helps improve Colon Saga.</p><form class="form" novalidate><div class="cw-reasons">' +
        ['Not accurate', 'Not helpful', 'Wrong language', 'Unsafe or harmful', 'Too long', 'Other'].map(function (r, i) { return '<label class="chip sm"><input type="radio" name="reason" value="' + esc(r) + '"' + (i === 0 ? ' checked' : '') + ' class="sr-only">' + esc(r) + '</label>'; }).join('') +
        '</div><div class="field"><label for="fb-c">Tell us more (optional)</label><textarea class="textarea" id="fb-c" maxlength="1000"></textarea></div><div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Send feedback</button></div></form>', function (el, close) {
        var sync = function () { el.querySelectorAll('.cw-reasons label').forEach(function (l) { l.classList.toggle('on', l.querySelector('input').checked); }); };
        el.querySelectorAll('.cw-reasons input').forEach(function (i) { i.addEventListener('change', sync); }); sync();
        el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); sendFeedback(m, { rating: 'down', reason: el.querySelector('input[name=reason]:checked').value, comment: el.querySelector('#fb-c').value.trim() }); close(); });
      }, { label: 'Feedback' });
    }
    else if (act === 'speak') {
      if (S.speaking === m.id) { speechSynthesis.cancel(); S.speaking = null; renderThread(); return; }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(MD.toText(m.content).slice(0, 6000)); u.lang = (S.settings.voice && S.settings.voice.lang) || 'en-NG'; u.rate = (S.settings.voice && S.settings.voice.readAloudRate) || 1;
      u.onend = u.onerror = function () { S.speaking = null; renderThread(); };
      S.speaking = m.id; speechSynthesis.speak(u); renderThread();
    }
  }
  function sendFeedback(m, fb) {
    var prev = m.feedback; m.feedback = fb.rating ? fb : null; renderThread();
    data.feedback(S.current.id, m.id, fb).then(function () { if (fb.rating) C.toast('Thanks for the feedback.', 'ok'); }).catch(function (e) { m.feedback = prev; renderThread(); C.toast(e.message, 'bad'); });
  }

  CW.mount = mount;
  CW.newChat = newChat;
  CW.startWith = function (prompt, m) { C.go('/'); setTimeout(function () { S.draftMode = m || 'general'; updateHeader(); var ta = $('#cw-input'); ta.value = prompt; autoGrow(); syncComposer(); ta.focus(); }, 60); };
})();
