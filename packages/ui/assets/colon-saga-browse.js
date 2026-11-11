/* ColonSagaBrowse: observable AI browsing for the web reader (ROADMAP Phase 9/10, web edition).
   Saga plans steps (POST /browser/plan when the API offers it, else the built-in planner),
   then runs them through the browser driver one at a time: search → open pages → read → summarise.

   Safety rules enforced here:
   - Every action is logged with a timestamp and shown to the user (nothing hidden).
   - Shared mode asks for approval before EACH action; AI mode only runs read-only reader actions.
   - Handoff: pause() aborts the in-flight action at a safe point and re-queues it, so nothing keeps
     running after the user takes control. stop() cancels the task for good.
   - Page text is treated as data, never as instructions (it is only quoted into the summary).

   create({ data, driver: { navigate(url,{signal}), search(query,{signal}) }, needsApproval() }) -> runner
   runner: start(goal), pause(reason), resume(), stop(), approve(), skip(), state(), on(fn), reset() */
(function (root) {
  'use strict';

  var STOP = ['a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'me', 'my', 'please', 'find', 'search', 'research', 'look', 'up', 'about', 'what', 'is', 'are', 'how', 'why',
    'who', 'tell', 'show', 'give', 'get', 'can', 'you', 'i', 'want', 'need', 'some', 'information', 'info', 'browse', 'web', 'online', 'saga', 'colon', 'with', 'that', 'this', 'do', 'does', 'latest'];
  function keywords(goal) { return String(goal).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(function (w) { return w && STOP.indexOf(w) < 0; }); }
  function refine(goal) { var k = keywords(goal); return (k.length ? k.join(' ') : String(goal)).slice(0, 120); }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function sid() { return 's' + Math.random().toString(36).slice(2, 8); }

  function localPlan(goal) {
    return [
      { kind: 'search', label: 'Search the web for “' + refine(goal) + '”', query: refine(goal) },
      { kind: 'summarize', label: 'Summarise what I found, with sources' }
    ];
  }

  // Pull the most relevant sentences out of a reader page.
  function extract(page, goal) {
    var kws = keywords(goal), doc = new DOMParser().parseFromString('<div>' + (page.html || '') + '</div>', 'text/html');
    var paras = Array.prototype.map.call(doc.querySelectorAll('p,li'), function (p) { return (p.textContent || '').replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim(); })
      .filter(function (t) { return t.length > 60; });
    if (!paras.length && page.text) paras = page.text.split(/\n+/).filter(function (t) { return t.length > 60; });
    var sentences = [];
    paras.slice(0, 40).forEach(function (p, pi) {
      p.split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/).forEach(function (s) {
        if (s.length < 40 || s.length > 400) return;
        var low = s.toLowerCase(), score = kws.reduce(function (n, k) { return n + (low.indexOf(k) > -1 ? 2 : 0); }, 0) + Math.max(0, 3 - pi * 0.3);
        sentences.push({ s: s, score: score });
      });
    });
    sentences.sort(function (a, b) { return b.score - a.score; });
    return { snippet: (paras[0] || '').slice(0, 220), points: sentences.slice(0, 3).map(function (x) { return x.s; }), paragraphs: paras.length };
  }

  function create(o) {
    var subs = [], st = null, ctl = null, waiter = null, pauseFlag = null;
    function emit() { var s = state(); subs.forEach(function (f) { try { f(s); } catch (e) {} }); }
    function state() { return st ? JSON.parse(JSON.stringify(st)) : null; }
    function log(text, kind) { st.actions.push({ t: new Date().toISOString(), text: text, kind: kind || 'info' }); if (st.actions.length > 200) st.actions.shift(); emit(); }
    function progress() { var done = st.steps.filter(function (s) { return s.status === 'done' || s.status === 'skipped'; }).length; st.progress = st.steps.length ? Math.round(done / st.steps.length * 100) : 0; }
    function wait() { return new Promise(function (resolve) { waiter = resolve; }); }
    function wake(v) { var w = waiter; waiter = null; if (w) w(v); }

    function start(goal) {
      if (st && /running|paused|awaiting/.test(st.status)) stop();
      st = { id: 't' + Date.now().toString(36), goal: String(goal).trim().slice(0, 300), status: 'planning', steps: [], actions: [], sources: [], notes: [], progress: 0, site: '', summary: '', started_at: new Date().toISOString(), error: null, pause_reason: null };
      pauseFlag = null;
      log('Task received: “' + st.goal + '”', 'task');
      Promise.resolve(o.data.plan ? o.data.plan(st.goal) : null).catch(function () { return null; }).then(function (plan) {
        if (!st || st.status === 'stopped') return;
        st.steps = (plan && plan.length ? plan : localPlan(st.goal)).map(function (p) { return Object.assign({ id: sid(), status: 'pending' }, p); });
        log('Plan ready: ' + st.steps.length + ' steps' + (plan ? ' (Colon Saga)' : ' (built-in planner)'), 'plan');
        st.status = 'running'; emit(); loop();
      });
      return state();
    }

    async function loop() {
      var myId = st.id;
      for (var i = 0; i < st.steps.length; i++) {
        if (!st || st.id !== myId || st.status === 'stopped') return;
        var step = st.steps[i];
        if (step.status === 'done' || step.status === 'skipped') continue;
        // Gate 1: paused (Pause AI or handoff to the user)
        while (pauseFlag) { st.status = 'paused'; st.pause_reason = pauseFlag; emit(); await wait(); if (!st || st.id !== myId || st.status === 'stopped') return; }
        // Gate 2: approval (Shared mode asks before each action)
        if (o.needsApproval && o.needsApproval(step)) {
          st.status = 'awaiting_approval'; step.status = 'awaiting'; emit();
          var decision = await wait();
          if (!st || st.id !== myId || st.status === 'stopped') return;
          if (decision === 'pause') { step.status = 'pending'; i--; continue; }
          if (decision === 'skip') { step.status = 'skipped'; log('You skipped: ' + step.label, 'skip'); progress(); continue; }
          log('You approved: ' + step.label, 'approve');
        }
        st.status = 'running'; step.status = 'running'; emit();
        ctl = new AbortController();
        try {
          await run(step, i, ctl.signal);
          step.status = 'done'; progress(); emit();
        } catch (e) {
          if (e.name === 'AbortError' || e.code === 'aborted') {
            if (st && st.status === 'stopped') return;
            step.status = 'pending'; log('Paused safely before finishing: ' + step.label, 'pause'); i--; continue;
          }
          step.status = 'failed'; step.error = e.message; log('Couldn’t complete “' + step.label + '”: ' + e.message, 'error'); progress(); emit();
        } finally { ctl = null; }
        await new Promise(function (r) { setTimeout(r, 450); }); // keep actions observable
      }
      if (st && st.id === myId && st.status !== 'stopped') { st.status = st.sources.length ? 'done' : 'error'; if (!st.sources.length) st.error = 'No readable sources were found for this task.'; st.progress = 100; log(st.sources.length ? 'Task complete.' : 'Task ended without sources.', st.sources.length ? 'done' : 'error'); }
    }

    async function run(step, index, signal) {
      if (step.kind === 'search') {
        log('Searching for “' + step.query + '”', 'search');
        var res = await o.driver.search(step.query, { signal: signal });
        st.site = res.provider || 'Search';
        var seen = {}, picks = (res.results || []).filter(function (r) { if (seen[r.url]) return false; seen[r.url] = 1; return true; }).slice(0, 3);
        log('Found ' + (res.results || []).length + ' results on ' + (res.provider || 'the web'), 'result');
        if (!picks.length) throw Object.assign(new Error('No results'), { code: 'no_results' });
        var opens = picks.map(function (p) { return { id: sid(), kind: 'open', label: 'Open “' + p.title + '”', url: p.url, title: p.title, status: 'pending' }; });
        st.steps.splice.apply(st.steps, [index + 1, 0].concat(opens));
        return;
      }
      if (step.kind === 'open') {
        log('Opening ' + host(step.url), 'open');
        st.site = host(step.url); emit();
        var page = await o.driver.navigate(step.url, { signal: signal });
        var x = extract(page, st.goal);
        log('Read “' + (page.title || step.title) + '” (' + x.paragraphs + ' paragraphs)', 'read');
        if (x.points.length) {
          st.sources.push({ n: st.sources.length + 1, title: page.title || step.title, url: page.url || step.url, snippet: x.snippet });
          st.notes.push({ n: st.sources.length, title: page.title || step.title, points: x.points });
          log('Saved ' + x.points.length + ' key points as source [' + st.sources.length + ']', 'source');
        }
        return;
      }
      if (step.kind === 'summarize') {
        log('Writing summary', 'summary');
        var md = '**' + st.goal.replace(/\*/g, '') + '**\n\n';
        if (!st.notes.length) md += 'I couldn’t find readable sources for this yet.';
        st.notes.forEach(function (n) { md += '**' + n.title.replace(/\*/g, '') + '** [' + n.n + ']\n' + n.points.map(function (p) { return '- ' + p.replace(/([*_`[\]])/g, '\\$1'); }).join('\n') + '\n\n'; });
        md += '_Summary assembled from the pages above in reader preview. Check the sources before relying on it._';
        st.summary = md; return;
      }
      throw new Error('Unknown action');
    }

    function pause(reason) {
      if (!st || !/running|awaiting|planning/.test(st.status)) return state();
      pauseFlag = reason || 'user';
      if (ctl) ctl.abort();                // stop the in-flight action at a safe point
      if (st.status === 'awaiting_approval') wake('pause');
      log(reason === 'handoff' ? 'You took control. Saga paused all pending actions.' : 'Saga paused.', 'pause');
      st.status = 'paused'; st.pause_reason = pauseFlag; emit();
      return state();
    }
    function resume() { if (!st || st.status !== 'paused') return state(); pauseFlag = null; st.pause_reason = null; log('Saga resumed.', 'resume'); st.status = 'running'; emit(); wake('resume'); return state(); }
    function stop() { if (!st || /done|stopped|error/.test(st.status)) return state(); st.status = 'stopped'; pauseFlag = null; if (ctl) ctl.abort(); log('Task stopped.', 'stop'); wake('stop'); emit(); return state(); }
    function approve() { if (st && st.status === 'awaiting_approval') wake('approve'); }
    function skip() { if (st && st.status === 'awaiting_approval') wake('skip'); }
    function reset() { stop(); st = null; emit(); }
    function restoreFrom(saved) { if (!saved) return; st = saved; if (/running|planning|awaiting/.test(st.status)) { st.status = 'paused'; st.pause_reason = 'restored'; st.steps.forEach(function (s) { if (s.status === 'running' || s.status === 'awaiting') s.status = 'pending'; }); pauseFlag = 'restored'; loop(); } emit(); }

    return { start: start, pause: pause, resume: resume, stop: stop, approve: approve, skip: skip, reset: reset, restore: restoreFrom, state: state, on: function (f) { subs.push(f); }, isActive: function () { return !!st && /planning|running|paused|awaiting/.test(st.status); } };
  }

  root.ColonSagaBrowse = { create: create, refine: refine, keywords: keywords };
})(window);
