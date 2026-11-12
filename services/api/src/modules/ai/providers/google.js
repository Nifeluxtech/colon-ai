// Provider: Google AI Studio, native Gemini API (Gemma models are only served there, not on its OpenAI endpoint).
// Enabled only when GEMINI_API_KEY is set. Also holds the native request/response mapping used by client.js.
const { env } = require('./env');

const config = () => ({
  // Native Gemini API: Google serves Gemma models only there, not on its OpenAI-compatible endpoint.
  name: 'Google AI Studio', baseUrl: env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'), apiKey: env('GEMINI_API_KEY', ''),
  native: 'gemini',
  // Gemma 4 takes thinkingLevel "minimal" (fast, no hidden reasoning) or "high". Set GEMINI_THINKING=off to omit.
  thinkingLevel: env('GEMINI_THINKING', 'minimal') === 'off' ? '' : env('GEMINI_THINKING', 'minimal'),
});

/* ---------- Google AI Studio native API (Gemma models are not served on its OpenAI endpoint) ---------- */
function geminiParts(content) {
  if (typeof content === 'string') return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (!p) continue;
    if (p.type === 'text' && p.text) out.push({ text: p.text });
    else if (p.type === 'image_url') {
      const u = String((p.image_url && (p.image_url.url || p.image_url)) || '');
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(u);
      if (m) out.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
  }
  return out;
}

function geminiBody(o) {
  const system = [];
  const contents = [];
  for (const msg of o.messages || []) {
    if (msg.role === 'system') { const t = typeof msg.content === 'string' ? msg.content : geminiParts(msg.content).map(x => x.text || '').join('\n'); if (t) system.push(t); continue; }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = geminiParts(msg.content);
    if (!parts.length) continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts); else contents.push({ role, parts });
  }
  const gen = {};
  if (o.maxTokens) gen.maxOutputTokens = o.maxTokens;
  if (o.temperature !== undefined) gen.temperature = o.temperature;
  if (o.provider.thinkingLevel) gen.thinkingConfig = { thinkingLevel: o.provider.thinkingLevel };
  return {
    contents,
    ...(system.length ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}),
    ...(Object.keys(gen).length ? { generationConfig: gen } : {}),
  };
}

function geminiChunk(j) {
  const c = j && Array.isArray(j.candidates) ? j.candidates[0] : null;
  let text = '', alive = false;
  const parts = (c && c.content && c.content.parts) || [];
  for (const p of parts) {
    alive = true;
    if (p.thought) continue;                 // hidden reasoning
    if (typeof p.text === 'string') text += p.text;
  }
  let finish = null;
  if (c && c.finishReason) finish = c.finishReason === 'MAX_TOKENS' ? 'length' : c.finishReason === 'STOP' ? 'stop' : String(c.finishReason).toLowerCase();
  const u = j && j.usageMetadata;
  const usage = u ? { prompt_tokens: u.promptTokenCount || 0, completion_tokens: u.candidatesTokenCount || 0, total_tokens: u.totalTokenCount || 0 } : null;
  return { text, alive, finish, usage };
}

function geminiEmptyReason(list) {
  for (const j of list) {
    const b = j && j.promptFeedback && j.promptFeedback.blockReason;
    if (b) return `The request was blocked by the provider (${b}).`;
  }
  return '';
}

module.exports = { config, geminiParts, geminiBody, geminiChunk, geminiEmptyReason };
