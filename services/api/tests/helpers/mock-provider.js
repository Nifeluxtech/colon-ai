// A fake OpenAI-compatible provider for tests and local end-to-end runs (no network, no keys).
//   model "*429*"  -> HTTP 429      model "*500*" -> HTTP 500      model "*404*" -> HTTP 404
//   model "*hang*" -> never answers  model "*drop*" -> sends one token then breaks the stream
//   anything else  -> streams "Mock reply (<model>): <last user text>" word by word
// Run standalone: node test/helpers/mock-provider.js 4010
const http = require('http');

function lastUserText(messages) {
  const m = [...(messages || [])].reverse().find(x => x.role === 'user');
  if (!m) return '';
  return Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join(' ') : String(m.content);
}

function create() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* ignore */ }
      calls.push({ url: req.url, auth: req.headers.authorization, body: j });
      const model = String(j.model || '');
      if (req.url !== '/chat/completions' && !req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('{}'); }
      if (model.includes('429')) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"rate limited"}}'); }
      if (model.includes('500')) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"boom"}}'); }
      if (model.includes('404')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"No endpoints found"}}'); }
      if (model.includes('hang')) return; // never answers
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const text = `Mock reply (${model}): ${lastUserText(j.messages).slice(0, 200)}`;
      const words = text.split(/(?<= )/);
      if (model.includes('drop')) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words[0] } }] })}\n\n`);
        return setTimeout(() => res.destroy(), 20);
      }
      let i = 0;
      const tick = () => {
        if (res.destroyed) return;
        if (i < words.length) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] } }] })}\n\n`);
          return setTimeout(tick, model.includes('slow') ? 60 : 2);
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      };
      tick();
    });
  });
  return { server, calls, listen: (port = 0) => new Promise(r => server.listen(port, '127.0.0.1', () => r(server.address().port))) };
}

if (require.main === module) {
  const m = create();
  m.listen(Number(process.argv[2] || 4010)).then(p => console.log(`mock provider on http://127.0.0.1:${p}`));
}

module.exports = { create };
