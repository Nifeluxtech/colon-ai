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
  return [200, { voice: { enabled: s.enabled, languages: s.languages, ready: s.providers.some(p => p.ready) } }];
};

module.exports = { postTranscribe, getStatus };
