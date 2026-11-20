/* Colon AI · phone control from the chat (Colon OS Assistant, Step 2; docs/os-assistant/step-2.md). Inside the
   Android app, short commands such as "open WhatsApp", "turn on the torch", "volume up", "set an alarm for 6:30 am",
   "set a timer for 5 minutes", "call 08031234567", "wifi settings" or "next song" run on the phone through
   ColonNative.call('phone', cmd). The app checks every command against its own allowlist (PhoneRules.kt) before it
   does anything, so this file only decides what a message asks; it never acts. Narrow on purpose, like
   browser-intent.js: a whole short message that is a command, never a question; everything else stays chat.
   Pure and DOM-free: unit-tested in packages/ui/test/phone-intent.test.js.

   parsePhone(text) -> null or one of
     { action: 'open_app', name, soft: true, app? }   soft: when no app has that name, the message goes on as
                                                 usual; app: the user said "app" ("open the YouTube app")
     { action: 'settings', page }                main · wifi · bluetooth · data · hotspot · location · display ·
                                                 battery · airplane · sound · volume · dnd · apps · storage
     { action: 'torch', on }
     { action: 'volume', op, level? }            up · down · mute · unmute · max · set (level 0–100)
     { action: 'media', op }                     pause · play · next · previous
     { action: 'dial', number }                  opens the dialler with the number; the user taps Call
     { action: 'sms', number, body }             opens Messages with the text; the user taps Send
     { action: 'alarm', hour, minute }
     { action: 'timer', seconds }
     { action: 'navigate', place }
     { action: 'camera' }
     { action: 'unsupported', say }              a phone command Colon can't do yet: say why instead of chatting */

import { clean } from './browser-intent.js';

var PAGES = {
  'wifi': 'wifi', 'wi-fi': 'wifi', 'wi fi': 'wifi', 'wireless': 'wifi', 'bluetooth': 'bluetooth',
  'mobile data': 'data', 'data': 'data', 'internet': 'data', 'network': 'data', 'hotspot': 'hotspot',
  'mobile hotspot': 'hotspot', 'location': 'location', 'gps': 'location', 'brightness': 'display',
  'display': 'display', 'screen': 'display', 'battery': 'battery', 'battery saver': 'battery',
  'power saving': 'battery', 'power saver': 'battery', 'airplane mode': 'airplane', 'aeroplane mode': 'airplane',
  'flight mode': 'airplane', 'sound': 'sound', 'ringtone': 'sound', 'volume': 'volume',
  'do not disturb': 'dnd', 'dnd': 'dnd', 'apps': 'apps', 'app': 'apps', 'storage': 'storage'
};
var TOGGLES = ['wifi', 'wi-fi', 'wi fi', 'bluetooth', 'mobile data', 'data', 'hotspot', 'mobile hotspot', 'location',
  'gps', 'battery saver', 'power saving', 'power saver', 'airplane mode', 'aeroplane mode', 'flight mode',
  'do not disturb', 'dnd'];
var NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45,
  'forty-five': 45, fifty: 50, sixty: 60, ninety: 90 };

