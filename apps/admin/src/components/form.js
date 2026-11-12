/* Colon Admin · form controls: switches, text areas, selects, action buttons; JSON metadata parsing. */

import { head } from './page.js';
import { Colon } from '../../../../packages/ui/js/colon.js';
import { A } from '../core/state.js';

var C = Colon, esc = C.esc, $ = C.$, $$ = C.$$;

function sw(name, label, sub, on, disabled) {
  return '<label class="set-row"><span class="body"><span class="title">' + esc(label) + '</span>' + (sub
    ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</span>' +
    '<span class="switch"><input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + (disabled
      ? ' disabled' : '') + ' aria-label="' + esc(label) + '"><i></i></span></label>';
}
function area(name, label, value, ph) {
  return '<div class="field" data-field="' + name + '"><label for="f-' + name + '">' + esc(label)
    + '</label><textarea class="input textarea" id="f-' + name + '" name="' + name + '"' + (ph ? ' placeholder="'
    + esc(ph) + '"' : '') + '>' + esc(value || '') + '</textarea><div class="msg"></div></div>';
}
function opt(name, label, value, ph, type) { return C.field({ name: name, label: label, value: value == null
  ? '' : value, placeholder: ph, required: false, type: type || 'text' }); }
function sel(name, label, value, options) { return C.field({ name: name, label: label, type: 'select', value: value,
  options: options }); }
function act(p, done) { return p.then(function (r) { if (done) done(r); return r; }).catch(function (e) { C.toast(
  e.message, 'bad'); throw e; }); }
function parseMeta(m) { if (!m) return null; if (typeof m === 'string') { try { return JSON.parse(m);
  } catch (e) { return null; } } return m; }
A.helpers = { head: head, sw: sw, area: area };

export { act, area, opt, parseMeta, sel, sw };
