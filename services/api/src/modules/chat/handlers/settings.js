// Chat: settings and stats (handlers for src/http/routes/chat/settings.js).

const db = require('../../../db');
const v = require('../../../shared/validate');
const store = require('../store');
const { loadSettings } = require('./chat-common');

const BOOLS = ['enterToSend', 'showMeta', 'linksInPanel', 'streaming', 'saveHistory', 'shareFeedback'];

const ENUMS = { defaultMode: store.MODES, browserLayout: ['split', 'embedded'], textSize: ['sm', 'md', 'lg'],
  browserMode: ['ai', 'shared'] };

const VOICE = { lang: ['en-NG', 'en-GB', 'en-US', 'pcm-NG', 'yo-NG', 'ha-NG', 'ig-NG', 'auto'], method: ['auto',
  'colon', 'dictation', 'recorder'], readAloudRate: [0.8, 1, 1.25], readAloudVoice: ['auto', 'colon', 'device'],
  speaker: ['female', 'male'] };

function cleanSettings(patch) {
  const out = {};
  for (const k of BOOLS) if (patch[k] !== undefined) out[k] = Boolean(patch[k]);
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (patch[k] === undefined) continue;
    if (!allowed.includes(patch[k])) v.fail(k, 'Choose one of the listed options.');
    out[k] = patch[k];
  }
  if (patch.defaultModel !== undefined) out.defaultModel = patch.defaultModel ? String(patch.defaultModel).slice(0,
    64) : null;
  if (patch.voice && typeof patch.voice === 'object') {
    out.voice = {};
    for (const [k, allowed] of Object.entries(VOICE)) {
      if (patch.voice[k] === undefined) continue;
      const val = k === 'readAloudRate' ? Number(patch.voice[k]) : patch.voice[k];
      if (!allowed.includes(val)) v.fail(`voice.${k}`, 'Choose one of the listed options.');
      out.voice[k] = val;
    }
    if (patch.voice.autoSend !== undefined) out.voice.autoSend = Boolean(patch.voice.autoSend);
  }
  return out;
}

// GET /chat/settings
const getChatSettings = async (req) => [200, { settings: await loadSettings(req.user.id) }];

// PATCH /chat/settings
const patchChatSettings = async (req) => {
  const cur = await loadSettings(req.user.id);
  const p = cleanSettings(req.body);
  const next = { ...cur, ...p, voice: { ...cur.voice, ...(p.voice || {}) } };
  await db.query(
    'INSERT INTO chat_settings (user_id, settings) VALUES (?, ?) ON DUPLICATE KEY UPDATE settings = VALUES(settings)',
    [req.user.id, JSON.stringify(next)]);
  return [200, { settings: next }];
};

// GET /chat/stats
const getChatStats = async (req) => {
  const c = await db.one('SELECT COUNT(*) AS n FROM chat_conversations WHERE user_id = ?', [req.user.id]);
  const m = await db.one((
    "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS bytes FROM chat_messages WHERE user_id = ? AND role "
    + "<> 'event'"), [req.user.id]);
  const f = await db.one(
    'SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM chat_attachments WHERE user_id = ?', [req.user.id]);
  return [200, { conversations: Number(c.n), messages: Number(m.n), files: Number(f.n), bytes: Number(m.bytes) + Number(
    f.bytes), where: 'Your Colon account' }];
};

module.exports = { getChatSettings, patchChatSettings, getChatStats };
