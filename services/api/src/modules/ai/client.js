// Provider-agnostic OpenAI-compatible chat-completions client with streaming (Node's built-in fetch).
// Works with Groq, OpenRouter, Google AI Studio (native streamGenerateContent, since Gemma isn't on its OpenAI
// endpoint), vLLM/TGI hosts (N-ATLaS) and anything
// else that speaks POST {base}/chat/completions with "stream": true.
const { createParser, thinkFilter } = require('./sse');
const { geminiBody, geminiChunk, geminiEmptyReason } = require('./providers/google');

class ProviderError extends Error {
  constructor(message, { status = 0, code = 'provider_error', partial = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.partial = partial;   // true when some text already reached the user (no fallback then)
    this.retryAfterMs = retryAfterMs;   // from a Retry-After header (429/503), when the host sent one
  }
}

function codeForStatus(status) {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_not_found';
  if (status === 402) return 'payment_required';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'upstream_error';
  return `http_${status}`;
}

// Retry-After is either seconds or an HTTP date; null when absent or unreadable.
function retryAfter(h, now = Date.now()) {
  if (!h) return null;
  if (/^\d+(\.\d+)?$/.test(String(h).trim())) return Math.round(Number(h) * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

function errorMessage(text) {
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0] && j[0].error : j.error;
    return String((e && (e.message || e)) || j.message || text).slice(0, 300);
  } catch { return String(text || '').slice(0, 300); }
}

/**
 * streamChat({ provider:{baseUrl,apiKey,headers}, model, messages, onDelta(text), signal, ... }) -> { text,
 * finishReason, usage }
 * Throws ProviderError (fallback-able) or an AbortError when `signal` aborts (the user pressed Stop).
 */
async function streamChat(o) {
  const fetchImpl = o.fetch || globalThis.fetch;
  const firstTokenMs = o.firstTokenTimeoutMs || 25000;
  const idleMs = o.idleTimeoutMs || 30000;
  const maxMs = o.maxMs || 180000;
  const ctl = new AbortController();
  let timeoutReason = null;
  const onOuterAbort = () => ctl.abort();
  if (o.signal) { if (o.signal.aborted) ctl.abort(); else o.signal.addEventListener('abort', onOuterAbort,
    { once: true }); }

  let idleTimer = null;
  const arm = (ms, reason) => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { timeoutReason = reason;
    ctl.abort(); }, ms); };
  const maxTimer = setTimeout(() => { timeoutReason = 'max'; ctl.abort(); }, maxMs);
  arm(firstTokenMs, 'first_token');

  let text = '', finishReason = null, usage = null, live = false;
  const trace = { headers: false, reasoning: 0 };   // for timeout errors: did the host answer at all, did it think
  const filter = thinkFilter();
  const emit = (piece) => {
    if (!piece) return;
    text += piece;
    if (!live && !piece.trim()) return; // leading whitespace isn't a "first token"
    live = true;
    if (o.onDelta) o.onDelta(piece);
  };

  try {
    const native = o.provider.native === 'gemini';
    const base = String(o.provider.baseUrl).replace(/\/+$/, '');
    const body = native ? geminiBody(o) : {
      model: o.model, messages: o.messages, stream: true,
      ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
      ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
      ...(o.provider.body || {}),
      ...(o.body || {}),
    };
    const url = native
      ? `${base}/models/${encodeURIComponent(o.model)}:streamGenerateContent?alt=sse`
      : `${base}/chat/completions`;
    const auth = native ? { 'x-goog-api-key': o.provider.apiKey } : { Authorization: `Bearer ${o.provider.apiKey}` };
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        ...auth, 'Content-Type': 'application/json', Accept: 'text/event-stream',
        ...(o.provider.headers || {}),
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    trace.headers = true;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new ProviderError(errorMessage(t) || `HTTP ${res.status}`, { status: res.status, code: codeForStatus(
        res.status), retryAfterMs: retryAfter(res.headers && res.headers.get && res.headers.get('retry-after')) });
    }
    const type = String(res.headers.get('content-type') || '');
    if (type.includes('application/json')) {      // host ignored "stream": answer arrives in one piece
      const raw = JSON.parse(await res.text());
      if (native) {
        const list = Array.isArray(raw) ? raw : [raw];
        for (const j of list) {
          if (j.error) throw new ProviderError(errorMessage(JSON.stringify(j)), { code: 'upstream_error' });
          const g = geminiChunk(j);
          emit(filter.push(g.text));
          if (g.finish) finishReason = g.finish;
          if (g.usage) usage = g.usage;
        }
        emit(filter.flush());
        if (!live && finishReason !== 'length') throw new ProviderError(geminiEmptyReason(list)
          || 'The model returned an empty reply.', { code: 'empty' });
        return { text, finishReason, usage };
      }
      const j = raw;
      if (j.error) throw new ProviderError(errorMessage(JSON.stringify(j)), { code: 'upstream_error' });
      const c = j.choices && j.choices[0];
      emit(filter.push((c && c.message && c.message.content) || '') + filter.flush());
      return { text, finishReason: c && c.finish_reason, usage: j.usage || null };
    }
    let done = false;
    const parser = createParser(({ data }) => {
      if (done) return;
      if (data === '[DONE]') { done = true; return; }
      let j;
      try { j = JSON.parse(data); } catch { return; }
      if (j.error) throw new ProviderError(errorMessage(JSON.stringify(j)), { code: j.error.code === 429
        ? 'rate_limited' : 'upstream_error', partial: live });
      if (native) {
        const g = geminiChunk(j);
        if (g.alive) arm(idleMs, 'idle');
        emit(filter.push(g.text));
        if (g.finish) finishReason = g.finish;
        if (g.usage) usage = g.usage;
        return;
      }
      if (j.usage) usage = j.usage;
      const c = j.choices && j.choices[0];
      if (!c) return;
      const d = c.delta || c.message || {};
      if (d.content || d.reasoning || d.reasoning_content) arm(idleMs, 'idle');  // reasoning counts as alive
      if (!d.content && (d.reasoning || d.reasoning_content)) trace.reasoning++;
      if (typeof d.content === 'string') emit(filter.push(d.content));
      if (c.finish_reason) finishReason = c.finish_reason;
    });
    const dec = new TextDecoder();
    const reader = res.body.getReader();
    // Cancel the read when we abort (Stop or a timeout), whatever fetch implementation is in use.
    const cancel = () => { reader.cancel().catch(() => {}); };
    ctl.signal.addEventListener('abort', cancel, { once: true });
    try {
      while (!done) {
        const { done: end, value } = await reader.read();
        if (end) break;
        parser.push(dec.decode(value, { stream: true }));
      }
    } finally {
      ctl.signal.removeEventListener('abort', cancel);
      if (done) reader.cancel().catch(() => {});
    }
    if (ctl.signal.aborted) throw new Error('aborted');
    parser.end();
    emit(filter.flush());
    if (!live && finishReason !== 'length') throw new ProviderError('The model returned an empty reply.',
      { code: 'empty' });
    return { text, finishReason, usage };
  } catch (e) {
    if (e instanceof ProviderError) { e.partial = e.partial || live; throw e; }
    if (ctl.signal.aborted && !timeoutReason) {
      const a = new Error('aborted'); a.name = 'AbortError'; a.code = 'aborted'; throw a;
    }
    if (timeoutReason) {
      const err = new ProviderError(timeoutReason === 'first_token' ? 'The model took too long to start answering.' :
        'The model stopped responding.', { code: 'timeout', partial: live });
      // Where it stalled: 'connect' = no response headers (queued/overloaded host), 'first_token' = stream open but
      // no answer text, 'idle' = went quiet mid-answer, 'max' = hit the overall cap. Used by the benchmark report.
      err.phase = timeoutReason === 'first_token' && !trace.headers ? 'connect' : timeoutReason;
      err.reasoningChunks = trace.reasoning;
      throw err;
    }
    throw new ProviderError(`Network error: ${e.message}`, { code: 'network', partial: live });
  } finally {
    clearTimeout(idleTimer); clearTimeout(maxTimer);
    if (o.signal) o.signal.removeEventListener('abort', onOuterAbort);
  }
}

module.exports = { streamChat, ProviderError, codeForStatus, retryAfter, _gemini: { geminiBody, geminiChunk } };
