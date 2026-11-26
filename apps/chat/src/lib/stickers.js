/* Colon AI · stickers (0.37.0): Microsoft Fluent Emoji 3D (MIT, assets/stickers/fluent/) with Colon's Naija
   captions. A sticker in a message is the token [sticker:<id>]; the ids and captions match the API's list
   (services/api/src/modules/ai/fun.js). Fun (Auto or Off) is a per-device choice, like Speed mode. */

import { ColonStore } from '../../../../packages/ui/js/store.js';

var STICKERS = [
  ['laugh', 'Lmao'], ['rofl', 'I don die'], ['omo', 'Omo!'], ['correct', 'Correct!'], ['wahala', 'Wahala'],
  ['echoke', 'E choke!'], ['sapa', 'Sapa'], ['novex', 'No vex'], ['oya', 'Oya!'], ['gbasgbos', 'Gbas gbos'],
  ['love', 'Love you die'], ['thanks', 'Thank you'], ['welldone', 'Well done'], ['odogwu', 'Odogwu'],
  ['hmm', 'Hmm'], ['abeg', 'Abeg'], ['sleep', 'I don sleep'], ['chai', 'Chai'], ['wemove', 'We move!'],
  ['hundred', '100%'], ['mindblown', 'Mind blown'], ['sure', 'Shey you sure?'], ['hug', 'Hug'],
  ['wink', 'You know'], ['dead', 'I\'m dead'], ['strong', 'Strong'], ['aww', 'Aww'], ['gist', 'Gist'],
  ['cashout', 'Cashout'], ['chop', 'Make we chop'], ['morning', 'Good morning'], ['night', 'Good night'],
  ['books', 'Read your book'], ['star', 'Star'], ['eyes', 'I dey look'], ['howfar', 'How far'],
  ['okay', 'Okay'], ['melt', 'I don melt'], ['yessir', 'Yes sir'], ['winner', 'Winner'],
];
var BY_ID = {};
STICKERS.forEach(function (s) { BY_ID[s[0]] = s[1]; });
var BASE = 'assets/stickers/fluent/';
var prefs = ColonStore.prefs('colon.fun', { fun: 'auto' });

function funOn() { return prefs.get().fun !== 'off'; }
function setFun(on) { prefs.set(Object.assign({}, prefs.get(), { fun: on ? 'auto' : 'off' })); }
function token(id) { return '[sticker:' + id + ']'; }
function caption(id) { return BY_ID[id] || ''; }
/** The id when the whole text is one sticker, else null. */
function onlySticker(text) {
  var m = /^\s*\[sticker:([a-z]+)\]\s*$/.exec(String(text || ''));
  return m && BY_ID[m[1]] ? m[1] : null;
}
function imgHtml(id, cls) {
  var c = caption(id).replace(/[&<>"']/g, '');
  return '<img class="cw-sticker' + (cls ? ' ' + cls : '') + '" src="' + BASE + id + '.webp" alt="Sticker: ' + c
    + '" title="' + c + '" loading="lazy" width="120" height="120">';
}
/** Rendered reply HTML with each known [sticker:id] drawn as its picture (unknown ids are dropped). */
function drawStickers(html) {
  return String(html || '').replace(/\[sticker:([a-z]+)\]/g, function (_, id) {
    return BY_ID[id] ? imgHtml(id) : '';
  });
}
/** Text without stickers (copy, read aloud), or the caption when the message is only a sticker. */
function stripStickers(text) {
  var one = onlySticker(text);
  if (one) return caption(one);
  return String(text || '').replace(/\[sticker:[a-z]+\]/g, '').trim();
}

export var Stickers = { LIST: STICKERS, BASE: BASE, caption: caption, drawStickers: drawStickers, funOn: funOn,
  imgHtml: imgHtml, onlySticker: onlySticker, setFun: setFun, stripStickers: stripStickers, token: token };
