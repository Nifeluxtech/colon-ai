// Helpers shared by the chat handlers.
const db = require('../../../db');
const store = require('../store');

const MAX_CONTENT = 16000;

// Research mode searches the web first (Phase 5, docs/phases/phase-5-research.md). Other modes never do.
const wantsWeb = (mode) => mode === 'research';

const previousUserText = (history) => {
  const users = history.filter(m => m.role === 'user');
  return users.length > 1 ? String(users[users.length - 2].content || '') : '';
};

/* ---------- Chat settings & stats ---------- */
const DEFAULT_SETTINGS = {
  enterToSend: true, defaultMode: 'general', defaultModel: null, showMeta: true, linksInPanel: true,
    browserLayout: 'split',
  streaming: true, textSize: 'md', saveHistory: true, shareFeedback: true,
  voice: { lang: 'en-NG', method: 'auto', autoSend: false, readAloudRate: 1 },
};

async function loadSettings(userId) {
  const row = await db.one('SELECT settings FROM chat_settings WHERE user_id = ?', [userId]);
  const s = (row && store.json(row.settings)) || {};
  return { ...DEFAULT_SETTINGS, ...s, voice: { ...DEFAULT_SETTINGS.voice, ...(s.voice || {}) } };
}

module.exports = { MAX_CONTENT, wantsWeb, previousUserText, DEFAULT_SETTINGS, loadSettings };
