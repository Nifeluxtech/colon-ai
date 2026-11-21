/* Colon AI · a past video card, collapsed (0.22.1). A reply that started a video (origin 'video', its one source is
   the YouTube video: title, watch link, channel in `snippet`) shows this static row when its card isn't the one
   playing: the thumbnail, the title and channel, a "Play again" button (data-msg="replay", message.js) and an Open
   in YouTube link. It is plain HTML, so the thread can redraw it any time; the live card is music-dock.js. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { activeVideo } from './music-dock.js';

var C = Colon, esc = C.esc;
var WATCH = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/;

/** The video a reply played ({ id, title, channel, link }), or null. */
function videoOf(m) {
  var s = m && m.origin === 'video' && m.sources && m.sources[0], hit = s && WATCH.exec(s.url || '');
  if (!hit) return null;
  return { id: hit[1], title: s.title || 'YouTube video', channel: s.snippet || '', link: s.url };
}

/** The collapsed row for a video reply ('' when it isn't one, or its card is live now). */
function videoRowHtml(m) {
  var v = videoOf(m);
  if (!v || activeVideo() === m.id) return '';
  return '<div class="cm-past">'
    + '<img class="cm-past-thumb" alt="" loading="lazy" src="https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg">'
    + '<div class="cm-meta"><div class="cm-title">' + esc(v.title) + '</div><div class="cm-artist">'
    + esc(v.channel || 'YouTube') + '</div></div>'
    + '<div class="cm-past-acts"><button type="button" class="btn sm" data-msg="replay">' + C.icon('play')
    + 'Play again</button><a class="icon-btn sm cm-yt" href="' + esc(v.link) + '" target="_blank" rel="noopener" '
    + 'aria-label="Open in YouTube" data-tip="YouTube">' + C.icon('external') + '</a></div></div>';
}

export { videoOf, videoRowHtml };
