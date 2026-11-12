/* ColonBrowserData · Wikipedia pages and search through its public API (CORS-friendly). */

import { err } from './data-common.js';

/* ---------- Reader sources the browser itself may read (CORS-enabled) ---------- */
function wikiTitle(u) {
  var m = /^https?:\/\/([a-z-]{2,12})\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i.exec(u);
  return m ? { lang: m[1], title: decodeURIComponent(m[2]) } : null;
}
function wikiLang(u) { var m = /^https?:\/\/([a-z-]{2,12})\.(?:m\.)?wikipedia\.org/i.exec(u || '');
  return m ? m[1] : 'en'; }

function fetchWikipedia(w, signal) {
  var api = 'https://' + w.lang
    + ('.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&origin=*&redirects=1&disableeditsection=1'
    + '&prop=text%7Cdisplaytitle&page=') + encodeURIComponent(w.title);
  return fetch(api, { signal: signal }).then(function (r) {
    if (r.status === 429) throw err('rate_limited', 'Wikipedia asked us to slow down. Try again in a moment.');
    if (!r.ok) throw err('http_' + r.status, 'The page could not be loaded (' + r.status + ').');
    return r.json();
  }).then(function (d) {
    if (d.error) throw err('not_found', d.error.code === 'missingtitle' ? 'That article doesn’t exist.' : (d.error.info
      || 'Page not available.'));
    var url = 'https://' + w.lang + '.wikipedia.org/wiki/' + encodeURIComponent(d.parse.title.replace(/ /g, '_'));
    var tmp = document.createElement('div'); tmp.innerHTML = d.parse.displaytitle || d.parse.title;
    return { url: url, html: d.parse.text, title: tmp.textContent || d.parse.title, source: 'Wikipedia' };
  });
}

function searchWikipedia(q, lang, signal) {
  var api = 'https://' + (lang || 'en')
    + '.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=10&srprop=snippet&srsearch='
    + encodeURIComponent(q);
  return fetch(api, { signal: signal }).then(function (r) {
    if (r.status === 429) throw err('rate_limited', 'Search is busy right now. Try again in a moment.');
    if (!r.ok) throw err('http_' + r.status, 'Search failed (' + r.status + ').');
    return r.json();
  }).then(function (d) {
    return ((d.query && d.query.search) || []).map(function (x) {
      var tmp = document.createElement('div'); tmp.innerHTML = x.snippet || '';
      return { title: x.title, url: 'https://' + (lang || 'en') + '.wikipedia.org/wiki/' + encodeURIComponent(
        x.title.replace(/ /g, '_')), snippet: tmp.textContent };
    });
  });
}

export { fetchWikipedia, searchWikipedia, wikiLang, wikiTitle };
