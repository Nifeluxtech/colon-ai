// Chat notes: messages the app writes into a thread without a model reply (POST /conversations/:id/notes).
//   origin 'browse'  : an AI Browse summary, or (Phase 10) the user's own browser instruction (role user)
//   origin 'command' : 0.22.1, a phone, music or voice command and Colon's short reply ("take me to WhatsApp" ->
//                      "I'll take you to WhatsApp now."); the user's line is role user
//   origin 'video'   : 0.22.1, Colon's reply that started a video card; its one source is the YouTube video (title,
//                      watch link, channel in `snippet`), so a reload can draw the card collapsed
//   origin 'note'    : anything else
// notePlan(body) -> { role, origin, content, sources } (throws nothing; empty content is the caller's error)

const ORIGINS = new Set(['browse', 'command', 'video']);
const USER_ORIGINS = new Set(['browse', 'command']);
const YOUTUBE = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/;

function cleanSources(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((s, i) => ({
    n: Number(s && s.n) || i + 1, title: String((s && s.title) || '').slice(0, 200),
    url: /^https?:\/\//i.test(String((s && s.url) || '')) ? String(s.url).slice(0, 2000) : '',
    snippet: String((s && s.snippet) || '').slice(0, 500),
  })).filter(s => s.url);
}

function notePlan(body) {
  const b = body || {};
  const origin = ORIGINS.has(b.origin) ? b.origin : 'note';
  const role = b.role === 'user' && USER_ORIGINS.has(origin) ? 'user' : 'assistant';
  const content = String(b.content || '').slice(0, 60000).trim();
  let sources = role === 'user' ? [] : cleanSources(b.sources);
  if (origin === 'video') sources = sources.filter(s => YOUTUBE.test(s.url)).slice(0, 1);
  return { role, origin: origin === 'video' && !sources.length ? 'command' : origin, content, sources };
}

module.exports = { notePlan };