// One RegExp from alternatives (each a regular expression string), anchored by each alternative itself.
function any(list) { return new RegExp(list.join('|')); }
var THE = '(?:the\\s+|my\\s+|your\\s+|phone\\s+)?';
var TORCH = '(?:torch|torchlight|flash ?light|flash)';
var SETTINGS_OF = /^(?:open|show(?: me)?|go to|take me to|launch)\s+(?:the\s+|my\s+)?(?:phone\s+)?(.+?)\s+settings$/;
var SETTINGS = /^(?:open|show(?: me)?|go to|launch)\s+(?:the\s+|my\s+)?(?:phone(?:'s)?\s+)?settings$/;
var BARE_SETTINGS = /^(.+?)\s+settings$/;
var TOGGLE = new RegExp('^(?:turn|switch|put)\\s+(on|off)\\s+' + THE + '(.+)$|^(?:turn|switch|put)\\s+' + THE
  + '(.+?)\\s+(on|off)$|^(enable|disable|activate|deactivate)\\s+' + THE + '(.+)$');
var TORCH_ON = new RegExp('^' + TORCH + '\\s+(on|off)$|^(?:open|light)\\s+' + THE + TORCH + '$');
var VOL_UP = any([
  '^(?:turn|crank|pump)\\s+(?:it|the volume|the sound|the music|volume)\\s+up(?: a bit)?$',
  '^(?:volume up|louder|make it louder)$', '^(?:increase|raise)\\s+(?:the\\s+)?(?:volume|sound)$']);
var VOL_DOWN = any([
  '^turn\\s+(?:it|the volume|the sound|the music|volume)\\s+down(?: a bit)?$',
  '^(?:volume down|quieter|softer|make it (?:quieter|softer))$',
  '^(?:reduce|decrease|lower)\\s+(?:the\\s+)?(?:volume|sound)$']);
var VOL_SET = any([
  '^(?:set|put|turn)\\s+(?:the\\s+)?(?:volume|sound)\\s+(?:to|at)\\s+(\\d{1,3})\\s*(?:%|percent|per cent)?$',
  '^volume\\s+(?:to\\s+)?(\\d{1,3})\\s*(?:%|percent|per cent)?$']);
var VOL_MAX = /^(?:max(?:imum)? volume|full volume|volume (?:to )?(?:max(?:imum)?|full))$/;
var MUTE = /^(?:mute|mute (?:the )?(?:phone|sound|volume|music|media))$/;
var UNMUTE = /^(?:unmute|unmute (?:the )?(?:phone|sound|volume|music|media))$/;
var MEDIA = '(?:music|song|track|audio|video|playback|media)';
var PAUSE = new RegExp('^(?:pause|stop)\\s+(?:the\\s+)?' + MEDIA + '$|^pause$');
var PLAY = new RegExp('^(?:resume|unpause|continue playing|play)\\s+(?:the\\s+)?' + MEDIA
  + '(?:\\s+again)?$|^unpause$');
var NEXT = any([
  '^(?:next|skip)\\s+(?:this\\s+|the\\s+)?(?:song|track)$', '^(?:play\\s+)?(?:the\\s+)?next\\s+(?:song|track)$']);
var PREV = any([
  '^(?:previous|last|go back a|back a)\\s+(?:song|track)$',
  '^(?:play\\s+)?(?:the\\s+)?previous\\s+(?:song|track|one)$']);
var CALL = /^(?:call|dial|ring|phone)\s+(.+)$/;
var SMS_TO = '(?:text|sms|send\\s+(?:an?\\s+)?(?:text|sms|message)\\s+to|message)';
var SMS = new RegExp('^' + SMS_TO + '\\s+(\\+?\\d[\\d\\s-]{4,18}\\d)'
  + '(?:\\s*(?:saying|that says|that|and say|:|,)\\s*(.*))?$');
var ALARM = any([
  '^(?:set|create|add|make|put)\\s+(?:an?\\s+|my\\s+)?alarm\\s+(?:for|at|by)\\s+(.+)$',
  '^wake me(?:\\s+up)?\\s+(?:at|by)\\s+(.+)$']);
var TIMER = any([
  '^(?:set|start|create|put)\\s+(?:an?\\s+|the\\s+)?timer\\s+(?:for\\s+|of\\s+|on\\s+)?(.+)$',
  '^(?:time|timer)\\s+(?:for\\s+)?(.+)$', '^(.+?)\\s+timer$']);
var NAV = new RegExp('^(?:navigate|navigation|directions|get (?:me\\s+)?directions|give me directions|drive|route|'
  + 'show me the way|show (?:me\\s+)?the route)\\s+(?:me\\s+)?to\\s+(.+)$');
var CAMERA = any([
  '^(?:open|launch|start|show)\\s+(?:the\\s+|my\\s+)?camera(?:\\s+app)?$',
  '^take\\s+(?:a\\s+|an?\\s+)?(?:photo|picture|pic|selfie|snapshot)$']);
var OPEN_APP = new RegExp('^(?:open(?: up)?|launch|start|run|take me to|go to|switch to|bring up)\\s+'
  + '(?:the\\s+|my\\s+)?(.+?)(\\s+app(?:lication)?)?$');
var NOT_APP = new RegExp('\\b(?:browser|page|site|website|web ?site|tab|link|file|chat|conversation|document|'
  + 'thread|new|this|that|it|them|here|result|results|email|mail from|url|folder|image|picture|photo)\\b');
var DOMAIN = /\.[a-z]{2,}(?:\/|$)|^https?:/;

function strip(text) {
  var t = clean(text).replace(/^(?:hey\s+|hi\s+|ok(?:ay)?\s+)?colon[\s,:]+/, '');
  return t.replace(/[.!?…]+$/, '').replace(/\s+/g, ' ').trim();
}

/** "6:30 am", "7am", "19:00", "6.30 pm", "noon", "midnight" -> { hour, minute } or null. */
function parseTime(s) {
  s = String(s || '').toLowerCase().replace(/\b(?:today|tomorrow|tonight's|o'?clock)\b/g, ' ')
    .replace(/a\.m\.?/g, 'am').replace(/p\.m\.?/g, 'pm').replace(/\s+/g, ' ').trim();
  if (s === 'noon' || s === 'midday') return { hour: 12, minute: 0 };
  if (s === 'midnight') return { hour: 0, minute: 0 };
  var m = /^(\d{1,2})(?:[:. ](\d{2}))?\s*(am|pm|in the morning|in the afternoon|in the evening|at night|tonight)?$/
    .exec(s);
  if (!m) return null;
  var h = +m[1], min = m[2] ? +m[2] : 0, part = m[3] || '';
  if (h > 23 || min > 59) return null;
  var pm = part === 'pm' || /afternoon|evening|night/.test(part), am = part === 'am' || part === 'in the morning';
  if ((pm || am) && (h < 1 || h > 12)) return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return { hour: h, minute: min };
}

/** "5 minutes", "1 hour 30 minutes", "90 seconds", "half an hour", "two minutes" -> seconds or null. */
function parseDuration(s) {
  s = String(s || '').toLowerCase().replace(/half an hour|half hour/g, '30 minutes').replace(/,|\band\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  var unit = { h: 3600, m: 60, s: 1 }, total = 0, any = false;
  var re = /(\d+(?:\.\d+)?|forty[ -]five|[a-z]+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
  var rest = s.replace(re, function (all, n, u) {
    var v = /^\d/.test(n) ? parseFloat(n) : NUMBERS[n];
    if (v === undefined) return all;
    total += v * unit[u.charAt(0)]; any = true; return ' ';
  }).trim();
  if (!any || rest) return null;
  total = Math.round(total);
  return total >= 1 && total <= 86400 ? total : null;
}

function phoneNumber(s) {
  var d = String(s || '').replace(/[\s()-]/g, '');
  return /^\+?\d{3,15}$/.test(d) ? d : null;
}

function page(name) {
  var n = String(name || '').replace(/^(?:the|my)\s+/, '').trim();
  return Object.prototype.hasOwnProperty.call(PAGES, n) ? PAGES[n] : null;
}

function parsePhone(text) {
  var raw = String(text || '');
  if (!raw.trim() || raw.length > 160 || /\?\s*$/.test(raw)) return null;
  var t = strip(raw), m;
  if (!t) return null;

  if (SETTINGS.test(t) || t === 'settings') return { action: 'settings', page: 'main' };
  if ((m = SETTINGS_OF.exec(t)) || (m = BARE_SETTINGS.exec(t))) {
    var p = page(m[1]);
    if (p) return { action: 'settings', page: p };
  }
  if ((m = TORCH_ON.exec(t))) return { action: 'torch', on: m[1] ? m[1] === 'on' : true };
  if ((m = TOGGLE.exec(t))) {
    var on = m[1] || m[4] || m[5], what = (m[2] || m[3] || m[6] || '').trim();
    on = on === 'on' || on === 'enable' || on === 'activate';
    if (new RegExp('^' + TORCH + '$').test(what)) return { action: 'torch', on: on };
    if (TOGGLES.indexOf(what) >= 0) return { action: 'settings', page: page(what), toggle: on ? 'on' : 'off' };
    if (/^(?:the\s+)?(?:volume|sound)$/.test(what)) return { action: 'volume', op: on ? 'up' : 'down' };
    return null;
  }
  if (VOL_UP.test(t)) return { action: 'volume', op: 'up' };
  if (VOL_DOWN.test(t)) return { action: 'volume', op: 'down' };
  if (VOL_MAX.test(t)) return { action: 'volume', op: 'max' };
  if ((m = VOL_SET.exec(t))) {
    var level = +(m[1] || m[2]);
    return level <= 100 ? { action: 'volume', op: 'set', level: level } : null;
  }
  if (MUTE.test(t)) return { action: 'volume', op: 'mute' };
  if (UNMUTE.test(t)) return { action: 'volume', op: 'unmute' };
  if (PAUSE.test(t)) return { action: 'media', op: 'pause' };
  if (PLAY.test(t)) return { action: 'media', op: 'play' };
  if (NEXT.test(t)) return { action: 'media', op: 'next' };
  if (PREV.test(t)) return { action: 'media', op: 'previous' };
  if ((m = SMS.exec(t))) {
    var to = phoneNumber(m[1]);
    if (to) return { action: 'sms', number: to, body: String(m[2] || '').trim().slice(0, 500) };
  }
  if ((m = CALL.exec(t))) {
    var num = phoneNumber(m[1]);
    if (num) return { action: 'dial', number: num };
    if (m[1].split(' ').length <= 3 && !NOT_APP.test(m[1])) return { action: 'unsupported',
      say: 'I can dial numbers for now. Say the number, like "call 0803 123 4567".' };
    return null;
  }
  if ((m = ALARM.exec(t))) {
    var at = parseTime(m[1] || m[2]);
    return at ? { action: 'alarm', hour: at.hour, minute: at.minute } : { action: 'unsupported',
      say: 'I didn’t catch the time. Try "set an alarm for 6:30 am".' };
  }
  if ((m = TIMER.exec(t))) {
    var secs = parseDuration(m[1] || m[2] || m[3]);
    if (secs) return { action: 'timer', seconds: secs };
    if (m[1]) return { action: 'unsupported', say: 'How long? Try "set a timer for 5 minutes".' };
  }
  if ((m = NAV.exec(t))) {
    var place = m[1].trim();
    if (place && place.length <= 120 && !DOMAIN.test(place)) return { action: 'navigate', place: place };
    return null;
  }
  if (CAMERA.test(t)) return { action: 'camera' };
  if ((m = OPEN_APP.exec(t))) {
    var name = m[1].trim();
    if (!name || name.length > 40 || name.split(' ').length > 4 || DOMAIN.test(name) || NOT_APP.test(name)
      || /\b(?:and|then|to|for|with|about|on|in)\b/.test(name)) return null;
    var pg = page(name);
    if (pg && pg !== 'apps') return { action: 'settings', page: pg };
    var cmd = { action: 'open_app', name: name, soft: true };
    if (m[2]) cmd.app = true;
    return cmd;
  }
  return null;
}

/** What the user hears or reads when the phone answers with an error code. */
function phoneError(code) {
  switch (code) {
    case 'not_found': return 'I couldn’t find that app on this phone.';
    case 'no_app': return 'No app on this phone can do that.';
    case 'no_flash': return 'This phone has no torch I can use.';
    case 'busy': return 'The camera is busy, so I can’t use the torch right now.';
    case 'denied': return 'Android didn’t allow that.';
    case 'bad_args': return 'I didn’t catch that. Try again.';
    case 'unknown_action': return 'That isn’t something I can do on the phone yet.';
    default: return 'That didn’t work on the phone.';
  }
}

export { parseDuration, parsePhone, parseTime, phoneError, phoneNumber };
