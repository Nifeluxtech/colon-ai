/* Colon Admin · System > Web search: providers, encrypted keys and Research mode limits. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { act, opt, sel, sw } from '../components/form.js';
import { fail } from '../components/page.js';

var C = Colon, icon = C.icon, esc = C.esc, $ = C.$, $$ = C.$$;

/* ================= Web search for Research mode (Super Admin, inside System settings) ================= */
function webSearch(el) {
  var load = function () {
    C.api('/admin/search').then(function (d) {
      var W = d.search, order = W.order.slice();
      var byId = {}; W.providers.forEach(function (p) { byId[p.id] = p; });
      var state = function (p) {
        if (W.disabled.indexOf(p.id) > -1) return 'Off';
        if (p.ready) return p.needs === 'key' ? 'Ready · key ' + (p.key.source === 'database'
          ? p.key.masked : 'from the server') : 'Ready' + (p.needs ? '' : ' · no key needed');
        return p.needs === 'key' ? 'Needs an API key' : 'Needs a base URL';
      };
      var rows = function () {
        return order.map(function (id, i) {
          var p = byId[id];
          return '<div class="set-row"><span class="body"><span class="title">' + (i + 1) + '. ' + esc(p.name)
            + '</span><span class="sub">' + esc(state(p)) + '</span></span>' +
            '<button type="button" class="icon-btn sm" data-up="' + i + '" aria-label="Move ' + esc(p.name) + ' up"'
              + (i ? '' : ' disabled') + '>↑</button>' +
            '<button type="button" class="icon-btn sm" data-down="' + i + '" aria-label="Move ' + esc(p.name)
              + ' down"' + (i < order.length - 1 ? '' : ' disabled') + '>↓</button>' +
            '<span class="switch"><input type="checkbox" name="on_' + id + '"' + (W.disabled.indexOf(id) > -1
              ? '' : ' checked') + ' aria-label="Use ' + esc(p.name) + '"><i></i></span></div>';
        }).join('');
      };
      var keyForm = function (id) {
        var p = byId[id];
        return '<form class="form" data-key="' + id + '" novalidate><p class="small muted">' + esc(p.name)
          + (id === 'searxng' ? ' token (optional)' : ' API key') + ': ' +
          (p.key.source === 'database' ? esc(p.key.masked) + ' (stored encrypted)' : p.key.source === 'environment'
            ? 'from the server environment' : 'none') + '</p>' +
          C.field({ name: 'api_key', label: 'New ' + (id === 'searxng' ? 'token' : 'key'), type: 'password',
            auto: 'off', required: false }) +
          '<button class="btn block" type="submit">Save ' + (id === 'searxng' ? 'token' : 'key') + '</button>'
            + (p.key.source === 'database' ? '<button class="btn danger block" type="button" data-clear="' + id
            + '">Remove stored ' + (id === 'searxng' ? 'token' : 'key') + '</button>' : '') + '</form>';
      };
      el.innerHTML = '<form novalidate class="card form" data-ws><div class="h3">' + icon('globe')
        + ' Web search (Research mode)</div>' +
        ('<p class="small muted">Research mode searches the web, reads the top pages and cites them [1], [2]. With '
          + 'no keys it uses DuckDuckGo, then Wikipedia. Queries are sent to these services; nothing else about the '
          + 'user is.</p>') +
        '<div class="list">' + sw('enabled', 'Web search on',
          'Off: Research mode answers from the model’s own knowledge, without links.', W.enabled) + '</div>' +
        '<div class="section-title">Provider order (first that answers wins)</div><div class="list" data-order>' + rows(
          ) + '</div>' +
        sel('results', 'Results per search', String(W.results), [3, 4, 5, 6, 7, 8].map(function (n) { return [String(
          n), String(n)]; })) +
        sel('pages', 'Pages read in full', String(W.pages), [0, 1, 2, 3, 4, 5].map(function (n) { return [String(n),
          n ? String(n) : '0 (snippets only)']; })) +
        opt('searxngUrl', 'SearXNG base URL (optional)', W.searxngUrl, 'https://search.example.org', 'url') +
        '<button class="btn primary block" type="submit">Save web search</button></form>' +
        '<div class="card"><div class="h3">Search API keys</div><p class="small muted">' + icon('lock')
          + (' Optional. Stored encrypted, shown masked, Super Admin only. A stored key wins over the server '
          + 'environment.</p>') +
        keyForm('brave') + keyForm('tavily') + keyForm('searxng') + '</div>';
      var paintOrder = function () { $('[data-order]', el).innerHTML = rows(); };
      $('[data-order]', el).addEventListener('click', function (e) {
        var b = e.target.closest('[data-up],[data-down]'); if (!b) return;
        var i = Number(b.getAttribute('data-up') || b.getAttribute('data-down')), j = b.hasAttribute('data-up') ? i
          - 1 : i + 1;
        if (j < 0 || j >= order.length) return;
        W.disabled = order.filter(function (id) { var c = $('[name=on_' + id + ']', el); return c && !c.checked; });
        var t = order[i]; order[i] = order[j]; order[j] = t; paintOrder();
      });
      C.bindForm($('[data-ws]', el), function (f) {
        var disabled = order.filter(function (id) { return !f['on_' + id]; });
        return C.api('/admin/search', { method: 'PATCH', body: { enabled: f.enabled, order: order, disabled: disabled,
          results: Number(f.results), pages: Number(f.pages), searxngUrl: f.searxngUrl } })
          .then(function () { C.toast('Web search saved. Live within 30 seconds.', 'ok'); load(); });
      });
      $$('[data-key]', el).forEach(function (kf) {
        var id = kf.getAttribute('data-key');
        C.bindForm(kf, function (f) {
          if (!f.api_key) { C.toast('Paste the key first.', 'bad'); return Promise.resolve(); }
          return C.api('/admin/search/key', { method: 'POST', body: { provider: id, api_key: f.api_key } }).then(
            function () { C.toast('Saved (encrypted).', 'ok'); load(); });
        });
      });
      $$('[data-clear]', el).forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-clear');
          C.confirm({ title: 'Remove the stored key?',
            body: 'Search falls back to the key in the server environment, if there is one.', confirm: 'Remove',
            danger: true }).then(function (ok) {
            if (ok) act(C.api('/admin/search/key', { method: 'POST', body: { provider: id, api_key: '' } }),
              function () { C.toast('Key removed.'); load(); });
          });
        });
      });
    }).catch(function (e) { fail(el, e); });
  };
  load();
}

export { webSearch };
