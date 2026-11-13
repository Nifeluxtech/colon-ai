// Voice HTTP handlers: POST /voice/transcribe (multipart "file" + "lang") and GET /voice/status.
const { readMultipartFile } = require('../../shared/multipart');
const { env } = require('./env');

const MAX_BYTES = 12 * 1048576; // 5 minutes of Opus is ~2 MB; M4A/WAV from older phones is larger

const postTranscribe = async (req) => {
  const voice = require('./index');
  const { file, fields } = await readMultipartFile(req, { max: MAX_BYTES });
  const seconds = Number(fields.duration) || 0;
  const cap = Number(env('VOICE_MAX_SECONDS', 300)) || 300;
  if (seconds > cap + 2) throw Object.assign(new Error(`Keep recordings under ${Math.round(cap / 60)} minutes.`),
    { status: 413, code: 'too_long' });
  const r = await voice.transcribe({ data: file.data, mime: file.type, name: file.name, lang: fields.lang });
  return [200, { transcript: r }];
};

const getStatus = async () => {
  const s = require('./index').status();
  return [200, { voice: { enabled: s.enabled, languages: s.languages, ready: s.providers.some(p => p.ready),
    speak: require('./speak').ready() } }];
};

// POST /voice/speak { text, lang, speaker } -> audio/mpeg, written directly (not JSON).
const postSpeak = async (req, res) => {
  const b = req.body || {};
  const r = await require('./speak').speak({ text: b.text, lang: b.lang, speaker: b.speaker });
  res.writeHead(200, { 'Content-Type': r.mime, 'Content-Length': r.audio.length, 'Cache-Control': 'private, '
    + 'max-age=86400', 'X-Content-Type-Options': 'nosniff', 'X-Voice': r.voice, 'X-Language': r.lang });
  res.end(r.audio);
};

module.exports = { postTranscribe, getStatus, postSpeak };
