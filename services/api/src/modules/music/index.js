// Colon Music (OS Assistant Step 3; YouTube since 0.21.0, docs/os-assistant/step-3.md): "play X" with no match on the
// phone finds the song on YouTube and the chat plays it in Colon's own YouTube player (the official embed). The
// search uses the YouTube Data API v3 (YOUTUBE_API_KEY, free from Google Cloud Console); one search costs 100 of the
// 10,000 daily quota units, so answers are cached for a while.
//   search(q, { fetch, kind }) -> [{ id, title, channel, image, link }]  (at most 5, embeddable videos; kind 'music'
//   (default) keeps the Music category, kind 'video' (0.22.0, "watch X") searches any video)
const API = 'https://www.googleapis.com/youtube/v3/search';
const ID = /^[A-Za-z0-9_-]{11}$/;
const CACHE_MS = 6 * 3600 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const apiKey = () => String(process.env.YOUTUBE_API_KEY || '').trim();

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#34': '"' };
function unescapeHtml(s) {
  return String(s || '').replace(/&(#?\w+);/g, (m, e) => (ENT[e] !== undefined ? ENT[e]
    : /^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m));
}

function remember(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

function toTrack(item) {
  const id = item && item.id && item.id.videoId;
  if (!ID.test(String(id || ''))) return null;
  const sn = item.snippet || {};
  const th = sn.thumbnails || {};
  const img = (th.high || th.medium || th.default || {}).url || '';
  return { id, title: unescapeHtml(sn.title), channel: unescapeHtml(sn.channelTitle).replace(/\s+-\s+Topic$/, ''),
    image: /^https:\/\/i\.ytimg\.com\//.test(img) ? img : '', link: `https://www.youtube.com/watch?v=${id}` };
}

const KINDS = { music: 1, video: 1 };

async function search(q, o = {}) {
  const kind = KINDS[o.kind] ? o.kind : 'music';
  const query = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!query) throw err(400, 'bad_query', 'Say a song or an artist.');
  const key = apiKey();
  if (!key) throw err(503, 'music_off', 'YouTube music isn’t set up yet (YOUTUBE_API_KEY).');
  const ck = `${kind}:${query.toLowerCase()}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const params = { part: 'snippet', type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true',
    videoCategoryId: '10', regionCode: 'NG', relevanceLanguage: 'en', safeSearch: 'moderate', maxResults: '5',
    q: query, key };
  if (kind === 'video') delete params.videoCategoryId;
  const url = `${API}?${new URLSearchParams(params)}`;
  let res;
  try {
    res = await (o.fetch || fetch)(url, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw err(502, 'music_failed', 'YouTube didn’t answer.');
  }
  if (res.status === 403) throw err(503, 'music_busy', 'Music search is busy today. Try again later.');
  if (!res.ok) throw err(502, 'music_failed', 'YouTube didn’t answer.');
  const d = await res.json().catch(() => ({}));
  const out = (Array.isArray(d.items) ? d.items : []).map(toTrack).filter(Boolean).slice(0, 5);
  remember(ck, out);
  return out;
}

const handlers = {
  getSearch: async (req) => [200, { tracks: await search(req.query.get('q'), { kind: req.query.get('kind') }) }],
};

module.exports = { search, unescapeHtml, handlers, _cache: cache };
