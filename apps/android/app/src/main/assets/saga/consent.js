/* Colon AI · known cookie banners, cleared with no model call (0.11.5). Runs Consent-O-Matic's rules (MIT,
   vendor/consent-o-matic: detectors and the reject methods, curated by scripts/vendor-consent-rules.js) on the page
   Saga reads, before getPageContent; the 0.11.2 pop-up handling ("Reject all" by Saga) stays the fallback for
   everything else. Saga only ever rejects: every consent category is set off, then the choice is saved.
   SagaTools.kt evaluates it like tools.js (fresh every time, nothing kept on window) in two passes:
     1. rules with detectors only -> { state: 'found', cmp } when a known banner is present and showing, else none;
     2. that one rule with its methods -> runs OPEN_OPTIONS, DO_CONSENT, SAVE_CONSENT. It is synchronous: after a
        click (so the page can react), a "wait" or a "waitcss" whose element is not there yet it answers
        { state: 'wait', ms, resume } and is called again with resume. On a resumed run the steps already done are
        replayed without acting (pos < resume.n), with the branches they took (resume.trail), so nothing runs twice.
   -> JSON string { state: 'none' | 'found' | 'wait' | 'done', cmp?, cleared?, ms?, resume? }.
   Tested in services/api/tests/security/saga-phone-consent.test.js with a small fake DOM. */
