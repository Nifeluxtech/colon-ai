// Plain-text style formats (RTF, legacy binary Office) and the clean-up applied to every extracted text.
const { safeChar } = require('./common');

function rtfText(s) {
  return s
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => Buffer.from([parseInt(h, 16)]).toString('latin1'))
    .replace(/\\u(-?\d+)\??/g, (_, n) => safeChar(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}\s*\}/g, '')
    .replace(/\\(par|line)\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\\([\\{}])/g, '$1');
}

// Legacy binary Office files (.doc/.ppt/.xls): pull readable runs of UTF-16 and ASCII text. Approximate.
function oleText(buf) {
  const runs = [];
  const u16 = buf.toString('utf16le');
  for (const m of u16.matchAll(/[\p{L}\p{N}\p{P}\p{Zs}\n\r\t]{6,}/gu)) if (/[\p{L}]{3}/u.test(m[0])) runs.push(m[0]);
  if (runs.join('').length < 200) for (const m of buf.toString('latin1').matchAll(/[\x20-\x7e\n\r\t]{8,}/g)) if (
    /[a-z]{3}/i.test(m[0])) runs.push(m[0]);
  return runs.join('\n');
}

function tidy(t) {
  return String(t || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
    '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function readable(t) {
  if (!t) return false;
  const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  return letters >= 20 && letters / t.length > 0.4;
}

module.exports = { rtfText, oleText, tidy, readable };
