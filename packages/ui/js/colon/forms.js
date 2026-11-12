/* Colon App core · form fields and form binding (validation, loading state, server errors per field). */

import { $, $$, esc } from './dom.js';
import { icon } from './icons.js';
import { toast } from './overlays.js';

/* ---------- Forms ---------- */
function field(o) {
  var id = 'f-' + o.name, type = o.type || 'text';
  var input = type === 'select'
    ? '<select class="select" id="' + id + '" name="' + o.name + '">' + o.options.map(function (op) {
      return '<option value="' + op[0] + '"' + (op[0] === o.value ? ' selected' : '') + '>' + esc(op[1]) + '</option>';
      }).join('') + '</select>'
    : '<input class="input' + (o.cls ? ' ' + o.cls : '') + '" id="' + id + '" name="' + o.name + '" type="' + type
      + '"' +
      (o.value != null ? ' value="' + esc(o.value) + '"' : '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder)
        + '"' : '') +
      (o.auto ? ' autocomplete="' + o.auto + '"' : '') + (o.mode ? ' inputmode="' + o.mode + '"' : '') + (o.max
        ? ' maxlength="' + o.max + '"' : '') + (o.required === false ? '' : ' required') + '>';
  if (type === 'password') input = '<div class="pw-wrap">' + input
    + '<button type="button" class="icon-btn" data-pw aria-label="Show password">' + icon('eye') + '</button></div>';
  return '<div class="field" data-field="' + o.name + '"><label for="' + id + '">' + esc(o.label) + '</label>' + input
    + (o.meter ? '<div class="meter"><i></i></div>' : '') + '<div class="msg"></div></div>';
}
function bindForm(form, submit) {
  $$('[data-pw]', form).forEach(function (b) {
    b.addEventListener('click', function () {
      var i = b.previousElementSibling, show = i.type === 'password';
      i.type = show ? 'text' : 'password'; b.innerHTML = icon(show ? 'eyeoff' : 'eye'); b.setAttribute('aria-label',
        show ? 'Hide password' : 'Show password');
    });
  });
  $$('.meter', form).forEach(function (m) {
    var i = $('input', m.parentNode);
    i.addEventListener('input', function () {
      var v = i.value, s = 0; if (v.length >= 10) s++; if (v.length >= 14) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(
        v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
      var bar = $('i', m); bar.style.width = (s * 20) + '%'; bar.style.background = s < 3 ? 'var(--bad)' : s < 4
        ? 'var(--warn)' : 'var(--ok)';
    });
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    $$('.field', form).forEach(function (f) { f.classList.remove('err'); $('.msg', f).textContent = ''; });
    var btn = $('button[type=submit]', form), label = btn.innerHTML;
    var data = {}; new FormData(form).forEach(function (v, k) { data[k] = typeof v === 'string' ? v.trim() === v ? v : (
      k.indexOf('password') > -1 ? v : v.trim()) : v; });
    $$('input[type=checkbox]', form).forEach(function (c) { data[c.name] = c.checked; });
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    Promise.resolve().then(function () { return submit(data); }).catch(function (err) {
      var f = err.field && $('[data-field="' + err.field + '"]', form);
      if (f) { f.classList.add('err'); $('.msg', f).textContent = err.message; var inp = $('input', f);
        if (inp) inp.focus(); }
      else toast(err.message, 'bad');
    }).then(function () { if (document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = label; } });
  });
}

export { bindForm, field };
