// Workspace model (v0.31.3). Builds and quick answers try a fast Google AI Studio model first
// (WORKSPACE_MODEL, default gemini-3.5-flash-lite: much faster than Gemma 4 on long code answers), through the same
// streaming client as the chat tool model (ai/tool-call.js). When it is off, has no key, fails or is rate limited,
// the request goes to the normal chain (ai.generate, AI_MODEL_SET) exactly as before. An abort is never retried.
//   wrap(generate, { stream, available, systemPrompt, env }) -> generate(o) with the same result shape
const env = (k, d, e) => (e[k] !== undefined && e[k] !== '' ? e[k] : d);

function model(e = process.env) {
  const m = String(env('WORKSPACE_MODEL', 'gemini-3.5-flash-lite', e)).trim();
  return m && m.toLowerCase() !== 'off' ? m : '';
}

function wrap(generate, kit) {
  const e = kit.env || process.env;
  return async function workspaceGenerate(o) {
    const m = model(e);
    if (!m || !kit.available(o.routing)) return generate(o);
    try {
      const system = kit.systemPrompt({ mode: o.mode, language: o.language || 'en', context: o.context || '' });
      const r = await kit.stream({ routing: o.routing, signal: o.signal, models: [m],
        messages: [{ role: 'system', content: system }, ...o.messages],
        timeouts: { maxTokens: o.timeouts && o.timeouts.maxTokens, firstTokenTimeoutMs: 30000 } });
      if (!String(r.text || '').trim()) throw Object.assign(new Error('empty'), { code: 'empty' });
      return { text: r.text, providerId: r.providerId, providerName: 'Google AI Studio', model: r.model,
        target: 'workspace', attempts: r.attempts, route: 'workspace' };
    } catch (err) {
      if (err.name === 'AbortError' || (o.signal && o.signal.aborted)) throw err;
      return generate(o);
    }
  };
}

function live() {
  const ai = require('../ai');
  const cfg = (r) => r || ai.routing;
  return wrap(ai.generate, { stream: (o) => ai.toolCall.stream({ ...o, routing: cfg(o.routing) }),
    available: (r) => Boolean(ai.toolCall.provider(cfg(r))), systemPrompt: ai.prompts.systemPrompt });
}

module.exports = { wrap, live, model };
