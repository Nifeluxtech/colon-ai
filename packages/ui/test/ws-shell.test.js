// Unit tests for apps/chat/src/lib/ws-shell.js (v0.27.0, Workspace step 3): the Workspace terminal commands.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShell, joinPath, tokenize } = require('../../../apps/chat/src/lib/ws-shell.js');

function rig() {
  const files = { 'index.html': '<h1>Hi</h1>\n', 'css/site.css': 'body{}\n', 'img/a.png': null };
  const lines = [], runs = [];
  const io = {
    fs: {
      list: () => Object.keys(files).map((p) => ({ path: p, size: 1 })),
      read: (p) => {
        if (!(p in files)) return Promise.reject(new Error('No file ' + p));
        return files[p] === null ? { encoding: 'base64', content: '' } : { encoding: 'utf8', content: files[p] };
      },
      write: (p, text) => { files[p] = text; return Promise.resolve(); },
      remove: (p) => { delete files[p]; return Promise.resolve(); },
      move: (a, b) => { files[b] = files[a]; delete files[a]; return Promise.resolve(); },
    },
    files: () => Promise.resolve(Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null))),
    run: (lang, code, o) => {
      runs.push([lang, code, o.repl, o.cwd]); o.onOut('out', 'ran'); return Promise.resolve();
    },
    print: (k, t) => lines.push([k, t]), clear: () => lines.push(['clear']), open: (p) => lines.push(['open', p]),
  };
  return { sh: createShell(io), files, lines, runs, outs: () => lines.filter((l) => l[0] !== 'cmd').map((l) => l[1]) };
}

test('tokenize handles quotes and redirects', () => {
  assert.deepEqual(tokenize('echo "a b" > x.txt'), ['echo', 'a b', '>', 'x.txt']);
  assert.deepEqual(tokenize("echo hi>>log.txt"), ['echo', 'hi', '>>', 'log.txt']);
  assert.deepEqual(tokenize('js "1"+"2"'), ['js', '1+2']);
});

test('joinPath stays inside the site', () => {
  assert.equal(joinPath('css', '../img/a.png'), 'img/a.png');
  assert.equal(joinPath('css', '/index.html'), 'index.html');
  assert.equal(joinPath('', '..'), null);
});

test('ls, cd, cat, wc and pwd', async () => {
  const r = rig();
  await r.sh.exec('ls');
  assert.equal(r.outs().pop(), 'css/\nimg/\nindex.html');
  await r.sh.exec('cd css');
  assert.equal(r.sh.prompt(), '~/css $ ');
  await r.sh.exec('cat site.css');
  assert.equal(r.outs().pop(), 'body{}\n');
  await r.sh.exec('cd nope');
  assert.match(r.outs().pop(), /no folder/);
  await r.sh.exec('cat ../img/a.png');
  assert.match(r.outs().pop(), /binary file/);
});

test('echo > and >>, touch, cp, mv, rm change files', async () => {
  const r = rig();
  await r.sh.exec('echo hello > notes.txt');
  await r.sh.exec('echo again >> notes.txt');
  assert.equal(r.files['notes.txt'], 'hello\nagain\n');
  await r.sh.exec('cp notes.txt css');
  assert.equal(r.files['css/notes.txt'], 'hello\nagain\n');
  await r.sh.exec('mv notes.txt n.md');
  assert.ok(!('notes.txt' in r.files) && r.files['n.md']);
  await r.sh.exec('rm n.md');
  assert.ok(!('n.md' in r.files));
  await r.sh.exec('touch a.js');
  assert.equal(r.files['a.js'], '');
});

test('grep, unknown commands, code runs and the python prompt', async () => {
  const r = rig();
  await r.sh.exec('grep hi');
  assert.equal(r.outs().pop(), 'index.html:1: <h1>Hi</h1>');
  await r.sh.exec('sudo ls');
  assert.match(r.outs().pop(), /command not found/);
  await r.sh.exec('js 1 + 1');
  assert.deepEqual(r.runs.pop(), ['js', '1 + 1', true, '']);
  await r.sh.exec('js [1,2].map(x=>x*2)');
  assert.deepEqual(r.runs.pop(), ['js', '[1,2].map(x=>x*2)', true, '']);
  await r.sh.exec('python -c "print(\'a > b\')"');
  assert.deepEqual(r.runs.pop(), ['py', "print('a > b')", true, '']);
  await r.sh.exec('python');
  assert.equal(r.sh.prompt(), '>>> ');
  await r.sh.exec('for i in range(2):');
  assert.equal(r.sh.prompt(), '... ');
  await r.sh.exec('    print(i)');
  await r.sh.exec('');
  assert.deepEqual(r.runs.pop(), ['py', 'for i in range(2):\n    print(i)', true, '']);
  await r.sh.exec('exit()');
  assert.equal(r.sh.prompt(), '~ $ ');
  await r.sh.exec('open index.html');
  assert.deepEqual(r.lines.pop(), ['open', 'index.html']);
});
