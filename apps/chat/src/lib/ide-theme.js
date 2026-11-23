/* Colon AI · code editor themes (v0.31.1). Light mode used Monaco's stock "vs" theme (plain red and blue, a grey
   line border) inside a dark navy box; it now gets "colon-light", built from Colon's light palette (ink #0F172A on
   white, royal blue keywords and tags, cyan-700 attributes, green strings, amber numbers, slate comments). Every
   token colour reaches WCAG AA (4.5:1) on the editor background and on the current-line highlight; that is
   unit-tested in packages/ui/test/ide-theme.test.js. Dark mode keeps Monaco's "vs-dark", unchanged.
   DOM-free (the Monaco calls take the monaco object):
     themeName(theme)            'light' -> 'colon-light', anything else -> 'vs-dark'
     defineThemes(monaco)        registers colon-light (once per monaco object)
     LIGHT                       the theme ({ base, inherit, rules, colors }, colours with #)
     BG, LINE_BG                 the editor background and the current-line highlight */
var BG = '#FFFFFF', LINE_BG = '#F4F6FB';
var INK = '#0F172A', BLUE = '#3457C7', CYAN = '#0E7490', GREEN = '#15803D', AMBER = '#B45309', SLATE = '#5B6B82',
  PUNCT = '#475569', VIOLET = '#6D28D9', PINK = '#BE185D';

var LIGHT = {
  // inherit: false, so none of the stock rules (red attribute names, pure blue keywords) leak through
  base: 'vs', inherit: false,
  rules: [
    { token: '', foreground: INK },
    { token: 'comment', foreground: SLATE, fontStyle: 'italic' },
    { token: 'keyword', foreground: BLUE }, { token: 'keyword.flow', foreground: BLUE },
    { token: 'string', foreground: GREEN }, { token: 'string.escape', foreground: AMBER },
    { token: 'number', foreground: AMBER }, { token: 'constant', foreground: AMBER },
    { token: 'regexp', foreground: PINK },
    { token: 'type', foreground: VIOLET }, { token: 'type.identifier', foreground: VIOLET },
    { token: 'identifier', foreground: INK }, { token: 'variable', foreground: INK },
    { token: 'variable.predefined', foreground: BLUE },
    { token: 'delimiter', foreground: PUNCT }, { token: 'operator', foreground: PUNCT },
    { token: 'tag', foreground: BLUE }, { token: 'metatag', foreground: SLATE },
    { token: 'attribute.name', foreground: CYAN }, { token: 'attribute.value', foreground: GREEN },
    { token: 'attribute.value.number', foreground: AMBER }, { token: 'attribute.value.unit', foreground: AMBER },
    { token: 'attribute.value.hex', foreground: AMBER },
    { token: 'string.key.json', foreground: CYAN }, { token: 'string.value.json', foreground: GREEN },
    { token: 'keyword.json', foreground: BLUE },
    { token: 'keyword.md', foreground: BLUE, fontStyle: 'bold' }, { token: 'string.link.md', foreground: CYAN },
    { token: 'variable.md', foreground: VIOLET }, { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'invalid', foreground: '#B91C1C' }, { token: 'annotation', foreground: SLATE },
    { token: 'key', foreground: CYAN }, { token: 'predefined', foreground: VIOLET },
    { token: 'metatag.content', foreground: SLATE }, { token: 'meta', foreground: BLUE },
  ],
  colors: {
    'editor.background': BG, 'editor.foreground': INK,
    'editorGutter.background': BG,
    'editorLineNumber.foreground': '#64748B', 'editorLineNumber.activeForeground': INK,
    'editor.lineHighlightBackground': LINE_BG, 'editor.lineHighlightBorder': LINE_BG,
    'editorCursor.foreground': '#4169E1',
    'editor.selectionBackground': '#D6E1FF', 'editor.inactiveSelectionBackground': '#E6ECFB',
    'editor.selectionHighlightBackground': '#EAF0FF', 'editor.wordHighlightBackground': '#EAF0FF',
    'editor.findMatchBackground': '#FDE68A', 'editor.findMatchHighlightBackground': '#FEF3C7',
    'editorBracketMatch.background': '#EAF0FF', 'editorBracketMatch.border': '#93AEF5',
    'editorIndentGuide.background': '#E2E8F0', 'editorIndentGuide.activeBackground': '#CBD5E1',
    'editorWhitespace.foreground': '#CBD5E1',
    'editorWidget.background': BG, 'editorWidget.border': '#E2E8F0',
    'editorSuggestWidget.background': BG, 'editorSuggestWidget.border': '#E2E8F0',
    'editorSuggestWidget.selectedBackground': '#EAF0FF', 'editorHoverWidget.background': BG,
    'editorHoverWidget.border': '#E2E8F0',
    'scrollbarSlider.background': '#CBD5E166', 'scrollbarSlider.hoverBackground': '#94A3B888',
    'scrollbarSlider.activeBackground': '#64748B88', 'scrollbar.shadow': '#0F172A14',
    'focusBorder': '#4169E1', 'editorOverviewRuler.border': '#E2E8F0',
    // bracket pair colours (Monaco colours nested brackets; the stock ones were pure blue, green and brown)
    'editorBracketHighlight.foreground1': BLUE, 'editorBracketHighlight.foreground2': VIOLET,
    'editorBracketHighlight.foreground3': CYAN, 'editorBracketHighlight.foreground4': BLUE,
    'editorBracketHighlight.foreground5': VIOLET, 'editorBracketHighlight.foreground6': CYAN,
    'editorBracketHighlight.unexpectedBracket.foreground': '#B91C1C',
  },
};

function themeName(theme) { return theme === 'light' ? 'colon-light' : 'vs-dark'; }

// Monaco wants colours without '#' in rules (colors keep it)
function forMonaco(t) {
  return { base: t.base, inherit: t.inherit, colors: t.colors, rules: t.rules.map(function (r) {
    var o = { token: r.token }; if (r.foreground) o.foreground = r.foreground.slice(1);
    if (r.fontStyle) o.fontStyle = r.fontStyle; return o; }) };
}
function defineThemes(monaco) {
  if (!monaco || !monaco.editor || monaco.__colonThemes) return;
  monaco.editor.defineTheme('colon-light', forMonaco(LIGHT));
  monaco.__colonThemes = true;
}

export { BG, LINE_BG, LIGHT, defineThemes, themeName };