(function (rules, resume) {
  'use strict';
  var doc = document, base = null;
  resume = resume || {};
  var MAX_ACTIONS = 400;
  var st = { n: Number(resume.n) || 0, trail: Array.isArray(resume.trail) ? resume.trail.slice() : [],
    k: 0, pos: 0, tries: Number(resume.tries) || 0, steps: 0, wait: null, clicks: Number(resume.clicks) || 0 };

  function arr(x) { return Array.prototype.slice.call(x || []); }
  function root(top) { return top && top.shadowRoot ? top.shadowRoot : top; }
  function text(el) { return String(el.textContent || '').toLowerCase().replace(/\s{2,}/g, ' '); }
  function findElement(o, parent, multiple) {
    if (!o || typeof o.selector !== 'string') return multiple ? [] : null;
    var top = parent || base || doc, list;
    if (o.selector.trim() === ':scope') list = [top];
    else { try { list = arr(root(top).querySelectorAll(o.selector)); } catch (e) { list = []; } }
    if (o.textFilter != null) {
      var wants = (Array.isArray(o.textFilter) ? o.textFilter : [o.textFilter]).map(function (t) {
        return String(t).toLowerCase().replace(/\s{2,}/g, ' '); });
      list = list.filter(function (el) { var t = text(el);
        return wants.some(function (w) { return t.indexOf(w) !== -1; }); });
    }
    if (o.styleFilters != null) {
      list = list.filter(function (el) {
        var cs = window.getComputedStyle(el) || {};
        return o.styleFilters.every(function (f) { var v = cs[f.option];
          return f.negated ? v !== f.value : v === f.value; });
      });
    }
    if (o.displayFilter != null) {
      list = list.filter(function (el) { return (el.offsetHeight !== 0) === !!o.displayFilter; });
    }
    if (o.iframeFilter != null) { var framed = window.top !== window; list = list.filter(function () {
      return framed === !!o.iframeFilter; }); }
    if (o.childFilter != null) {
      var neg = o.childFilterNegated === true || o.childFilterNegate === true;
      list = list.filter(function (el) {
        var old = base; base = el; var hit = find(o.childFilter).target; base = old;
        return neg ? hit == null : hit != null;
      });
    }
    return multiple ? list : list[0] || null;
  }
  function find(o, multiple) {
    var out = [];
    if (!o) return multiple ? out : { parent: null, target: null };
    if (o.parent != null) {
      var parents = findElement(o.parent, null, multiple);
      (multiple ? parents : parents ? [parents] : []).forEach(function (p) {
        var t = findElement(o.target, p, multiple);
        (multiple ? t : [t]).forEach(function (x) { out.push({ parent: p, target: x }); });
      });
    } else {
      var t = findElement(o.target, null, multiple);
      (multiple ? t : [t]).forEach(function (x) { out.push({ parent: null, target: x }); });
    }
    if (!out.length) out.push({ parent: null, target: null });
    return multiple ? out : out[0];
  }

  function matches(m) {
    if (!m) return false;
    if (m.type === 'onoff') return find(m.onMatcher || {}).target != null;
    var t = find(m).target;
    if (m.type === 'checkbox') return t != null && (m.negated ? !t.checked : !!t.checked);
    if (m.type === 'url') return false;
    return t != null;
  }
  function list(ms) { return (Array.isArray(ms) ? ms : [ms]).filter(Boolean); }
  function present(d) { var p = list(d.presentMatcher); return p.length > 0 && p.every(matches); }
  function showing(d) { var s = list(d.showingMatcher); return s.every(matches); }
  function detected(rule) {
    var ds = Array.isArray(rule.detectors) ? rule.detectors : [];
    for (var i = 0; i < ds.length; i++) if (present(ds[i])) return showing(ds[i]);
    return false;
  }

  // A step that counts for resuming: true when it is done (replayed or acted), false to stop and wait.
  function replaying() { return st.pos < st.n; }
  function decide(live) {           // a branch, taken now or replayed as it was
    if (replaying()) { st.pos++; return !!st.trail[st.k++]; }
    var v = !!live(); st.trail.push(v); st.k++; st.pos++; return v;
  }
  function pause(ms) { st.wait = Math.max(50, Math.min(1000, Number(ms) || 200)); }

  // Runs one action; false: stop here (st.wait says how long until the next run).
  function exec(a, rule) {
    if (!a || st.wait != null || ++st.steps > MAX_ACTIONS) return st.wait == null;
    switch (a.type) {
      case 'list': return (a.actions || []).every(function (x) { return exec(x, rule); });
      case 'click': case 'multiclick': {
        if (replaying()) { st.pos++; return true; }
        var ts = a.type === 'multiclick' ? find(a, true) : [find(a)];
        var hit = false;
        ts.forEach(function (r) { if (r.target) { r.target.click(); hit = true; st.clicks++; } });
        st.pos++;
        if (hit && a.noTimeout !== true) { pause(200); return false; }
        return true;
      }
      case 'ifcss':
        return decide(function () { return find(a).target != null; }) ? exec(a.trueAction, rule)
          : exec(a.falseAction, rule);
      case 'ifallowall': return exec(a.falseAction, rule);       // Saga allows nothing
      case 'ifallownone': return exec(a.trueAction, rule);
      case 'waitcss': {
        if (replaying()) { st.pos++; return true; }
        var there = find(a).target != null;
        if (there !== !!a.negated || st.tries >= (Number(a.retries) || 10)) { st.pos++; st.tries = 0; return true; }
        st.tries++; pause(Number(a.waitTime) || 250); return false;
      }
      case 'wait':
        if (replaying()) { st.pos++; return true; }
        st.pos++; pause(a.waitTime); return false;
      case 'foreach': {
        var old = base, ok = true;
        find(a, true).forEach(function (r) { if (ok && r.target) { base = r.target; ok = exec(a.action, rule); } });
        base = old; return ok;
      }
      case 'consent': return (a.consents || []).every(function (c) { return off(c, rule); });
      case 'runmethod': return exec(rule.methods && rule.methods[a.method], rule);
      case 'hide': return true;                                    // cosmetic: the banner goes by its own choice
      default: return true;
    }
  }
  // Sets one consent category off (Consent.js setEnabled(false)).
  function off(c, rule) {
    var m = c.matcher;
    if (c.toggleAction && m) return decide(function () { return safe(m); }) ? exec(c.toggleAction, rule) : true;
    if (m && m.type === 'onoff' && c.falseAction) {
      return decide(function () { return safe(m); }) ? exec(c.falseAction, rule) : true;
    }
    return c.falseAction ? exec(c.falseAction, rule) : true;
  }
  function safe(m) { try { return matches(m); } catch (e) { return false; } }

  function out(o) { return JSON.stringify(o); }
  try {
    var names = Object.keys(rules || {});
    if (!resume.cmp) {
      for (var i = 0; i < names.length; i++) {
        var r = rules[names[i]];
        if (r && detected(r)) return out(r.methods ? { state: 'found', cmp: names[i], run: true } :
          { state: 'found', cmp: names[i] });
      }
      return out({ state: 'none' });
    }
    var rule = rules[resume.cmp];
    if (!rule || !rule.methods) return out({ state: 'none' });
    if (!st.n && !detected(rule)) return out({ state: 'none' });
    ['OPEN_OPTIONS', 'DO_CONSENT', 'SAVE_CONSENT'].every(function (m) { return exec(rule.methods[m], rule); });
    if (st.wait != null) {
      return out({ state: 'wait', ms: st.wait, resume: { cmp: resume.cmp, n: st.pos, trail: st.trail, tries: st.tries,
        clicks: st.clicks } });
    }
    return out({ state: 'done', cmp: resume.cmp, cleared: st.clicks > 0 && !detected(rule), clicks: st.clicks });
  } catch (e) {
    return out({ state: 'none', error: String(e && e.message || e).slice(0, 100) });
  }
})
