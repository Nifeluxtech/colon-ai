// Server-sent events, both directions.
// - createParser(): incremental parser for provider streams (OpenAI-style "data: {json}" ... "data: [DONE]").
// - thinkFilter(): hides <think>…</think> reasoning that some models (Qwen 3, DeepSeek R1) put in the text.
// - writer(res): our own stream to the Colon AI app: "event: <name>\ndata: <json>\n\n" (chat-data.js parses it).

function createParser(onEvent) {
  let buf = '';
  let data = [];
  let event = '';
  function dispatch() {
    if (data.length) onEvent({ event: event || 'message', data: data.join('\n') });
    data = []; event = '';
  }
  function line(l) {
    if (l === '') return dispatch();
    if (l[0] === ':') return;                      // comment / keep-alive
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value[0] === ' ') value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  }
  return {
    push(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.search(/\r\n|\r|\n/)) > -1) {
        const len = buf[nl] === '\r' && buf[nl + 1] === '\n' ? 2 : 1;
        line(buf.slice(0, nl));
        buf = buf.slice(nl + len);
      }
    },
    end() { if (buf) { line(buf); buf = ''; } dispatch(); },
  };
}

// Streams text through, dropping anything inside <think>…</think>, even when a tag is split across chunks.
function thinkFilter() {
  const OPEN = '<think>', CLOSE = '</think>';
  let inside = false, pending = '';
  function partialTail(s, tag) {
    for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n;
    return 0;
  }
  return {
    push(text) {
      let s = pending + text, out = '';
      pending = '';
      while (s) {
        const tag = inside ? CLOSE : OPEN;
        const i = s.indexOf(tag);
        if (i > -1) {
          if (!inside) out += s.slice(0, i);
          s = s.slice(i + tag.length);
          inside = !inside;
          if (!inside) s = s.replace(/^\s+/, '');      // no blank lines left where the reasoning was
          continue;
        }
        const keep = partialTail(s, tag);
        if (!inside) out += s.slice(0, s.length - keep);
        pending = s.slice(s.length - keep);
        s = '';
      }
      return out;
    },
    flush() { const p = inside ? '' : pending; pending = ''; return p; },
  };
}

function writer(res) {
  let open = true;
  res.on('close', () => { open = false; });
  const send = (event, data) => {
    if (!open || res.writableEnded) return false;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  };
  return {
    get open() { return open && !res.writableEnded; },
    send,
    comment(text = 'ping') { if (open && !res.writableEnded) res.write(`: ${text}\n\n`); },
    end() { if (!res.writableEnded) res.end(); open = false; },
  };
}

module.exports = { createParser, thinkFilter, writer };
