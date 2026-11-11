/* Colon AI · secondary screens rendered inside the workspace: History, Saved, Explore, Help, and the
   "log in to see this" screen guests get for History, Saved and Settings. */
(function () {
  'use strict';
  var C = window.Colon, icon = C.icon, esc = C.esc;
  var CW = window.CW = window.CW || {};
  CW.pages = CW.pages || {};

  function group(list) {
    var day = 86400000, start = new Date(); start.setHours(0, 0, 0, 0);
    var t = start.getTime(), groups = [['Today', []], ['Yesterday', []], ['Previous 7 days', []], ['Previous 30 days', []], ['Older', []]];
    list.forEach(function (c) {
      var d = new Date(c.updated_at).getTime();
      var g = d >= t ? 0 : d >= t - day ? 1 : d >= t - 7 * day ? 2 : d >= t - 30 * day ? 3 : 4;
      groups[g][1].push(c);
    });
    return groups.filter(function (g) { return g[1].length; });
  }
  function rowHtml(c) {
    var m = CW.MODES[c.mode] || CW.MODES.general;
    return '<div class="hist-row"><a href="#/c/' + encodeURIComponent(c.id) + '" class="hist-main"><span class="hist-ico">' + icon(m.icon) + '</span><span class="hist-body"><b>' + (c.pinned ? icon('pin', 'cw-pin') : '') + esc(c.title) + '</b>' +
      '<small>' + esc(c.preview || 'No messages yet') + '</small></span><span class="hist-meta"><span class="badge">' + esc(m.label) + '</span><time>' + esc(C.ago(c.updated_at)) + '</time></span></a>' +
      '<button class="icon-btn sm" data-hist-menu="' + esc(c.id) + '" aria-label="Options for ' + esc(c.title) + '" aria-haspopup="menu">' + icon('more') + '</button></div>';
  }
  function listPage(page, o) {
    page.innerHTML = '<div class="cw-screen"><header class="cw-screen-head"><div><h1 class="h1">' + esc(o.title) + '</h1><p class="lead">' + esc(o.lead) + '</p></div>' +
      '<a class="btn primary sm" href="#/">' + icon('plus') + 'New chat</a></header>' +
      (o.filters ? '<div class="hist-tools"><label class="cw-search wide">' + icon('search') + '<input type="search" placeholder="Search your conversations…" aria-label="Search conversations" data-hq></label>' +
        '<div class="seg" role="group" aria-label="Filter">' + o.filters.map(function (f, i) { return '<button type="button" data-f="' + f[0] + '" aria-pressed="' + (i === 0) + '">' + f[1] + '</button>'; }).join('') + '</div></div>' : '') +
      '<div class="hist-list" aria-live="polite"><div class="skel" style="height:64px"></div><div class="skel" style="height:64px;margin-top:8px"></div><div class="skel" style="height:64px;margin-top:8px"></div></div></div>';
    var state = { q: '', f: o.filters ? o.filters[0][0] : null, list: [] };
    function load() {
      var box = page.querySelector('.hist-list');
      CW.data.listConversations({ q: state.q, archived: state.f === 'archived' ? true : o.archived || false }).then(function (list) {
        if (state.f === 'pinned' || o.pinnedOnly) list = list.filter(function (c) { return c.pinned; });
        state.list = list;
        if (!list.length) {
          box.innerHTML = '<div class="card empty">' + icon(o.emptyIcon) + '<div class="h3">' + esc(state.q ? 'No conversations match “' + state.q + '”' : o.emptyTitle) + '</div><p class="small">' + esc(state.q ? 'Try different words.' : o.emptyText) + '</p>' + (state.q ? '' : '<a class="btn primary" href="#/">' + icon('plus') + 'Start a chat</a>') + '</div>';
          return;
        }
        box.innerHTML = group(list).map(function (g) { return '<div class="section-title">' + g[0] + '</div><div class="list">' + g[1].map(rowHtml).join('') + '</div>'; }).join('');
      }).catch(function (e) {
        box.innerHTML = '<div class="card empty">' + icon('alert') + '<div class="h3">Couldn’t load conversations</div><p class="small">' + esc(e.message) + '</p><button class="btn" data-retry>' + icon('refresh') + 'Try again</button></div>';
        box.querySelector('[data-retry]').addEventListener('click', load);
      });
    }
    var hq = page.querySelector('[data-hq]');
    if (hq) hq.addEventListener('input', C.debounce(function () { state.q = hq.value.trim(); load(); }, 200));
    page.querySelectorAll('[data-f]').forEach(function (b) { b.addEventListener('click', function () { state.f = b.getAttribute('data-f'); page.querySelectorAll('[data-f]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); load(); }); });
    page.addEventListener('click', function (e) {
      var m = e.target.closest('[data-hist-menu]'); if (!m) return;
      var c = state.list.filter(function (x) { return x.id === m.getAttribute('data-hist-menu'); })[0];
      if (c) CW.convMenu(m, c, load);
    });
    load();
  }

  CW.pages.history = function (page) {
    listPage(page, { title: 'History', lead: 'Every conversation, grouped by date. Search, rename, save, archive or delete.', filters: [['all', 'All'], ['pinned', 'Saved'], ['archived', 'Archived']],
      emptyIcon: 'history', emptyTitle: 'No conversations yet', emptyText: 'Chats you start with Colon Saga appear here.' });
  };
  CW.pages.saved = function (page) {
    listPage(page, { title: 'Saved', lead: 'Conversations you pinned to keep close.', pinnedOnly: true,
      emptyIcon: 'saved', emptyTitle: 'Nothing saved yet', emptyText: 'Open a conversation’s menu and choose Save to pin it here.' });
  };

  var EXPLORE = {
    study: [['WAEC Chemistry', 'Quiz me on moles and molar mass, one question at a time'], ['JAMB Use of English', 'Explain concord with five examples, then test me'], ['Explain like a teacher', 'Teach me photosynthesis step by step'], ['Revision plan', 'Make a 2-week revision timetable for my exams']],
    developer: [['REST API in Node.js', 'Write a small REST API with MySQL and input validation'], ['Fix my code', 'Help me debug a JavaScript error step by step'], ['Paystack webhook', 'Explain how to verify a Paystack webhook signature'], ['SQL report', 'Write SQL for monthly sales by state']],
    research: [['Agritech in Nigeria', 'Research key players and trends with sources'], ['Compare fintech apps', 'Compare Opay vs Palmpay'], ['History of Lagos', 'Research the history of Lagos and its economy'], ['Solar for small businesses', 'Research solar costs and payback for small businesses']],
    general: [['Plan my week', 'Help me plan a balanced week of work, rest and exercise'], ['Write a message', 'Write a polite message to my landlord about repairs'], ['Explain inflation', 'Explain inflation in simple Nigerian terms'], ['Quick maths', 'What is 15% of 85000?']]
  };
  CW.pages.explore = function (page) {
    page.innerHTML = '<div class="cw-screen"><header class="cw-screen-head"><div><h1 class="h1">Explore</h1><p class="lead">Ideas to get you started in each mode. Tap one to load it into the message box.</p></div></header>' +
      Object.keys(EXPLORE).map(function (k) {
        var m = CW.MODES[k];
        return '<div class="section-title">' + icon(m.icon) + ' ' + esc(m.label) + '</div><div class="explore-grid">' + EXPLORE[k].map(function (x) {
          return '<button type="button" class="explore-card" data-ex-mode="' + k + '" data-ex="' + esc(x[1]) + '"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></button>';
        }).join('') + '</div>';
      }).join('') + '</div>';
    page.querySelectorAll('[data-ex]').forEach(function (b) { b.addEventListener('click', function () { CW.startWith(b.getAttribute('data-ex'), b.getAttribute('data-ex-mode')); }); });
  };

  // Guests: History, Saved and Settings belong to an account.
  CW.pages.login = function (page, ctx) {
    var what = { '/history': ['history', 'Your chat history'], '/saved': ['saved', 'Saved chats'], '/settings': ['settings', 'Settings'] }[ctx && ctx.path] || ['user', 'Your account'];
    page.innerHTML = '<div class="cw-screen"><div class="card empty cw-login-page">' + icon(what[0]) + '<div class="h3">' + esc(what[1]) + ' needs an account</div>' +
      '<p class="small">Log in to save your chats, find them again and pick up on any device. Signing up is free.</p>' +
      '<div class="cw-guest-btns" style="justify-content:center"><button type="button" class="btn primary" data-a="login">Log in</button><button type="button" class="btn" data-a="signup">Sign up</button></div>' +
      '<a class="link small" href="#/" style="display:inline-block;margin-top:14px">Keep chatting as a guest</a></div></div>';
  };

  var FAQ = [
    ['What can Colon Saga do?', 'Explain topics step by step (Study), write and fix code (Developer), and research with sources (Research). General mode is for everything else.'],
    ['Do I need an account?', 'No. You can chat with Colon Saga without logging in, but guest chats aren’t saved: they disappear when you close the tab. Log in or sign up (free) to save your chats, attach images and pick up on any device.'],
    ['Where are my chats stored?', 'When you’re logged in, conversations and files are saved to your Colon account and sync across your devices. Guest chats are never saved. If Colon can’t be reached, the app switches to Preview and keeps chats on this device.'],
    ['Why do replies say “Preview”?', 'Preview appears only when the Colon service can’t be reached (for example, no connection). Replies are then generated on your device so the app keeps working. They go away as soon as Colon is reachable again.'],
    ['Is there a daily limit?', 'Yes, a generous free daily limit of replies, and a smaller one for guests. It resets at midnight (UTC). Logging in gives you the higher limit.'],
    ['Which files can I attach?', 'Images (PNG, JPG, WebP, GIF) up to 10 MB, PDFs and documents up to 20 MB, and text or code files up to 2 MB. Up to 5 files per message.'],
    ['How does voice input work?', 'Tap the microphone. Where your browser supports it, Colon types what you say. Otherwise it records a voice note. If the microphone is blocked, allow it in your browser’s site settings.'],
    ['What is the browser panel?', 'Colon Browser inside your chat. Open it from the globe button or “Browse the Web”. On the web it is a reader preview that shows pages as clean text; full browsing comes with the Colon Android app.'],
    ['How do I delete my data?', 'Settings → Data management lets you export or delete all conversations. You can delete your whole account from Account → Security.']
  ];
  CW.pages.help = function (page) {
    page.innerHTML = '<div class="cw-screen"><header class="cw-screen-head"><div><h1 class="h1">Help & Support</h1><p class="lead">Answers, shortcuts and ways to reach us.</p></div></header>' +
      '<div class="section-title">Frequently asked</div><div class="faq">' + FAQ.map(function (f) { return '<details class="faq-item"><summary>' + esc(f[0]) + icon('chevDown') + '</summary><p>' + esc(f[1]) + '</p></details>'; }).join('') + '</div>' +
      '<div class="section-title">Keyboard shortcuts</div><div class="list">' + [['Ctrl', 'K', 'Search conversations'], ['Ctrl', 'Shift O', 'New chat'], ['', 'Enter', 'Send message'], ['Shift', 'Enter', 'New line'], ['', 'Esc', 'Stop generating'], ['', '/', 'Focus the message box']].map(function (s) {
        return '<div class="set-row"><span class="body"><span class="title">' + esc(s[2]) + '</span></span><span>' + (s[0] ? '<span class="kbd">' + s[0] + '</span> + ' : '') + '<span class="kbd">' + s[1] + '</span></span></div>';
      }).join('') + '</div>' +
      '<div class="section-title">Get in touch</div><div class="list">' +
      C.row('https://github.com/Nifeluxtech/colon-ai/issues', 'alert', 'Report a problem', 'Open an issue on GitHub') +
      C.row('#/terms', 'file', 'Terms of Service', '') + C.row('#/privacy', 'lock', 'Privacy Policy', '') + '</div>' +
      '<p class="tiny muted" style="text-align:center;margin:20px 0">Colon AI v0.4.2 · by Nifelux</p></div>';
    page.querySelector('a[href^="https://github.com"]').setAttribute('target', '_blank');
  };
})();
