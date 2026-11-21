/* Colon AI · what Colon says back to a command (0.22.1). Every phone, music, watch, player and song-recognition
   command, typed or spoken, gets a short, natural reply in the chat thread (and read aloud in voice mode, by the
   phone's own TTS in the Android app). Two or three wordings per action so it doesn't sound canned; a failure gets
   its own reply. Pure and DOM-free: tested in packages/ui/test/command-replies.test.js.
   reply(kind, data, n) -> string   (n picks the wording; omitted, the wordings take turns) */

var turn = 0;

var APP_NAMES = { whatsapp: 'WhatsApp', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X',
  facebook: 'Facebook', gmail: 'Gmail', opay: 'OPay', palmpay: 'PalmPay', telegram: 'Telegram', chrome: 'Chrome',
  spotify: 'Spotify', audiomack: 'Audiomack', snapchat: 'Snapchat', 'play store': 'Play Store', maps: 'Maps' };
var PAGES = { main: '', wifi: 'Wi-Fi', bluetooth: 'Bluetooth', data: 'mobile data', hotspot: 'hotspot',
  location: 'location', display: 'display', battery: 'battery', airplane: 'airplane mode', sound: 'sound',
  volume: 'volume', dnd: 'Do Not Disturb', apps: 'apps', storage: 'storage' };

/** "whatsapp" -> "WhatsApp", "my bank app" -> "My Bank App". */
function appName(name) {
  var n = String(name || '').trim();
  var k = n.toLowerCase();
  if (APP_NAMES[k]) return APP_NAMES[k];
  return n.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

/** True for an app name Colon knows ("open WhatsApp" is then never a chat message). */
function knownApp(name) {
  return Object.prototype.hasOwnProperty.call(APP_NAMES, String(name || '').trim().toLowerCase());
}

function clock(h, m) {
  var hh = h % 12 === 0 ? 12 : h % 12;
  return hh + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM');
}

function duration(s) {
  var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, out = [];
  if (h) out.push(h + ' hour' + (h > 1 ? 's' : ''));
  if (m) out.push(m + ' minute' + (m > 1 ? 's' : ''));
  if (x) out.push(x + ' second' + (x > 1 ? 's' : ''));
  return out.join(' ');
}

function cut(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

var T = {
  open_app: function (d) { var a = appName(d.label || d.name);
    return ['I’ll take you to ' + a + ' now.', 'Opening ' + a + ' for you.', 'Here’s ' + a + '.']; },
  open_app_missing: function (d) { var a = appName(d.name);
    return ['I couldn’t find ' + a + ' on this phone.', a + ' doesn’t seem to be installed on this phone.']; },
  settings: function (d) {
    var p = PAGES[d.page] || '';
    if (d.toggle === 'on' || d.toggle === 'off') {
      return ['Here’s the ' + (p || 'settings') + ' switch. Tap it to turn it ' + d.toggle + '.',
        'I’ve opened the ' + (p || 'settings') + ' switch for you. Tap it to turn it ' + d.toggle + '.'];
    }
    return p ? ['Opening ' + p + ' settings.', 'Here are your ' + p + ' settings.']
      : ['Opening settings.', 'Here are your settings.', 'Taking you to settings.'];
  },
  camera: function () { return ['Opening the camera.', 'Here’s the camera. Say cheese!', 'Camera’s ready.']; },
  torch: function (d) { return d.on ? ['Torch on.', 'Your torch is on.', 'Done, the torch is on.']
    : ['Torch off.', 'Your torch is off.', 'Done, the torch is off.']; },
  volume: function (d) { var s = cut(d.say || 'Done.', 60);
    return [s, 'Done. ' + s, 'Okay. ' + s]; },
  media: function (d) { var w = { pause: 'Paused', play: 'Playing', next: 'Next track', previous: 'Previous track' };
    var x = w[d.op] || 'Done'; return [x + '.', 'Okay, ' + x.toLowerCase() + '.']; },
  dial: function (d) { return ['Dialling ' + d.number + '. Tap Call when you’re ready.',
    'The dialler is ready with ' + d.number + '. Just tap Call.']; },
  sms: function (d) { return ['Your message to ' + d.number + ' is ready. Tap Send.',
    'I’ve written it out for ' + d.number + '. Tap Send when you’re happy with it.']; },
  alarm: function (d) { var c = clock(d.hour, d.minute);
    return ['Alarm set for ' + c + '.', 'Done. I’ve set an alarm for ' + c + '.', 'You’ll wake up at ' + c + '.']; },
  timer: function (d) { var t = duration(d.seconds);
    return ['Timer set for ' + t + '.', 'Okay, ' + t + ', starting now.', 'Your ' + t + ' timer is running.']; },
  navigate: function (d) { var p = cut(d.place, 80);
    return ['Opening the map for ' + p + '.', 'Here’s the way to ' + p + '.', 'Let’s get you to ' + p + '.']; },
  play: function (d) { var t = cut(d.title, 100);
    return ['Playing ' + t + '.', 'Here’s ' + t + '.', 'Now playing ' + t + '.']; },
  watch: function (d) { var t = cut(d.title, 100);
    return ['Here’s ' + t + '.', 'Playing ' + t + ' for you.', 'Okay, here’s ' + t + '.']; },
  open_service: function (d) { return ['Opening it on ' + d.service + '.', 'Taking you to ' + d.service + '.']; },
  finding: function (d) { var q = cut(d.query, 80);
    return ['Okay, finding ' + q + '.', 'Looking for ' + q + ' on YouTube.', 'One moment, getting ' + q + '.']; },
  not_found_video: function () { return ['I couldn’t find that video.', 'I couldn’t find a video for that.']; },
  not_found_song: function () { return ['I couldn’t find that song.', 'I couldn’t find that one anywhere.']; },
  embed_blocked: function () { return ['YouTube won’t play that one inside Colon. Tap Open in YouTube to watch it.',
    'That video can’t play here. Tap Open in YouTube to watch it there.']; },
  pause: function () { return ['Paused.', 'Okay, paused.', 'Paused it for you.']; },
  resume: function () { return ['Playing again.', 'Resuming.', 'Okay, back on.']; },
  forward: function () { return ['Skipped ahead 10 seconds.', 'Forward 10 seconds.']; },
  back: function () { return ['Back 5 seconds.', 'Went back 5 seconds.']; },
  stop: function () { return ['Stopped.', 'Okay, I’ve stopped it.', 'All stopped.']; },
  identified: function (d) { var w = cut(d.what, 120);
    return ['That’s ' + w + '.', 'Sounds like ' + w + '.', 'I think that’s ' + w + '.']; },
  handed_off: function () { return ['Opening Shazam to listen.', 'Let me hand this one to Shazam.']; },
  miss: function () { return ['I didn’t catch that.', 'Sorry, I didn’t catch that.', 'I didn’t hear anything.']; },
  give_up: function () { return ['I still didn’t catch anything, so I’ll stop listening for now.',
    'I can’t hear you, so I’m stopping voice mode. Tap the mic to try again.']; },
  failed: function (d) { return [d.say || 'That didn’t work.']; }
};

/** The reply for one command. kind: a key above; data: what it needs; n: which wording (else they take turns). */
function reply(kind, data, n) {
  var make = T[kind] || T.failed, list = make(data || {});
  var i = typeof n === 'number' ? n : turn++;
  return list[((i % list.length) + list.length) % list.length];
}

/** How many wordings an action has (tests). */
function variants(kind, data) { return (T[kind] || T.failed)(data || {}).length; }

export { appName, knownApp, reply, variants };
