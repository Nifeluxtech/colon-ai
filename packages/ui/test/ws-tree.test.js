// Unit tests for apps/chat/src/lib/ws-tree.js (v0.31.0): the IDE tab's folder tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const tree = require('../../../apps/chat/src/lib/ws-tree.js');

const PATHS = ['index.html', 'css/site.css', 'js/lib/a.js', 'js/app.js', 'images/.gitkeep', 'About.html'];

test('buildTree: folders first and sorted, nested, .gitkeep hidden but its folder kept', () => {
  const t = tree.buildTree(PATHS);
  assert.deepEqual(t.dirs.map((d) => d.name), ['css', 'images', 'js']);
  assert.deepEqual(t.files, ['About.html', 'index.html']);
  const js = t.dirs[2];
  assert.deepEqual(js.dirs.map((d) => d.path), ['js/lib']);
  assert.deepEqual(js.files, ['js/app.js']);
  assert.deepEqual(t.dirs[1].files, []);
  assert.deepEqual(tree.folders(PATHS), ['css', 'images', 'js', 'js/lib']);
});

test('movePlan, under and path helpers', () => {
  assert.deepEqual(tree.movePlan(PATHS, 'js', 'src/js'), [{ from: 'js/lib/a.js', to: 'src/js/lib/a.js' },
    { from: 'js/app.js', to: 'src/js/app.js' }]);
  assert.throws(() => tree.movePlan(PATHS, 'js', 'js/inner'));
  assert.deepEqual(tree.movePlan(PATHS, 'js', 'js'), []);
  assert.deepEqual(tree.under(PATHS, 'css'), ['css/site.css']);
  assert.equal(tree.parentOf('js/lib/a.js'), 'js/lib');
  assert.equal(tree.parentOf('index.html'), '');
  assert.equal(tree.baseName('js/lib/a.js'), 'a.js');
  assert.equal(tree.join('js', ' b.js '), 'js/b.js');
  assert.equal(tree.join('', 'b.js'), 'b.js');
  assert.equal(tree.isKeep('images/.gitkeep'), true);
});
