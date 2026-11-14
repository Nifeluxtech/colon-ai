/* Colon AI · what a chat message asks of Saga's schedules and routines (0.11.0). "check yolotask every morning and
   tell me about new tasks" is a scheduled check (the server reads the time from the same words); "save this as a
   routine called daily update" records the chat's last finished task; "run daily update" (or just the routine's
   name: "post my daily update") replays it. Narrow on purpose, like browser-intent.js: anything else stays chat.
   Pure and DOM-free: unit-tested in packages/ui/test/saga-plans.test.js. */

var WHEN = new RegExp('\\b(?:every|each)\\s+(?:single\\s+)?(?:hour|day|morning|afternoon|evening|night|weekday|'
  + 'week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\\b|\\b(?:hourly|daily|nightly|weekly)\\b', 'i');
var BROWSE = new RegExp('\\b(?:check|look|open|visit|see|watch|monitor|scan|browse|go to|search|find|tell me|show me|'
  + 'let me know|look up|track)\\b', 'i');
var SAVE = new RegExp('^(?:please\\s+)?(?:save|record|keep|remember)\\s+(?:this|that|it|the (?:last )?task)\\s+as\\s+'
  + '(?:a\\s+|my\\s+)?routine(?:\\s+(?:called|named))?\\s+["\u201c]?(.{1,80}?)["\u201d]?\\s*[.!]?$', 'i');
var RUN = new RegExp('^(?:please\\s+)?(?:run|do|replay|start)\\s+(?:my\\s+|the\\s+)?(?:routine\\s+)?["\u201c]?'
  + '(.{1,80}?)["\u201d]?(?:\\s+routine)?\\s*[.!]?$', 'i');
var LIST = /^(?:show|list|what are)\s+(?:me\s+)?(?:my\s+)?(?:scheduled (?:checks|browsing)|schedules|routines)\s*\??$/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * planIntent(text, routines) -> null or
 *   { kind: 'schedule', text }          a scheduled check (the server parses the time and the goal)
 *   { kind: 'save_routine', name }      record the chat's last finished task under this name
 *   { kind: 'run_routine', routine }    replay a saved routine (routines: [{ id, name }])
 *   { kind: 'list' }                    show my schedules and routines
 */
function planIntent(text, routines) {
  var s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 400) return null;
  if (LIST.test(s)) return { kind: 'list' };
  var m = SAVE.exec(s);
  if (m) return { kind: 'save_routine', name: m[1].trim() };
  var list = routines || [], key = norm(s);
  var exact = list.filter(function (r) { return norm(r.name) === key; })[0];
  if (exact) return { kind: 'run_routine', routine: exact };
  var r = RUN.exec(s);
  if (r) {
    var want = norm(r[1]);
    var hit = list.filter(function (x) { return norm(x.name) === want; })[0];
    if (hit) return { kind: 'run_routine', routine: hit };
  }
  if (WHEN.test(s) && BROWSE.test(s)) return { kind: 'schedule', text: s };
  return null;
}

/** Minutes east of UTC on this device (Lagos: 60), for the schedule's local time. */
function tzOffset(d) { return -(d || new Date()).getTimezoneOffset(); }

export { planIntent, tzOffset };
