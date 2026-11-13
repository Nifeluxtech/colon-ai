/* Colon AI · data adapters: limits, error classes, default settings and small helpers they share. */

import { Colon } from '../../../../packages/ui/js/colon.js';

var C = Colon;

var LIMITS = {
  perMessage: 5,
  kinds: {
    image: { max: 10, types: /^image\/(png|jpe?g|webp|gif)$/, ext: /\.(png|jpe?g|webp|gif)$/i, label: 'Image' },
    pdf: { max: 20, types: /^application\/pdf$/, ext: /\.pdf$/i, label: 'PDF' },
    // .zip = a code project for Developer mode (stored as a document; the server unpacks it safely).
    doc: { max: 20, types: /(msword|officedocument|opendocument|rtf|^application\/(x-)?zip(-compressed)?$)/,
      ext: /\.(docx?|odt|rtf|pptx?|xlsx?|zip)$/i, label: 'Document' },
    text: { max: 2, types: /^(text\/|application\/(json|xml|x-yaml|javascript|x-sh|sql))/, ext: new RegExp(
      '\\.(txt|md|csv|json|xml|ya?ml|js|ts|py|java|c|cpp|cs|go|rs|php|sql|html|css|sh|log|jsx|tsx|mjs|cjs|vue|svelte|'
      + 'scss|less|h|hpp|kt|kts|swift|rb|dart|lua|r|pl|toml|ini|cfg|conf|env\\.example|gradle|properties|bat|ps1|'
      + 'graphql|gql|prisma|twig|ejs|hbs)$', 'i'), label: 'Text file' },
    audio: { max: 10, types: /^audio\//, ext: /\.(webm|ogg|m4a|mp3|wav)$/i, label: 'Voice note', recorderOnly: true }
  },
  accept: ('image/png,image/jpeg,image/webp,image/gif,application/pdf,.doc,.docx,.odt,.rtf,.ppt,.pptx,.xls,.xlsx,.t'
    + 'xt,.md,.csv,.json,.xml,.yaml,.yml,.js,.ts,.py,.java,.c,.cpp,.cs,.go,.rs,.php,.sql,.html,.css,.sh,.log,.zip,'
    + '.jsx,.tsx,.mjs,.cjs,.vue,.svelte,.scss,.less,.h,.hpp,.kt,.swift,.rb,.dart,.lua,.toml,.ini,.gradle,.prisma')
};
// -> { kind } or throws { code, message }
function classify(file, opts) {
  var name = file.name || '', type = file.type || '';
  var kind = Object.keys(LIMITS.kinds).filter(function (k) { var d = LIMITS.kinds[k]; return d.types.test(type)
    || d.ext.test(name); })[0];
  if (!kind || (LIMITS.kinds[kind].recorderOnly && !(opts && opts.fromRecorder))) throw Object.assign(new Error('“'
    + name + '” isn’t a supported file. Use images, PDFs, documents or text files.'), { code: 'unsupported' });
  var max = LIMITS.kinds[kind].max;
  if (file.size > max * 1048576) throw Object.assign(new Error('“' + name + '” is ' + C.fmtBytes(file.size) + '. '
    + LIMITS.kinds[kind].label + 's can be up to ' + max + ' MB.'), { code: 'too_large' });
  if (!file.size) throw Object.assign(new Error('“' + name + '” is empty.'), { code: 'empty' });
  return { kind: kind };
}

var DEFAULT_SETTINGS = {
  enterToSend: true, defaultMode: 'general', defaultModel: null, showMeta: true, linksInPanel: true,
    browserLayout: 'split',
  streaming: true, textSize: 'md', saveHistory: true, shareFeedback: true,
  voice: { lang: 'en-NG', method: 'auto', autoSend: false, readAloudRate: 1 }
};

function now() { return new Date().toISOString(); }
function sleep(ms, signal) { return new Promise(function (res, rej) { var t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', function () { clearTimeout(t); rej(Object.assign(new Error('aborted'),
  { name: 'AbortError' })); }); }); }
function summary(c) { return { id: c.id, title: c.title, mode: c.mode, model: c.model, pinned: !!c.pinned,
  archived: !!c.archived, preview: c.preview || '', created_at: c.created_at, updated_at: c.updated_at,
  temporary: !!c.temporary }; }

export { DEFAULT_SETTINGS, LIMITS, classify, now, sleep, summary };
