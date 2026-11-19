/* Colon AI · deep research in Research mode (v0.17.0, Blueprint D16).
   The "Deep research" chip turns it on; the next message starts a background run instead of a chat reply. The first
   POST answers 409 consent_required with the credit cost, the app asks, then starts it with confirm: true. The run's
   progress message sits in the thread and is polled (GET /research/:id) until the report replaces it. */

import { Colon } from '../../../../packages/ui/js/colon.js';
import { scrollBottom } from '../components/composer.js';
import { renderThread } from '../components/message.js';
import { updateHeader } from '../components/model-picker.js';
import { refreshConvs } from '../components/sidebar.js';
import { CW } from '../core/cw.js';
import { S, data, mode } from '../core/state.js';
import { consentBody, consentNeeded, creditText, isTerminal, pollDelay, researchProgress } from '../lib/chat-tools.js';

var C = Colon, icon = C.icon, esc = C.esc;
var polls = {};   // run id -> timer, so one run is polled once

function available() { return typeof data.startResearch === 'function'; }
function deepResearchOn() { return !!S.deepResearch && mode() === 'research' && available(); }

/* ---------- The composer chip (Research mode, signed in) ---------- */
function researchChipHtml() {
  if (!available()) return '';
  return '<button type="button" class="chip sm" data-deep-toggle aria-pressed="' + !!S.deepResearch + '">'
    + icon('search') + 'Deep research</button>';
}
function toggleDeep(btn) {
  S.deepResearch = !S.deepResearch;
  if (btn) btn.setAttribute('aria-pressed', String(S.deepResearch));
  C.toast(S.deepResearch ? 'Deep research on: your next question starts a full report (uses credits).'
    : 'Deep research off.');
}

/* ---------- Starting a run ---------- */
function deepResearch(text, ensureConv) {
  var q = String(text || '').trim();
  if (q.length < 3) { C.toast('Type the research question first.', 'bad'); return false; }
  if (q.length > 4000) { C.toast('Keep the question under 4,000 characters.', 'bad'); return false; }
  ensureConv().then(function (c) {
    if (data.isTemp && data.isTemp(c.id)) throw new Error('Deep research needs a saved chat. Turn on “Save chat '
      + 'history” in Settings.');
    return data.startResearch(c.id, { question: q }).catch(function (e) {
      var need = consentNeeded(e); if (!need) throw e;
      return C.confirm({ title: 'Start deep research?', body: consentBody(need.credits),
        confirm: 'Start · ' + creditText(need.credits) }).then(function (ok) {
        if (!ok) { restore(q); return null; }
        return data.startResearch(c.id, { question: q, confirm: true });
      });
    }).then(function (r) { if (r) started(c.id, r); });
  }).catch(function (e) { restore(q); C.toast(e.message, 'bad'); });
  return true;
}
function restore(q) { var ta = S.el && S.el.querySelector('#cw-input'); if (ta && !ta.value) { ta.value = q;
  ta.dispatchEvent(new Event('input')); } }
function started(cid, r) {
  if (!S.current || S.current.id !== cid) return;
  if (r.conversation) S.current = Object.assign(S.current, r.conversation);
  [r.user_message, r.message].forEach(function (m) { if (m) S.messages.push(m); });
  if (r.message) r.message.research = r.run;
  S.deepResearch = false;   // one run per tap; the chip turns off
  renderThread(); updateHeader(); scrollBottom(true); refreshConvs();
  poll(cid, r.run, 0);
}

/* ---------- Progress ---------- */
function findMsg(id) { return S.messages.filter(function (m) { return m.id === id; })[0]; }
function poll(cid, run, attempt) {
  if (!run || polls[run.id]) return;
  polls[run.id] = setTimeout(function () {
    delete polls[run.id];
    if (!S.current || S.current.id !== cid) return;   // picked up again when the chat is reopened (resume)
    data.getResearch(run.id).then(function (next) {
      var m = findMsg(next.message_id); if (m) m.research = next;
      if (isTerminal(next)) return refreshMessage(cid, next.message_id);
      if (S.current && S.current.id === cid) renderThread();
      poll(cid, next, attempt + 1);
    }).catch(function () { poll(cid, run, attempt + 1); });   // a blip: keep checking, slower
  }, pollDelay(attempt));
}
// The run ended: its message now holds the report (or why it stopped); load it from the chat.
function refreshMessage(cid, mid) {
  return data.getConversation(cid).then(function (r) {
    if (!S.current || S.current.id !== cid) return;
    var fresh = (r.messages || []).filter(function (m) { return m.id === mid; })[0], i = S.messages.indexOf(
      findMsg(mid));
    if (fresh) { delete fresh.research; if (i > -1) S.messages.splice(i, 1, fresh); else S.messages.push(fresh); }
    renderThread(); scrollBottom(); refreshConvs();
  }).catch(function (e) { C.toast(e.message, 'bad'); });
}
function cancelResearch(runId) {
  return C.confirm({ title: 'Stop deep research?', body: 'The report won’t be written. Your credits are given back.',
    confirm: 'Stop research', danger: true }).then(function (ok) {
    if (!ok) return;
    var cid = S.current && S.current.id;
    return data.cancelResearch(runId).then(function (run) {
      var m = findMsg(run.message_id); if (m) m.research = run;
      if (polls[runId]) { clearTimeout(polls[runId]); delete polls[runId]; }
      return refreshMessage(cid, run.message_id);
    }).catch(function (e) { C.toast(e.message, 'bad'); });
  });
}
/** A chat was opened: live runs pick up their progress again. */
function resumeResearch(conv) {
  if (!conv || typeof data.listResearch !== 'function' || (data.isTemp && data.isTemp(conv.id))) return;
  data.listResearch(conv.id).then(function (runs) {
    var any = false;
    (runs || []).forEach(function (run) {
      if (isTerminal(run)) return;
      var m = findMsg(run.message_id); if (!m) return;
      m.research = run; any = true; poll(conv.id, run, 0);
    });
    if (any && S.current && S.current.id === conv.id) renderThread();
  }).catch(function () {});
}

CW.resumeResearch = resumeResearch;   // pages/chat.js calls it after opening a chat

/** The progress card under a running research message (components/message.js). */
function researchHtml(m) {
  var run = m && m.research; if (!run || isTerminal(run)) return '';
  var p = researchProgress(run);
  return '<div class="cw-research" role="status"><div class="cw-research-top">' + icon('search') + '<b>Deep research'
    + '</b><span>' + esc(p.text) + '</span><button type="button" class="btn sm ghost" data-research-cancel="'
    + esc(run.id) + '">' + icon('stop') + 'Stop</button></div><div class="cw-research-bar" aria-hidden="true"><i '
    + 'style="width:' + Math.max(4, p.pct) + '%"></i></div></div>';
}

export { cancelResearch, deepResearch, deepResearchOn, researchChipHtml, researchHtml, resumeResearch, toggleDeep };
