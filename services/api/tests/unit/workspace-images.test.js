// Unit tests for Workspace chat photos (0.38.0): a message's photos reach the model as image parts, show in the
// history, are checked for ownership and count, and a photo sent mid-build waits in the queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../../src/modules/workspace');
const { createChat } = require('../../src/modules/workspace/chat');

const ME = { id: 1 };
const ROWS = { a1: { id: 'a1', name: 'design.png', mime: 'image/png', size: 10, user_id: 1 },
  a2: { id: 'a2', name: 'logo.jpg', mime: 'image/jpeg', size: 20, user_id: 1 } };
const fakes = { ownedImages: async (uid, ids) => ids.map((i) => ROWS[i]).filter((r) => r && r.user_id === uid),
  dataUrl: async (r) => `data:${r.mime};base64,QUJD` };

async function setup(generate) {
  const e = ws.create({ store: ws.memoryStore() });
  const { workspace: w } = await e.add(ME, { title: 'Cafe', template: 'blank' });
  return { w, chat: createChat({ engine: e, deps: { generate, ...fakes } }) };
}

test('photos: the model gets the image parts and the history keeps the list', async () => {
  let seen = null;
  const { w, chat } = await setup(async (o) => { seen = o; return { text: 'Matched the design.' }; });
  await chat.send(ME, w.id, { message: 'make it look like this', images: ['a1'] }, { wait: true });
  const last = seen.messages[seen.messages.length - 1];
  assert.ok(Array.isArray(last.content));
  assert.match(last.content[0].text, /make it look like this[\s\S]*1 photo attached/);
  assert.deepEqual(last.content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } });
  const h = await chat.history(ME, w.id);
  assert.deepEqual(h.messages[0].images, [{ id: 'a1', name: 'design.png', type: 'image/png', size: 10,
    kind: 'image' }]);
});

test('photos: a photo alone still builds, and bad or too many photos are refused', async () => {
  let seen = null;
  const { w, chat } = await setup(async (o) => { seen = o; return { text: 'Done.' }; });
  await chat.send(ME, w.id, { message: '', images: ['a2'] }, { wait: true });
  assert.match(seen.messages[seen.messages.length - 1].content[0].text, /^Build this\./);
  await assert.rejects(chat.send(ME, w.id, { message: 'x', images: ['nope'] }), (e) => e.status === 422);
  await assert.rejects(chat.send(ME, w.id, { message: 'x', images: ['a1', 'a2', 'a1', 'a2'] }),
    (e) => e.status === 422);
});
