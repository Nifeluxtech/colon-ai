/* ColonBrowserData · the server-side reader (web light mode, ROADMAP Phase 8). Sites that don't allow other
   websites to read them can only be shown on the web through Colon's own server: GET /browser/fetch?url= on the
   API (contract: docs/phase8-backend-contract.md). Until that endpoint is live this adapter falls back quietly:
   'auto' tries it only after the browser's own fetch failed and treats 404/501/offline as "not available yet";
   'mock' returns a clearly labelled Preview page so the UI can be exercised; 'off' never calls it.
   Choose with window.COLON_READER or localStorage['colon.reader'] = 'auto' | 'proxy' | 'mock' | 'off'. */

import { err, withTimeout } from './data-common.js';
import { sanitize } from './sanitize.js';
import { Colon } from '../colon.js';
import { ColonURL } from '../url.js';

var U = ColonURL;

function readerMode() {
  try { return window.COLON_READER || window.localStorage.getItem('colon.reader') || 'auto'; }
  catch (e) { return 'auto'; }
}

// A page shaped like the proxy's answer, marked as a preview. Never pretends to be the real page.
function mockPage(url) {
  var host = U.hostOf(url) || 'this site';
  return { url: url, final_url: url, title: host + ' · Preview', preview: true, source: host,
    html: '<p><b>Preview of light mode.</b> Colon’s server-side reader isn’t switched on yet, so this is a sample '
      + 'of how ' + host + ' will look here: the article text and images, without scripts, ads or sign-in.</p>'
      + '<p>Until then, open the page in the Colon Browser app for full browsing.</p>' };
}

// Server answer -> the page object the viewport renders (sanitised again on the device: defence in depth).
function toPage(d, url, s) {
  var finalUrl = d.final_url || d.url || url, clean = sanitize(d.html || '', finalUrl, { loadImages: s.loadImages });
  return { url: finalUrl, title: d.title || clean.title || U.hostOf(finalUrl), html: clean.html, text: clean.text,
    links: clean.links, source: d.source || U.hostOf(finalUrl), mode: d.preview ? 'preview' : 'proxy',
    preview: !!d.preview };
}

function createProxyReader(o) {
  o = o || {};
  var api = o.api || Colon.api, mode = o.mode || readerMode, unavailable = false;
  function fetchVia(url, s, signal) {
    if (mode() === 'mock') return Promise.resolve(toPage(mockPage(url), url, s));
    if (unavailable) return Promise.reject(err('proxy_unavailable', 'The server-side reader isn’t available yet.'));
    var t = withTimeout(signal, 15000);
    return api('/browser/fetch?url=' + encodeURIComponent(url), { signal: t.signal }).then(function (d) {
      t.done(); return toPage(d, url, s);
    }, function (e) {
      t.done();
      if (e && (e.status === 404 || e.status === 501 || e.code === 'not_found')) unavailable = true;
      throw err('proxy_unavailable', 'The server-side reader isn’t available yet.');
    });
  }
  return {
    mode: mode,
    // Wraps an adapter's fetchPage: own fetch first (or the proxy first in 'proxy' mode), proxy as fallback.
    wrap: function (data) {
      var own = data.fetchPage;
      data.fetchPage = function (url, opts) {
        var m = mode(); opts = opts || {};
        if (m === 'off') return own(url, opts);
        return data.getSettings().then(function (s) {
          if (m === 'proxy') return fetchVia(url, s, opts.signal).catch(function () { return own(url, opts); });
          return own(url, opts).catch(function (e) {
            if (!e || e.code !== 'needs_proxy') throw e;
            return fetchVia(url, s, opts.signal).catch(function () { throw e; });
          });
        });
      };
      return data;
    }
  };
}

export { createProxyReader, mockPage, readerMode, toPage };
