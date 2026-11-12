// Turns a conversation into the message list the model sees: recent history within a size budget,
// file text inlined as clearly delimited data, and images (latest message only) for vision models.
const MAX_MESSAGES = 24;
const MAX_CHARS = 60000;          // whole prompt budget (≈15k tokens), keeps free-tier limits happy
const FILE_CHARS_LATEST = 24000;  // per file, on the message being answered
const FILE_CHARS_OLDER = 3000;    // per file, on earlier messages

const KIND_LABEL = { pdf: 'PDF', doc: 'document', text: 'text file', image: 'image', audio: 'voice note' };

function fileBlock(f, latest) {
  const bits = [KIND_LABEL[f.kind] || 'file'];
  if (f.pages) bits.push(`${f.pages} page${f.pages > 1 ? 's' : ''}`);
  if (f.duration) bits.push(`${f.duration} s`);
  const head = `[Attached ${bits[0]}: “${f.name}”${bits.length > 1 ? ' (' + bits.slice(1).join(', ') + ')' : ''}]`;
  if (f.kind === 'image') return latest && f.dataUrl ? head : `${head} (image shown earlier in the chat)`;
  if (f.kind === 'audio') return `${head} Voice transcription isn’t available yet, so ask the user to type what they said.`;
  if (!f.text) return `${head} ${f.note || 'No readable text could be extracted from this file.'}`;
  const cap = latest ? FILE_CHARS_LATEST : FILE_CHARS_OLDER;
  const body = f.text.length > cap ? f.text.slice(0, cap) + '\n[…truncated…]' : f.text;
  return `${head}\n<<<FILE\n${body}\nFILE>>>`;
}

/**
 * history: [{ role: 'user'|'assistant', content, files?: [{ name, kind, text, note, pages, duration, dataUrl }] }]
 * The last item is the user message being answered. Returns OpenAI-style messages (no system prompt).
 */
function buildMessages(history) {
  const items = history.filter(m => (m.role === 'user' || m.role === 'assistant') && (String(m.content || '').trim() || (m.files && m.files.length)));
  const out = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0 && out.length < MAX_MESSAGES; i--) {
    const m = items[i];
    const latest = i === items.length - 1;
    let text = String(m.content || '');
    const files = m.files || [];
    if (files.length) text = [text, ...files.map(f => fileBlock(f, latest))].filter(Boolean).join('\n\n');
    if (!text.trim()) text = '(no text)';
    if (!latest && used + text.length > MAX_CHARS) break;
    if (latest && text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n[…truncated…]';
    used += text.length;
    const images = latest ? files.filter(f => f.kind === 'image' && f.dataUrl) : [];
    out.unshift(images.length
      ? { role: m.role, content: [{ type: 'text', text }, ...images.map(f => ({ type: 'image_url', image_url: { url: f.dataUrl } }))] }
      : { role: m.role, content: text });
  }
  // Providers expect the conversation to start with a user turn.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

module.exports = { buildMessages, fileBlock, MAX_MESSAGES, MAX_CHARS };
