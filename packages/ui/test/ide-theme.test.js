// Unit tests for apps/chat/src/lib/ide-theme.js (v0.31.1): the Code tab's light syntax theme reaches WCAG AA.
const test = require('node:test');
const assert = require('node:assert/strict');
const th = require('../../../apps/chat/src/lib/ide-theme.js');

function lum(hex) {
  const v = hex.replace('#', '').slice(0, 6).match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

test('themeName: light mode gets colon-light, dark mode keeps vs-dark', () => {
  assert.equal(th.themeName('light'), 'colon-light');
  assert.equal(th.themeName('dark'), 'vs-dark');
  assert.equal(th.themeName(undefined), 'vs-dark');
});

test('every token colour is at least 4.5:1 on the editor and on the current-line highlight', () => {
  const fgs = th.LIGHT.rules.filter((r) => r.foreground).map((r) => [r.token, r.foreground]);
  const c = th.LIGHT.colors;
  Object.keys(c).filter((k) => /^editorBracketHighlight\.|^editor\.foreground$|^editorLineNumber\./.test(k))
    .forEach((k) => fgs.push([k, c[k]]));
  assert.ok(fgs.length > 20);
  for (const [token, fg] of fgs) {
    assert.ok(contrast(fg, th.BG) >= 4.5, `${token} ${fg} on ${th.BG}: ${contrast(fg, th.BG).toFixed(2)}`);
    if (!/^editorLineNumber/.test(token)) {
      assert.ok(contrast(fg, th.LINE_BG) >= 4.5, `${token} ${fg} on ${th.LINE_BG}`);
    }
  }
  assert.equal(c['editor.background'], th.BG);
  assert.equal(c['editor.lineHighlightBackground'], th.LINE_BG);
});

test('defineThemes registers colon-light once, with Monaco-style colours (no #) in the rules', () => {
  const calls = [];
  const monaco = { editor: { defineTheme: (name, t) => calls.push([name, t]) } };
  th.defineThemes(monaco); th.defineThemes(monaco); th.defineThemes(null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'colon-light');
  assert.equal(calls[0][1].base, 'vs');
  assert.ok(calls[0][1].rules.every((r) => !r.foreground || /^[0-9A-F]{6}$/i.test(r.foreground)));
  assert.equal(calls[0][1].colors['editor.background'], '#FFFFFF');
});
