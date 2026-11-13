// The benchmark CLI end to end against a local mock NVIDIA host: a run killed with SIGTERM leaves a "stopped"
// checkpoint, and `--resume` finishes it without asking any answered item again.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.resolve(__dirname, '../../scripts/bench.js');

function mockHost(delayMs) {
  const asked = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      asked.push(JSON.parse(b).messages[1].content.slice(0, 40));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      setTimeout(() => {
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Answer: 6' } }] })}\n\n`
          + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      }, delayMs);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, asked, port: server.address().port })));
}

function bench(args, env, { killAfterRows = 0, file } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, stdio: 'pipe' });
    let out = '', killed = false;
    p.stdout.on('data', (d) => {
      out += d;
      const rows = killAfterRows && !killed && fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
      if (killAfterRows && rows >= killAfterRows) { killed = true; p.kill('SIGTERM'); }
    });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code, out }));
  });
}

test('bench CLI: SIGTERM leaves a stopped checkpoint, --resume finishes the run', async () => {
  const { server, asked, port } = await mockHost(150);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-cli-'));
  const env = { NVIDIA_BASE_URL: `http://127.0.0.1:${port}/v1`, NVIDIA_API_KEY: 'test', BENCH_RESULTS_DIR: dir,
    APP_SECRET: process.env.APP_SECRET || 'unit-test-secret-0123456789abcdef0123' };
  const file = path.join(dir, 'runs', 'r1', 'nvidia-z-ai-glm-5-3-flash.jsonl');
  const args = ['--sets', 'waec', '--limit', '6', '--gap-ms', '0'];
  try {
    const first = await bench(['--run', 'r1', '--models', 'nvidia:z-ai/glm-5.3-flash', ...args], env,
      { killAfterRows: 2, file });
    assert.equal(first.code, 130, first.out);
    const status = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.status.json'), 'utf8'));
    assert.equal(status.state, 'stopped');
    const answered = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
    assert.ok(answered >= 2 && answered < 6);
    const before = asked.length;
    const second = await bench(['--resume'], env);   // sets, limit, gap taken from the stopped run
    assert.equal(second.code, 0, second.out);
    assert.match(second.out, new RegExp(`${6 - answered} items to run \\(${answered} kept\\)`));
    assert.equal(asked.length - before, 6 - answered, 'answered items are not asked again');
    assert.equal(JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.status.json'), 'utf8')).state, 'done');
    const rep = JSON.parse(fs.readFileSync(path.join(dir, 'r1.json'), 'utf8'));
    assert.equal(rep.models[0].status, 'done');
    assert.equal(rep.models[0].items, 6);
    assert.equal(rep.settings.provider_limits.nvidia.rpm, 30);
    assert.deepEqual(rep.settings.per_model['nvidia:z-ai/glm-5.3-flash'].body, { reasoning_effort: 'low' });
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
