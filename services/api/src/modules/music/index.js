// Colon Music (OS Assistant Step 3, docs/os-assistant/step-3.md): Jamendo search for "play X" when the phone has no
// match. Jamendo is free Creative Commons music; its API needs a free client id (JAMENDO_CLIENT_ID, from
// devportal.jamendo.com). Only tracks whose title, artist or album hold every word the user said come back, so a
// mainstream song falls through to YouTube in the app instead of a random Jamendo track.
//   search(q, { fetch }) -> [{ id, title, artist, album, audio, image, link }]  (at most 5)
const API = 'https://api.jamendo.com/v3.0/tracks/';
const STOP = new Set(['by', 'the', 'song', 'songs', 'track', 'music', 'a', 'an', 'of', 'from', 'my']);
const JAMENDO = /^https:\/\/(?:[a-z0-9-]+\.)*jamendo\.com(?:[/?]|$)/i;

const err = (status, code, message) => Object.assign(new Error(message), { status, code });
const clientId = () => String(process.env.JAMENDO_CLIENT_ID || '').trim();

function words(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
}

/** True when every word the user said is in the track's title, artist or album. */
function matches(query, t) {
  const said = words(query);
  if (!said.length) return false;
  const hay = ` ${words(`${t.name} ${t.artist_name} ${t.album_name || ''}`).join(' ')} `;
  return said.every((w) => hay.includes(` ${w} `));
}

async function search(q, o = {}) {
  const query = String(q || '').trim().slice(0, 120);
  if (!query) throw err(400, 'bad_query', 'Say a song or an artist.');
  const id = clientId();
  if (!id) throw err(503, 'music_off', 'Jamendo isn’t set up yet (JAMENDO_CLIENT_ID).');
  const url = `${API}?${new URLSearchParams({ client_id: id, format: 'json', limit: '10', search: query,
    audioformat: 'mp32' })}`;
  let res;
  try {
    res = await (o.fetch || fetch)(url, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw err(502, 'music_failed', 'Jamendo didn’t answer.');
  }
  if (!res.ok) throw err(502, 'music_failed', 'Jamendo didn’t answer.');
  const d = await res.json().catch(() => ({}));
  return (Array.isArray(d.results) ? d.results : [])
    .filter((t) => t && JAMENDO.test(String(t.audio || '')) && matches(query, t))
    .slice(0, 5)
    .map((t) => ({ id: String(t.id), title: String(t.name || ''), artist: String(t.artist_name || ''),
      album: String(t.album_name || ''), audio: t.audio, image: String(t.image || ''),
      link: String(t.shareurl || '') }));
}

const handlers = {
  getSearch: async (req) => [200, { tracks: await search(req.query.get('q')) }],
};

module.exports = { search, matches, words, handlers };
