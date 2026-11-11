/* ColonBrowser: the one reusable browser module (ROADMAP standing rule: never duplicated).
   Mounted full-size by Colon Browser and as the embedded/split panel inside Colon AI. Both use
   ColonBrowserData, so tabs, history, bookmarks and the control mode are one session.

   Engine honesty (docs/adr/0002): the full engine is the Android System WebView in the Colon app.
   On the web this module is a READER PREVIEW: pages are fetched as data, sanitised, and rendered as
   text and images. No scripts, logins or forms run. The UI says so wherever it matters.

   const b = ColonBrowser.create(container, { variant: 'full'|'panel', onNavigateApp(section), onSummary(md, sources) });
   b.navigate(input) · back() · forward() · reload() · home() · newTab(url) · closeTab(id) · switchTab(id)
   b.setControl('ai'|'manual'|'shared') · takeControl() · returnToAI() · pauseAI() · stopTask() · startTask(goal)
   b.toggleSide(force) · toggleFullscreen() · mount(newContainer) · state() · on('change', fn) · destroy() */
(function (root) {
  'use strict';
  var C = root.Colon, U = root.ColonURL, icon = C.icon, esc = C.esc;

  var QUICK = [
    { t: 'Nigeria', u: 'https://en.wikipedia.org/wiki/Nigeria', c: '#16A34A' },
    { t: 'Lagos', u: 'https://en.wikipedia.org/wiki/Lagos', c: '#4169E1' },
    { t: 'Nigerian naira', u: 'https://en.wikipedia.org/wiki/Nigerian_naira', c: '#0EA5E9' },
    { t: 'Afrobeats', u: 'https://en.wikipedia.org/wiki/Afrobeats', c: '#A855F7' },
    { t: 'Jollof rice', u: 'https://en.wikipedia.org/wiki/Jollof_rice', c: '#F97316' },
    { t: 'African Union', u: 'https://en.wikipedia.org/wiki/African_Union', c: '#EAB308' }
  ];
  var MODES = {
    ai: { label: 'AI Mode', short: 'AI', icon: 'sparkles', desc: 'Saga performs authorised browsing actions. You watch every step.' },
    manual: { label: 'Manual', short: 'Manual', icon: 'hand', desc: 'You control the browser. AI automation is paused.' },
    shared: { label: 'Shared', short: 'Shared', icon: 'users', desc: 'You and Saga collaborate. Saga asks before each action.' }
  };

  function create(container, opts) {
    opts = opts || {};
    var data = root.ColonBrowserData.get();
    var variant = opts.variant || 'full';
    var subs = {}, pages = {}, session = null, settings = null, bookmarks = [], el, runner, timer, abortNav = null, sideOpen = variant === 'full' && innerWidth >= 1100, destroyed = false, recentHist = [];

    function emit(ev) { (subs[ev] || []).forEach(function (f) { try { f(api.state()); } catch (e) {} }); }
    function on(ev, f) { (subs[ev] = subs[ev] || []).push(f); }
    function active() { return session.tabs.filter(function (t) { return t.id === session.active_id; })[0] || session.tabs[0]; }
    function newTabObj(url) { return { id: C.uid('t'), url: url || 'colon://newtab', title: url ? U.displayUrl(url) : 'New tab', back: [], fwd: [] }; }
    var persist = C.debounce(function () { if (session && !destroyed) data.saveSession(session).catch(function () {}); }, 400);
    function changed() { persist(); renderTabs(); renderToolbar(); renderMode(); renderSide(); renderStatus(); emit('change'); }

    /* ---------- Skeleton ---------- */
    el = document.createElement('div');
    el.className = 'cb cb--' + variant;
    el.innerHTML =
      '<div class="cb-tabs no-scrollbar" role="tablist" aria-label="Tabs"></div>' +
      '<div class="cb-toolbar">' +
        '<div class="cb-nav"><button class="icon-btn sm" data-a="back" aria-label="Back" data-tip="Back">' + icon('left') + '</button>' +
        '<button class="icon-btn sm" data-a="forward" aria-label="Forward" data-tip="Forward">' + icon('right') + '</button>' +
        '<button class="icon-btn sm" data-a="reload" aria-label="Refresh" data-tip="Refresh">' + icon('refresh') + '</button>' +
        '<button class="icon-btn sm cb-hide-xs" data-a="home" aria-label="Home" data-tip="Home">' + icon('home') + '</button></div>' +
        '<form class="cb-address" role="search"><span class="cb-lock" aria-hidden="true"></span>' +
          '<input type="text" inputmode="url" enterkeyhint="go" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search or enter address" placeholder="Search or enter URL…">' +
          '<button type="button" class="icon-btn sm cb-clear" data-a="clear" aria-label="Clear address">' + icon('x') + '</button>' +
          '<div class="cb-suggest menu" role="listbox" hidden></div></form>' +
        '<div class="cb-actions">' +
          '<button class="icon-btn sm" data-a="bookmark" aria-label="Bookmark this page" data-tip="Bookmark">' + icon('bookmark') + '</button>' +
          '<button class="icon-btn sm cb-hide-sm" data-a="download" aria-label="Download page" data-tip="Download page">' + icon('download') + '</button>' +
          '<button class="icon-btn sm cb-tabcount" data-a="tabs" aria-label="Tabs" data-tip="Tabs"><span>1</span></button>' +
          '<button class="icon-btn sm cb-hide-sm" data-a="fullscreen" aria-label="Full screen" data-tip="Full screen">' + icon('maximize') + '</button>' +
          '<button class="icon-btn sm cb-side-btn" data-a="side" aria-label="Browser control and AI Browse" aria-pressed="false" data-tip="Browser control">' + icon('sparkles') + '</button>' +
          '<button class="icon-btn sm" data-a="more" aria-label="More" aria-haspopup="menu" data-tip="More">' + icon('moreV') + '</button>' +
        '</div></div>' +
      '<div class="cb-modebar" role="status" aria-live="polite"></div>' +
      '<div class="cb-body"><div class="cb-viewport scroll-y" tabindex="-1"></div>' +
        '<aside class="cb-side scroll-y" aria-label="Browser control and AI Browse"></aside></div>' +
      '<div class="cb-status"></div>' +
      '<div class="cb-progress"><i></i></div>';
    var $ = function (s) { return el.querySelector(s); };
    var input = $('.cb-address input'), vp = $('.cb-viewport'), side = $('.cb-side');
    container.appendChild(el);

    /* ---------- Saga runner ---------- */
    runner = root.ColonSagaBrowse.create({
      data: data,
      driver: {
        navigate: function (url, o) { return load(url, { by: 'ai', signal: o.signal, push: true }); },
        search: function (q, o) {
          var url = U.searchUrl(q, settings.engine);
          return load(url, { by: 'ai', signal: o.signal, push: true }).then(function (p) { return p.search || { results: [] }; });
        }
      },
      needsApproval: function () { return session.control === 'shared'; }
    });
    runner.on(function (t) {
      if (session) { session.task = t; persist(); }
      renderSide(); renderMode(); renderStatus(); emit('change'); emit('task');
    });

    /* ---------- Navigation ---------- */
    function navigate(raw, o) {
      o = o || {};
      if (session.control === 'ai' && runner.isActive() && o.by !== 'ai' && !o.force) {
        C.toast('Saga is in control. Tap Take control to browse yourself.', '', { label: 'Take control', fn: takeControl });
        return Promise.resolve(null);
      }
      var p = U.parseInput(raw, settings.engine); if (!p) return Promise.resolve(null);
      input.blur(); hideSuggest();
      return load(p.url, Object.assign({ push: true }, o)).catch(function () { return null; });
    }
    // Loads url into the active tab. Resolves with the page, rejects on error (AI driver needs that).
    function load(url, o) {
      o = o || {};
      var tab = active();
      if (o.push && tab.url && tab.url !== url) { tab.back.push(tab.url); if (tab.back.length > 50) tab.back.shift(); tab.fwd = []; }
      tab.url = url; tab.title = /^colon:/.test(url) ? internalTitle(url) : U.displayUrl(url);
      if (abortNav) abortNav.abort();
      var ctl = new AbortController(); abortNav = ctl;
      if (o.signal) o.signal.addEventListener('abort', function () { ctl.abort(); });
      pages[tab.id] = { status: 'loading', url: url, by: o.by || 'user' };
      changed(); renderViewport();
      var q = U.queryFrom(url);
      var job;
      if (/^colon:/.test(url)) job = Promise.resolve({ internal: url, title: internalTitle(url), url: url });
      else if (q) job = data.search(q, settings.engine, { signal: ctl.signal }).then(function (s) { return { url: url, title: q + ' · Search', search: s }; });
      else job = data.fetchPage(url, { signal: ctl.signal });
      return job.then(function (page) {
        if (ctl.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (page.url && page.url !== url && !/^colon:/.test(url) && !q) tab.url = page.url;
        tab.title = page.title || tab.title;
        pages[tab.id] = { status: 'ready', url: tab.url, page: page, by: o.by || 'user' };
        if (!/^colon:/.test(tab.url)) data.addHistory({ url: tab.url, title: tab.title }).catch(function () {});
        changed(); renderViewport(); vp.scrollTop = 0;
        if (abortNav === ctl) abortNav = null;
        return page;
      }, function (e) {
        if (e.name === 'AbortError') { if (abortNav === ctl) abortNav = null; throw e; }
        pages[tab.id] = { status: 'error', url: url, error: e, by: o.by || 'user' };
        tab.title = U.displayUrl(url) || 'Page not available';
        if (!/^colon:/.test(url)) data.addHistory({ url: url, title: tab.title }).catch(function () {});
        changed(); renderViewport();
        if (abortNav === ctl) abortNav = null;
        throw e;
      });
    }
    function internalTitle(u) { return ({ 'colon://newtab': 'New tab', 'colon://home': 'Home' })[u] || 'Colon'; }
    function guardUser() { if (session.control === 'ai' && runner.isActive()) { C.toast('Saga is in control. Take control to browse yourself.', '', { label: 'Take control', fn: takeControl }); return false; } return true; }
    function back() { if (!guardUser()) return; var t = active(); if (!t.back.length) return; t.fwd.push(t.url); load(t.back.pop()).catch(function () {}); }
    function forward() { if (!guardUser()) return; var t = active(); if (!t.fwd.length) return; t.back.push(t.url); load(t.fwd.pop()).catch(function () {}); }
    function reload() { if (!guardUser()) return; load(active().url).catch(function () {}); }
    function home() { if (!guardUser()) return; navigate(settings.homepage || 'colon://newtab'); }
    function newTab(url) {
      var t = newTabObj(); session.tabs.push(t); session.active_id = t.id; changed();
      if (url) return navigate(url, { force: true }); renderViewport(); setTimeout(function () { input.focus(); }, 30); return Promise.resolve(null);
    }
    function closeTab(id) {
      var i = session.tabs.findIndex(function (t) { return t.id === id; }); if (i < 0) return;
      session.tabs.splice(i, 1); delete pages[id];
      if (!session.tabs.length) session.tabs.push(newTabObj());
      if (session.active_id === id) session.active_id = (session.tabs[i] || session.tabs[i - 1] || session.tabs[0]).id;
      changed(); ensureLoaded();
    }
    function switchTab(id) { if (!session.tabs.some(function (t) { return t.id === id; })) return; session.active_id = id; changed(); ensureLoaded(); }
    function ensureLoaded() { var t = active(); if (!pages[t.id]) load(t.url).catch(function () {}); else renderViewport(); }

    /* ---------- Control modes & handoff ---------- */
    function setControl(m) {
      if (!MODES[m] || session.control === m) return;
      var prev = session.control; session.control = m;
      if (m === 'manual' && runner.isActive()) runner.pause('handoff');
      else if (m !== 'manual' && prev === 'manual' && runner.state() && runner.state().status === 'paused') runner.resume();
      el.setAttribute('data-control', m); changed();
      C.toast(m === 'manual' ? 'Manual mode. You have control.' : m === 'ai' ? 'AI mode. Saga can browse for you.' : 'Shared mode. Saga will ask before each action.');
    }
    function takeControl() {
      // Safe handoff: pause pending automation FIRST, then hand over.
      if (runner.isActive()) runner.pause('handoff');
      if (abortNav && pages[active().id] && pages[active().id].by === 'ai') abortNav.abort();
      if (session.control !== 'manual') { session.control = 'manual'; el.setAttribute('data-control', 'manual'); changed(); }
      C.toast('You have control. Saga paused all pending actions.', 'ok');
    }
    function returnToAI() { session.control = 'ai'; el.setAttribute('data-control', 'ai'); var s = runner.state(); if (s && s.status === 'paused') runner.resume(); changed(); C.toast('Control returned to Saga.'); }
    function pauseAI() { var s = runner.state(); if (s && s.status === 'paused') runner.resume(); else runner.pause('user'); }
    function stopTask() { runner.stop(); }
    function startTask(goal) {
      goal = String(goal || '').trim(); if (!goal) return;
      if (session.control === 'manual') { session.control = 'ai'; el.setAttribute('data-control', 'ai'); }
      toggleSide(true); runner.start(goal); changed();
    }

    /* ---------- Rendering ---------- */
    function renderTabs() {
      var box = $('.cb-tabs');
      box.innerHTML = session.tabs.map(function (t) {
        var on = t.id === session.active_id, pg = pages[t.id];
        return '<div class="cb-tab' + (on ? ' on' : '') + '" role="tab" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-tab="' + t.id + '">' +
          (pg && pg.status === 'loading' ? '<span class="spin dark" style="width:14px;height:14px"></span>' : '<span class="cb-fav" style="background:' + favColor(t.url) + '">' + esc(favLetter(t)) + '</span>') +
          '<span class="cb-tab-t">' + esc(t.title || 'New tab') + '</span><button class="cb-tab-x" data-close-tab="' + t.id + '" aria-label="Close tab ' + esc(t.title) + '">' + icon('x') + '</button></div>';
      }).join('') + '<button class="icon-btn sm cb-newtab" data-a="newtab" aria-label="New tab" data-tip="New tab">' + icon('plus') + '</button>';
      $('.cb-tabcount span').textContent = session.tabs.length;
    }
    function favLetter(t) { if (/^colon:/.test(t.url)) return 'C'; return siteLetter(t.url); }
    function favColor(u) { if (/^colon:/.test(u)) return 'var(--primary)'; var h = U.hostOf(u), n = 0; for (var i = 0; i < h.length; i++) n = (n * 31 + h.charCodeAt(i)) >>> 0; return 'hsl(' + (n % 360) + ' 62% 46%)'; }

    function renderToolbar() {
      var t = active(), pg = pages[t.id];
      if (document.activeElement !== input) input.value = /^colon:\/\/newtab/.test(t.url) ? '' : (U.queryFrom(t.url) || t.url);
      $('[data-a=back]').disabled = !t.back.length; $('[data-a=forward]').disabled = !t.fwd.length;
      var lock = $('.cb-lock');
      lock.innerHTML = /^colon:/.test(t.url) ? icon('search') : U.isSecure(t.url) ? icon('lock') : icon('alert');
      lock.className = 'cb-lock ' + (/^colon:/.test(t.url) ? '' : U.isSecure(t.url) ? 'secure' : 'insecure');
      var bm = bookmarks.filter(function (b) { return b.url === t.url; })[0];
      var bb = $('[data-a=bookmark]'); bb.innerHTML = icon(bm ? 'bookmarkFill' : 'bookmark'); bb.setAttribute('aria-pressed', !!bm); bb.disabled = /^colon:/.test(t.url);
      $('[data-a=download]').disabled = !(pg && pg.status === 'ready' && pg.page && pg.page.html);
      $('[data-a=side]').setAttribute('aria-pressed', sideOpen);
      var prog = $('.cb-progress'); prog.classList.toggle('on', !!(pg && pg.status === 'loading'));
    }

    function renderMode() {
      var m = session.control, t = runner.state(), bar = $('.cb-modebar');
      el.setAttribute('data-control', m);
      var activity = '';
      if (t && /planning|running|awaiting_approval|paused/.test(t.status)) {
        var cur = t.steps.filter(function (s) { return /running|awaiting/.test(s.status); })[0];
        activity = t.status === 'paused' ? 'Paused' + (t.pause_reason === 'handoff' ? ' · you have control' : '') : t.status === 'awaiting_approval' ? 'Waiting for your approval' : (cur ? cur.label : t.status === 'planning' ? 'Planning…' : 'Working… ' + t.progress + '%');
      }
      bar.innerHTML = '<span class="cb-mode-ico">' + icon(MODES[m].icon) + '</span><b>' + MODES[m].label + (m === 'manual' ? ' Mode' : m === 'shared' ? ' Mode' : '') + '</b>' +
        '<span class="cb-mode-desc">' + esc(activity || MODES[m].desc) + '</span>' +
        (t && /running|planning/.test(t.status) ? '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span>' : '') +
        '<span class="cb-mode-acts">' +
        (m !== 'manual' ? '<button class="btn xs" data-a="take">' + icon('hand') + 'Take control</button>' : (t && t.status === 'paused' ? '<button class="btn xs primary" data-a="return">' + icon('sparkles') + 'Return to AI</button>' : '')) +
        '</span>';
    }

    function renderSide() {
      var m = session.control, t = runner.state(), tab = active();
      el.classList.toggle('side-open', sideOpen);
      var running = t && /planning|running|awaiting_approval|paused/.test(t.status);
      var html = '<div class="cb-panel"><div class="cb-panel-head"><b>Browser Control</b><button class="icon-btn sm" data-a="side-close" aria-label="Close panel">' + icon('x') + '</button></div>' +
        '<div class="cb-modes" role="radiogroup" aria-label="Control mode">' +
        ['ai', 'manual', 'shared'].map(function (k) { return '<button type="button" role="radio" aria-checked="' + (m === k) + '" class="cb-mode-btn m-' + k + (m === k ? ' on' : '') + '" data-mode="' + k + '">' + icon(MODES[k].icon) + MODES[k].label + '</button>'; }).join('') + '</div>' +
        '<p class="tiny muted" style="margin:8px 2px 0">' + esc(MODES[m].desc) + '</p>' +
        '<div class="cb-session"><span class="status-dot' + (running ? ' live' : '') + '"></span><div><b>Active session</b><div class="tiny muted cb-ellipsis">' + esc(/^colon:/.test(tab.url) ? 'New tab' : tab.url) + '</div></div></div>' +
        '<div class="cb-ctl-btns">' +
        '<button class="btn sm ' + (m !== 'manual' ? 'primary' : '') + '" data-a="take"' + (m === 'manual' ? ' disabled' : '') + '>' + icon('hand') + 'Take Control</button>' +
        '<button class="btn sm" data-a="return"' + (m === 'ai' ? ' disabled' : '') + '>' + icon('sparkles') + 'Return to AI</button>' +
        '<button class="btn sm" data-a="pause"' + (!running || m === 'manual' ? ' disabled' : '') + '>' + icon(t && t.status === 'paused' ? 'play' : 'pause') + (t && t.status === 'paused' ? 'Resume AI' : 'Pause AI') + '</button>' +
        '<button class="btn sm danger" data-a="stop"' + (!running ? ' disabled' : '') + '>' + icon('stop') + 'Stop task</button>' +
        '<button class="btn sm" data-a="fullscreen">' + icon('maximize') + 'Full Screen</button></div></div>';
      html += '<div class="cb-panel cb-ai"><div class="cb-panel-head"><b>' + icon('sparkles') + ' AI Browse</b>' + (t ? '<span class="badge ' + statusBadge(t.status) + '">' + statusLabel(t.status) + '</span>' : '') + '</div>';
      var formHtml = '';
      if (!t || /done|stopped|error/.test(t.status)) {
        formHtml = '<form class="cb-task-form"' + (t ? ' style="margin-top:14px"' : '') + '><label class="label" for="cb-goal-' + variant + '">What should Saga find?</label>' +
          '<textarea class="textarea" id="cb-goal-' + variant + '" rows="2" maxlength="300" placeholder="e.g. Research the history of Lagos and its economy"></textarea>' +
          '<button class="btn primary sm block" type="submit">' + icon('sparkles') + 'Start AI Browse</button>' +
          '<p class="tiny muted" style="margin:0">Saga searches and reads pages in reader preview and logs every action. ' + (m === 'shared' ? 'Shared mode: you approve each step.' : 'Switch to Shared to approve each step.') + '</p></form>';
      }
      if (!t) html += formHtml;
      if (t) {
        var cur = t.steps.filter(function (s) { return /running|awaiting/.test(s.status); })[0];
        html += '<div class="cb-task"><div class="tiny muted">Current task</div><div class="cb-task-goal">' + esc(t.goal) + '</div>' +
          '<div class="cb-kv"><span>Website</span><b class="cb-ellipsis">' + esc(t.site || '—') + '</b></div>' +
          '<div class="cb-kv"><span>Progress</span><b>' + t.progress + '%</b></div><div class="progress"><i style="width:' + t.progress + '%"></i></div>';
        if (t.status === 'awaiting_approval' && cur) {
          html += '<div class="cb-approve" role="alertdialog" aria-label="Approval needed"><div class="tiny" style="font-weight:700;color:var(--cyan)">Saga wants to</div><div>' + esc(cur.label) + (cur.url ? '<div class="tiny muted cb-ellipsis">' + esc(cur.url) + '</div>' : '') + '</div>' +
            '<div class="cb-approve-btns"><button class="btn xs primary" data-a="approve">' + icon('check') + 'Approve</button><button class="btn xs" data-a="skip">Skip</button><button class="btn xs" data-a="take">' + icon('hand') + 'Take control</button></div></div>';
        }
        html += '<ol class="cb-steps">' + t.steps.map(function (s) { return '<li class="st-' + s.status + '"><span class="cb-step-ico">' + stepIcon(s.status) + '</span><span>' + esc(s.label) + (s.error ? '<span class="tiny" style="display:block;color:var(--bad)">' + esc(s.error) + '</span>' : '') + '</span></li>'; }).join('') + '</ol>';
        if (t.error) html += '<div class="banner bad" style="margin:10px 0 0">' + icon('alert') + '<span>' + esc(t.error) + '</span></div>';
        if (t.summary) {
          html += '<div class="cb-summary md">' + root.ColonMarkdown.render(t.summary, { sources: t.sources }) + '</div>' +
            (opts.onSummary ? '<button class="btn sm secondary block" data-a="send-summary" style="margin-top:8px">' + icon('send') + 'Add to chat</button>' : '');
        }
        if (t.sources.length) html += '<div class="cb-sub">Sources discovered (' + t.sources.length + ')</div><div class="cb-sources">' + t.sources.map(function (s) { return '<a href="' + esc(s.url) + '" data-nav="' + esc(s.url) + '"><span class="cb-src-n">' + s.n + '</span><span><b>' + esc(s.title) + '</b><span class="tiny muted cb-ellipsis">' + esc(U.hostOf(s.url)) + '</span></span></a>'; }).join('') + '</div>';
        html += '<div class="cb-sub">Actions performed (' + t.actions.length + ')</div><ol class="cb-log">' + t.actions.slice().reverse().map(function (a) { return '<li class="lg-' + a.kind + '"><time>' + new Date(a.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</time>' + esc(a.text) + '</li>'; }).join('') + '</ol>';
        if (running) html += '<div class="cb-ctl-btns two"><button class="btn sm" data-a="pause">' + icon(t.status === 'paused' ? 'play' : 'pause') + (t.status === 'paused' ? 'Resume' : 'Pause') + '</button><button class="btn sm danger" data-a="stop">' + icon('stop') + 'Stop</button></div>';
        else html += '<button class="btn sm ghost block" data-a="clear-task" style="margin-top:8px">Clear task</button>';
        html += '</div>' + formHtml;
      }
      html += '</div>';
      var keep = side.querySelector('textarea'), kv = keep ? keep.value : '', focus = keep && document.activeElement === keep;
      side.innerHTML = html;
      var ta = side.querySelector('textarea'); if (ta) { ta.value = kv; if (focus) ta.focus(); }
    }
    function statusLabel(s) { return { planning: 'Planning', running: 'Running', paused: 'Paused', awaiting_approval: 'Needs approval', done: 'Done', stopped: 'Stopped', error: 'Ended' }[s] || s; }
    function statusBadge(s) { return { running: 'primary', planning: 'primary', paused: 'warn', awaiting_approval: 'cyan', done: 'ok', stopped: '', error: 'bad' }[s] || ''; }
    function stepIcon(s) { return s === 'done' ? icon('check') : s === 'running' ? '<span class="spin dark" style="width:14px;height:14px"></span>' : s === 'failed' ? icon('x') : s === 'skipped' ? icon('right') : s === 'awaiting' ? icon('hand') : '<i></i>'; }

    function renderStatus() {
      var t = active(), s = $('.cb-status'), task = runner.state();
      var secure = /^colon:/.test(t.url) || U.isSecure(t.url);
      s.innerHTML = '<span class="status-dot ' + (secure ? '' : 'warn') + '"></span><span>' + (secure ? 'Browsing securely' : 'Not secure (http)') + '</span>' +
        '<span class="badge cb-engine" data-tip="Web reader preview: text and images only. Full browsing runs in the Colon Android app.">' + icon('reader') + 'Reader preview</span>' +
        (task && /running|planning/.test(task.status) ? '<span class="badge primary">' + icon('sparkles') + 'Saga active</span>' : '') +
        '<span class="cb-timer">' + icon('clock') + '<span data-timer>Session: ' + elapsed() + '</span></span>';
    }
    function elapsed() { var s = Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + 'h ' : '') + m + 'm ' + (s % 60) + 's'; }

    function renderViewport() {
      var t = active(), pg = pages[t.id];
      vp.setAttribute('aria-busy', pg && pg.status === 'loading' ? 'true' : 'false');
      if (!pg || pg.status === 'loading') {
        if (/^colon:/.test(t.url)) { vp.innerHTML = newTabPage(); bindNewTab(); return; }
        vp.innerHTML = '<div class="cb-loading"><div class="skel" style="height:34px;width:60%"></div><div class="skel" style="height:14px;margin-top:18px"></div><div class="skel" style="height:14px;margin-top:10px;width:92%"></div><div class="skel" style="height:14px;margin-top:10px;width:80%"></div><div class="skel" style="height:180px;margin-top:22px"></div><p class="tiny muted" style="margin-top:14px">' + (pg && pg.by === 'ai' ? 'Saga is opening ' : 'Opening ') + esc(U.displayUrl(t.url)) + '…</p></div>';
        return;
      }
      if (pg.status === 'error') { vp.innerHTML = errorPage(t.url, pg.error); return; }
      var p = pg.page;
      if (p.internal) { vp.innerHTML = newTabPage(); bindNewTab(); return; }
      if (p.search) { vp.innerHTML = searchPage(p.search); return; }
      vp.innerHTML = '<article class="cb-reader" data-size="' + esc(settings.readerFont) + '"><header class="cb-reader-head"><span class="badge">' + icon('reader') + 'Reader preview</span><span class="tiny muted">' + esc(p.source || U.hostOf(p.url)) + '</span>' +
        '<a class="btn xs ghost" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">' + icon('external') + 'Original</a></header>' +
        '<h1>' + esc(p.title) + '</h1><div class="cb-reader-body">' + p.html + '</div></article>';
    }
    function newTabPage() {
      var recent = recentHist.slice(0, 5);
      return '<div class="cb-home"><div class="cb-home-logo">' + C.logo('COLON', 'BROWSER', 'lg') + '</div>' +
        '<form class="cb-home-search" role="search">' + icon('search') + '<input type="search" enterkeyhint="search" aria-label="Search or enter address" placeholder="Search or enter URL…"><button class="btn primary sm pill" type="submit">Go</button></form>' +
        '<div class="cb-quick">' + QUICK.map(function (q) { return '<button type="button" data-go="' + esc(q.u) + '"><span class="cb-fav lg" style="background:' + q.c + '">' + esc(q.t[0]) + '</span><span>' + esc(q.t) + '</span></button>'; }).join('') + '</div>' +
        (recent.length ? '<div class="cb-sub">Recently visited</div><div class="cb-recent">' + recent.map(function (h) { return '<button type="button" data-go="' + esc(h.url) + '"><span class="cb-fav" style="background:' + favColor(h.url) + '">' + esc(siteLetter(h.url)) + '</span><span class="cb-ellipsis">' + esc(h.title) + '</span></button>'; }).join('') + '</div>' : '') +
        '<div class="banner info cb-engine-note">' + icon('info') + '<span><b>Web reader preview.</b> Pages that allow it open here as clean, script-free text. Others open in a new tab. Full browsing with logins runs in the Colon Android app.</span></div></div>';
    }
    function bindNewTab() {
      var f = vp.querySelector('.cb-home-search');
      if (f) f.addEventListener('submit', function (e) { e.preventDefault(); navigate(f.querySelector('input').value); });
    }
    function searchPage(s) {
      return '<div class="cb-results"><div class="cb-results-head"><div><div class="tiny muted">Results for</div><h1>' + esc(s.query) + '</h1></div>' +
        '<a class="btn sm" href="' + esc(s.external) + '" target="_blank" rel="noopener noreferrer">' + icon('external') + 'Search on ' + esc((U.ENGINES[s.engine] || U.ENGINES.google).name) + '</a></div>' +
        '<p class="tiny muted">Reader preview searches ' + esc(s.provider) + ', which allows web apps to read its results. Full ' + esc((U.ENGINES[s.engine] || U.ENGINES.google).name) + ' results open in a new tab.</p>' +
        (s.results.length ? s.results.map(function (r) { return '<a class="cb-result" href="' + esc(r.url) + '" data-nav="' + esc(r.url) + '"><span class="tiny muted">' + esc(U.displayUrl(r.url)) + '</span><b>' + esc(r.title) + '</b><span class="small">' + esc(r.snippet) + '</span></a>'; }).join('')
          : '<div class="empty">' + icon('search') + '<div class="h3">No results</div><p class="small">Try different words, or search on ' + esc((U.ENGINES[s.engine] || U.ENGINES.google).name) + '.</p></div>') + '</div>';
    }
    function errorPage(url, e) {
      var code = (e && e.code) || '', blocked = /^blocked/.test(code), proxy = code === 'needs_proxy', file = code === 'not_html';
      var title = blocked ? 'This address is blocked' : proxy ? 'Can’t open this site in reader preview' : file ? 'This link is a file' : code === 'timeout' ? 'The page took too long' : code === 'not_found' ? 'Page not found' : 'This page didn’t load';
      return '<div class="cb-error"><span class="cb-error-ico">' + icon(blocked ? 'shield' : proxy ? 'reader' : file ? 'download' : 'wifiOff') + '</span><h1>' + esc(title) + '</h1>' +
        '<p class="muted">' + esc((e && e.message) || 'Something went wrong.') + '</p><div class="cb-url mono">' + esc(U.displayUrl(url)) + '</div><div class="cb-error-acts">' +
        (!blocked ? '<button class="btn sm" data-a="reload">' + icon('refresh') + 'Try again</button>' : '') +
        (!blocked ? '<a class="btn sm primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + icon('external') + (file ? 'Download file' : 'Open in new tab') + '</a>' : '') +
        (proxy && opts.onAsk ? '<button class="btn sm" data-a="ask">' + icon('sparkles') + 'Ask Saga about it</button>' : '') +
        '</div>' + (proxy ? '<p class="tiny muted" style="margin-top:16px">Full browsing of every site comes with the Colon Android app (Android WebView engine).</p>' : '') + '</div>';
    }

    /* ---------- Suggestions ---------- */
    var suggestBox = $('.cb-suggest');
    var suggest = C.debounce(function () {
      var q = input.value.trim().toLowerCase(); if (!q) return hideSuggest();
      data.listHistory({ q: q, limit: 30 }).then(function (h) {
        var seen = {}, items = bookmarks.filter(function (b) { return (b.title + b.url).toLowerCase().indexOf(q) > -1; }).map(function (b) { return { url: b.url, title: b.title, k: 'bookmark' }; })
          .concat(h.map(function (x) { return { url: x.url, title: x.title, k: 'history' }; }))
          .filter(function (x) { if (seen[x.url]) return false; seen[x.url] = 1; return true; }).slice(0, 6);
        var p = U.parseInput(input.value, settings.engine);
        var first = p ? '<button type="button" class="mi" role="option" data-go-input>' + icon(p.type === 'url' ? 'globe' : 'search') + '<span class="mi-body">' + esc(p.type === 'url' ? U.displayUrl(p.url) : input.value) + '<span class="mi-sub">' + (p.type === 'url' ? 'Open address' : 'Search') + '</span></span></button>' : '';
        suggestBox.innerHTML = first + items.map(function (x) { return '<button type="button" class="mi" role="option" data-go="' + esc(x.url) + '">' + icon(x.k === 'bookmark' ? 'bookmark' : 'history') + '<span class="mi-body cb-ellipsis">' + esc(x.title) + '<span class="mi-sub cb-ellipsis">' + esc(U.displayUrl(x.url)) + '</span></span></button>'; }).join('');
        suggestBox.hidden = !suggestBox.innerHTML;
      });
    }, 120);
    function hideSuggest() { suggestBox.hidden = true; }

    /* ---------- Events ---------- */
    $('.cb-address').addEventListener('submit', function (e) { e.preventDefault(); navigate(input.value); });
    input.addEventListener('focus', function () { setTimeout(function () { input.select(); }, 0); el.classList.add('addr-focus'); });
    input.addEventListener('blur', function () { el.classList.remove('addr-focus'); setTimeout(hideSuggest, 150); setTimeout(renderToolbar, 160); });
    input.addEventListener('input', suggest);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { hideSuggest(); input.blur(); }
      if (e.key === 'ArrowDown' && !suggestBox.hidden) { e.preventDefault(); var f = suggestBox.querySelector('.mi'); if (f) f.focus(); }
    });
    suggestBox.addEventListener('keydown', function (e) {
      var b = Array.prototype.slice.call(suggestBox.querySelectorAll('.mi')), i = b.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (b[i + 1] || b[0]).focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); i <= 0 ? input.focus() : b[i - 1].focus(); } else if (e.key === 'Escape') { input.focus(); hideSuggest(); }
    });
    suggestBox.addEventListener('mousedown', function (e) { e.preventDefault(); });

    el.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); navigate(go.getAttribute('data-go')); return; }
      if (e.target.closest('[data-go-input]')) { navigate(input.value); return; }
      var nav = e.target.closest('a[data-nav]');
      if (nav && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); navigate(nav.getAttribute('data-nav')); return; }
      var x = e.target.closest('[data-close-tab]'); if (x) { e.stopPropagation(); closeTab(x.getAttribute('data-close-tab')); return; }
      var tb = e.target.closest('[data-tab]'); if (tb) { switchTab(tb.getAttribute('data-tab')); return; }
      var md = e.target.closest('[data-mode]'); if (md) { setControl(md.getAttribute('data-mode')); return; }
      var a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
      var act = a.getAttribute('data-a');
      var acts = {
        back: back, forward: forward, reload: reload, home: home, newtab: function () { newTab(); },
        clear: function () { input.value = ''; input.focus(); hideSuggest(); },
        bookmark: bookmarkCurrent, download: downloadCurrent, fullscreen: toggleFullscreen,
        tabs: function () { if (opts.onNavigateApp && variant === 'full' && innerWidth < 900) opts.onNavigateApp('tabs'); else tabsMenu(a); },
        side: function () { toggleSide(); }, 'side-close': function () { toggleSide(false); },
        more: function () { moreMenu(a); }, take: takeControl, 'return': returnToAI, pause: pauseAI, stop: stopTask,
        approve: function () { runner.approve(); }, skip: function () { runner.skip(); }, 'clear-task': function () { runner.reset(); session.task = null; persist(); },
        'send-summary': function () { var t = runner.state(); if (t && opts.onSummary) opts.onSummary(t.summary, t.sources, t.goal); },
        ask: function () { if (opts.onAsk) opts.onAsk(active().url); }
      };
      if (acts[act]) acts[act]();
    });
    side.addEventListener('submit', function (e) {
      if (!e.target.classList.contains('cb-task-form')) return;
      e.preventDefault(); var v = e.target.querySelector('textarea').value; if (!v.trim()) { e.target.querySelector('textarea').focus(); return; }
      startTask(v);
    });
    side.addEventListener('keydown', function (e) { if (e.target.tagName === 'TEXTAREA' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); } });
    el.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); input.focus(); }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); forward(); }
      var tabs = e.target.closest && e.target.closest('[data-tab]');
      if (tabs && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { var i = session.tabs.findIndex(function (t) { return t.id === session.active_id; }); var n = session.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + session.tabs.length) % session.tabs.length]; switchTab(n.id); var f = el.querySelector('[data-tab="' + n.id + '"]'); if (f) f.focus(); }
    });
    document.addEventListener('fullscreenchange', function () { el.classList.toggle('cb-fs', document.fullscreenElement === el); });

    function tabsMenu(anchor) {
      C.menu(anchor, [{ head: session.tabs.length + ' tabs' }].concat(session.tabs.map(function (t) { return { label: t.title || 'New tab', sub: /^colon:/.test(t.url) ? '' : U.displayUrl(t.url), icon: 'globe', checked: t.id === session.active_id, onClick: function () { switchTab(t.id); } }; }), ['-', { label: 'New tab', icon: 'plus', onClick: function () { newTab(); } }, { label: 'Close this tab', icon: 'x', onClick: function () { closeTab(session.active_id); } }]), { align: 'right', label: 'Tabs' });
    }
    function moreMenu(anchor) {
      var t = active(), app = opts.onNavigateApp;
      var items = [{ label: 'New tab', icon: 'plus', onClick: function () { newTab(); } },
        { label: 'Copy link', icon: 'link', disabled: /^colon:/.test(t.url), onClick: function () { C.copyText(t.url).then(function () { C.toast('Link copied.'); }); } },
        { label: 'Open original in new tab', icon: 'external', disabled: /^colon:/.test(t.url), onClick: function () { window.open(t.url, '_blank', 'noopener'); } },
        { label: 'Download page', icon: 'download', onClick: downloadCurrent },
        { label: 'Full screen', icon: 'maximize', onClick: toggleFullscreen }];
      if (app) items.push('-', { label: 'Bookmarks', icon: 'bookmark', onClick: function () { app('bookmarks'); } }, { label: 'History', icon: 'history', onClick: function () { app('history'); } }, { label: 'Downloads', icon: 'download', onClick: function () { app('downloads'); } }, { label: 'Settings', icon: 'settings', onClick: function () { app('settings'); } });
      C.menu(anchor, items, { align: 'right', label: 'More' });
    }

    function bookmarkCurrent() {
      var t = active(); if (/^colon:/.test(t.url)) return;
      var bm = bookmarks.filter(function (b) { return b.url === t.url; })[0];
      if (bm) return api.editBookmark(bm);
      data.addBookmark({ url: t.url, title: t.title }).then(function (b) { return refreshBookmarks().then(function () { C.toast('Bookmarked.', 'ok', { label: 'Edit', fn: function () { api.editBookmark(b); } }); }); })
        .catch(function (e) { C.toast(e.message, 'bad'); });
    }
    function downloadCurrent() {
      var t = active(), pg = pages[t.id]; if (!pg || !pg.page || !pg.page.html) return C.toast('Nothing to download on this page.');
      var name = (pg.page.title || U.hostOf(t.url) || 'page').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) + '.html';
      var doc = '<!doctype html><meta charset="utf-8"><title>' + esc(pg.page.title) + '</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:40px auto;padding:0 16px}img{max-width:100%;height:auto}</style><p><small>Saved by Colon Browser from <a href="' + esc(t.url) + '">' + esc(t.url) + '</a></small></p><h1>' + esc(pg.page.title) + '</h1>' + pg.page.html;
      var blob = new Blob([doc], { type: 'text/html' });
      data.addDownload({ name: name, type: 'text/html', size: blob.size, url: t.url, status: 'complete', blob: blob }).then(function () { saveBlob(blob, name); C.toast('Saved to Downloads.', 'ok', opts.onNavigateApp ? { label: 'View', fn: function () { opts.onNavigateApp('downloads'); } } : null); emit('downloads'); })
        .catch(function (e) { C.toast(e.message, 'bad'); });
    }
    function toggleFullscreen() {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (el.requestFullscreen) el.requestFullscreen().catch(function () { el.classList.toggle('cb-fs'); });
      else el.classList.toggle('cb-fs');
    }
    function toggleSide(force) { sideOpen = force === undefined ? !sideOpen : !!force; renderSide(); renderToolbar(); if (sideOpen && innerWidth < 900) { var f = side.querySelector('button,textarea'); if (f) setTimeout(function () { f.focus(); }, 60); } }
    function refreshBookmarks() { return data.listBookmarks().then(function (r) { bookmarks = r.bookmarks; renderToolbar(); }); }

    /* ---------- Boot ---------- */
    var ready = Promise.all([data.getSettings(), data.getSession().catch(function () { return null; }), refreshBookmarks().catch(function () {}), data.listHistory({ limit: 8 }).catch(function () { return []; })]).then(function (r) {
      settings = r[0];
      var s = r[1];
      if (s && settings.restoreSession && s.tabs && s.tabs.length) session = s;
      else session = { tabs: [newTabObj(settings.homepage !== 'colon://newtab' ? settings.homepage : null)], active_id: null, control: 'manual' };
      session.active_id = session.active_id || session.tabs[0].id;
      session.control = MODES[session.control] ? session.control : 'manual';
      session.started_at = session.started_at || new Date().toISOString();
      recentHist = r[3] || [];
      if (session.task) runner.restore(session.task);
      el.setAttribute('data-control', session.control);
      changed(); ensureLoaded();
      timer = setInterval(function () { var n = el.querySelector('[data-timer]'); if (n) n.textContent = 'Session: ' + elapsed(); }, 1000);
      return api;
    });

    var api = {
      ready: ready, el: el, navigate: function (u) { return ready.then(function () { return navigate(u, { force: true }); }); },
      back: back, forward: forward, reload: reload, home: home, newTab: newTab, closeTab: closeTab, switchTab: switchTab,
      setControl: setControl, takeControl: takeControl, returnToAI: returnToAI, pauseAI: pauseAI, stopTask: stopTask, startTask: function (g) { return ready.then(function () { startTask(g); }); },
      toggleSide: toggleSide, toggleFullscreen: toggleFullscreen, on: on, refreshBookmarks: refreshBookmarks, data: data,
      settings: function () { return settings; },
      reloadSettings: function () { return data.getSettings().then(function (s) { settings = s; renderViewport(); }); },
      state: function () { if (!session) return null; var t = active(); return { tabs: session.tabs.map(function (x) { return { id: x.id, url: x.url, title: x.title, active: x.id === session.active_id, status: pages[x.id] ? pages[x.id].status : 'idle' }; }), active: t && { id: t.id, url: t.url, title: t.title }, control: session.control, task: runner.state(), loading: !!(t && pages[t.id] && pages[t.id].status === 'loading') }; },
      page: function () { var t = active(); return t && pages[t.id] && pages[t.id].page; },
      mount: function (c) { if (c && el.parentNode !== c) c.appendChild(el); },  // re-parent: session and page state are kept
      editBookmark: function (bm) {
        data.listBookmarks().then(function (r) {
          C.sheet('<div class="h2">Edit bookmark</div><form class="form" style="margin-top:12px" novalidate>' +
            '<div class="field"><label for="bm-t">Title</label><input class="input" id="bm-t" maxlength="200" value="' + esc(bm.title) + '"></div>' +
            '<div class="field"><label for="bm-f">Folder</label><select class="select" id="bm-f"><option value="">No folder</option>' + r.folders.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === bm.folder_id ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select></div>' +
            '<div class="tiny muted mono cb-ellipsis">' + esc(bm.url) + '</div>' +
            '<div class="sheet-actions"><button type="button" class="btn danger" data-del>' + icon('trash') + 'Remove</button><button class="btn primary" type="submit">Save</button></div></form>', function (sh, close) {
            sh.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); data.updateBookmark(bm.id, { title: sh.querySelector('#bm-t').value.trim() || bm.url, folder_id: sh.querySelector('#bm-f').value || null }).then(function () { close(); C.toast('Bookmark saved.', 'ok'); refreshBookmarks(); emit('bookmarks'); }); });
            sh.querySelector('[data-del]').addEventListener('click', function () { data.removeBookmark(bm.id).then(function () { close(); C.toast('Bookmark removed.'); refreshBookmarks(); emit('bookmarks'); }); });
          }, { label: 'Edit bookmark' });
        });
      },
      destroy: function () { destroyed = true; clearInterval(timer); runner.stop(); el.remove(); }
    };
    return api;
  }

  // "en.wikipedia.org" -> "W", "punchng.com" -> "P"
  function siteLetter(u) { var parts = U.hostOf(u).split('.'); var name = parts.length > 2 ? parts[parts.length - 2] : parts[0]; return ((name || '•')[0] || '•').toUpperCase(); }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  root.ColonBrowser = { create: create, MODES: MODES, saveBlob: saveBlob };
})(window);
