// Function calling for the chat model (0.11.5). The chat model gets tools (Gemini function declarations) and decides
// on each turn whether to use one; the chat module declares them (modules/chat/browser-tools.js: browse, read_page,
// stop_browsing). This file only talks to Google AI Studio's native streamGenerateContent with tools, through the
// same streaming client as every reply (client.js), one model at a time:
//   CHAT_TOOL_MODEL (default gemini-3.5-flash-lite), then CHAT_TOOL_FALLBACK_MODEL (default gemma-4-26b-a4b-it: Gemma 4
//   supports native function calling on the Gemini API, ai.google.dev/gemma/docs/core/gemma_on_gemini_api).
// Text streams to onDelta as it comes; function calls are collected whole (Gemini 3 sends a thoughtSignature with
// each, which must go back unchanged in the next round). A model that fails before any text reached the user hands
// over to the next one; when every model failed the error has code 'tools_failed', and the caller falls back to the
// plain chain (generate.js, AI_MODEL_SET) with the old keyword routing for the browser.
//   stream({ routing, messages, tools, signal, onDelta, fetch, timeouts, models? })
//     -> { text, calls: [{ name, args, part }], providerId, model, attempts }
const routingDefault = require('./routing');
const { streamChat } = require('./client');
const log = require('../../shared/logger');

const env = (k, d, e = process.env) => (e[k] !== undefined && e[k] !== '' ? e[k] : d);

/** The tool models in order ('off' skips one; CHAT_BROWSER_TOOLS=off: none, the old routing only). */
function models(e = process.env) {
  if (String(env('CHAT_BROWSER_TOOLS', 'on', e)).toLowerCase() === 'off') return [];
  return [env('CHAT_TOOL_MODEL', 'gemini-3.5-flash-lite', e), env('CHAT_TOOL_FALLBACK_MODEL', 'gemma-4-26b-a4b-it', e)]
    .map((m) => String(m).trim()).filter((m) => m && m.toLowerCase() !== 'off')
    .filter((m, i, a) => a.indexOf(m) === i);
}

/** Google AI Studio's provider entry when its key is set (the only host with native function calling here). */
function provider(cfg = routingDefault) {
  const p = (cfg.providers ? cfg.providers() : {}).gemini;
  return p && p.apiKey && p.native === 'gemini' ? { id: 'gemini', ...p } : null;
}

const available = (cfg) => Boolean(provider(cfg) && models().length);

function callsOf(parts) {
  return (parts || []).map((p) => ({ name: String(p.functionCall.name).slice(0, 40),
    args: p.functionCall.args && typeof p.functionCall.args === 'object' ? p.functionCall.args : {}, part: p }));
}

async function stream(o) {
  const p = provider(o.routing || routingDefault);
  const list = o.models || models();
  const attempts = [];
  if (!p || !list.length) throw Object.assign(new Error('No tool model is configured.'), { code: 'tools_failed',
    attempts });
  const t = o.timeouts || {};
  for (const model of list) {
    const started = Date.now();
    const parts = [];
    let sent = false;
    try {
      const r = await streamChat({ provider: p, model, messages: o.messages, tools: o.tools, signal: o.signal,
        fetch: o.fetch, maxTokens: t.maxTokens, firstTokenTimeoutMs: t.toolTimeoutMs || t.firstTokenTimeoutMs,
        idleTimeoutMs: t.idleTimeoutMs, maxMs: t.maxReplyMs, onCall: (c) => parts.push(...c),
        onDelta: (piece) => { sent = true; if (o.onDelta) o.onDelta(piece); }, onThought: o.onThought });
      attempts.push({ provider: 'gemini', model, ok: true, ms: Date.now() - started });
      return { text: r.text || '', calls: callsOf(parts), providerId: 'gemini', model, attempts };
    } catch (e) {
      if (e.name === 'AbortError') { e.attempts = attempts; throw e; }
      attempts.push({ provider: 'gemini', model, ok: false, code: e.code, status: e.status, ms: Date.now() - started });
      log.warn('ai_tool_model_failed', { model, code: e.code, status: e.status, err: String(e.message).slice(0, 160) });
      // Text already reached the user: no silent switch to another model mid-answer.
      if (sent || e.partial) { e.attempts = attempts; throw e; }
    }
  }
  throw Object.assign(new Error('The tool models did not answer.'), { code: 'tools_failed', attempts });
}

module.exports = { stream, models, provider, available };
