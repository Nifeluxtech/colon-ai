// Security tests for 0.17.1 image editing: POST /conversations/:id/images with attachment_ids only ever reads the
// signed-in user's own images in that conversation. A wrong, foreign or non-image id is refused with 422 before
// anything is written or any credit is reserved. A fake db module stands in for MySQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
process.env.APP_SECRET = process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123';
const dbPath = require.resolve('../../src/db');
const writes = [];
const ROWS = [
  { id: 'mine', user_id: 7, conversation_id: 'c1', message_id: 'm1', kind: 'image', mime: 'image/png', size: 9,
    name: 'mine.png', path: '7/mine', meta: '{}' },
  { id: 'theirs', user_id: 8, conversation_id: 'c1', message_id: 'm2', kind: 'image', mime: 'image/png', size: 9,
    name: 'theirs.png', path: '8/theirs', meta: '{}' },
  { id: 'pdf', user_id: 7, conversation_id: 'c1', message_id: 'm1', kind: 'pdf', mime: 'application/pdf', size: 9,
    name: 'cv.pdf', path: '7/pdf', meta: '{}' },
];
const fakeDb = {
  async query(sql, p) {
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) { writes.push(sql); return { affectedRows: 0 }; }
    if (/FROM chat_attachments WHERE user_id = \? AND id IN/.test(sql)) {
      const [uid, ...ids] = p; return ROWS.filter((r) => r.user_id === uid && ids.includes(r.id));
    }
    return [];
  },
  async one(sql, p) {
    if (/FROM chat_conversations/.test(sql)) return p[1] === 7 && p[0] === 'c1' ? { id: 'c1', user_id: 7,
      title: 'New chat', mode: 'general', model: 'm' } : null;
    return null;
  },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb, paths: [path.dirname(dbPath)] };
const media = require('../../src/modules/media');

const req = (ids, uid = 7) => ({ user: { id: uid, role: 'user', language: 'en' }, params: { id: 'c1' },
  body: { prompt: 'make it brighter', attachment_ids: ids } });
const never = { produce: async () => { throw new Error('must not be called'); } };

test('attachment_ids: another user’s image, a missing id or a PDF is refused before any write or charge', async () => {
  for (const ids of [['theirs'], ['nope'], ['pdf'], ['mine', 'theirs']]) {
    await assert.rejects(media.handlers.postConversationsByIdImages(req(ids), null, never),
      (e) => e.status === 422 && e.code === 'invalid' && e.field === 'attachment_ids', ids.join());
  }
  assert.equal(writes.length, 0);
});

test('another user cannot edit in a chat that is not theirs (404 on the conversation)', async () => {
  await assert.rejects(media.handlers.postConversationsByIdImages(req(['mine'], 8), null, never),
    (e) => e.status === 404);
  assert.equal(writes.length, 0);
});
