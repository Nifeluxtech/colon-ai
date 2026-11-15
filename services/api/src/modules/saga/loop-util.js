// Pieces of Saga's loop (loop.js) that need no loop state: timeouts, what the audit log keeps, the shrinking of old
// observations, the hand-over to the user, the fixed observation texts. Split out of loop.js in 0.11.0.
const safety = require('../safety');
const policy = require('./policy');

const KEEP_FULL = 2;                            // newest observations kept whole; older ones shrink to one line

function timed(ms, fn) {
  const ctl = new AbortController();
  let timer;
  const stop = new Promise((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(Object.assign(
    new Error('timed out'), { code: 'model_timeout' })); }, Math.max(1, ms)); });
  return Promise.race([Promise.resolve().then(() => fn(ctl.signal)), stop]).finally(() => clearTimeout(timer));
}

// What the audit log keeps of an action's arguments: typed text is kept only when it is not personal data.
function forLog(cmd, need) {
  const a = { ...cmd.args };
  if (a.value !== undefined) {
    const masked = (need && (need.kind === 'personal_data' || need.kind === 'payment'))
      || policy.personalData(a.value);
    a.value = masked ? `[hidden: ${String(a.value).length} characters]` : String(a.value).slice(0, 200);
  }
  return a;
}

function compact(messages) {
  let seen = 0;
  for (let i = messages.length - 1; i > 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' || !m.observation) continue;
    if (++seen > KEEP_FULL && !m.short) {
      m.content = `${m.content.split('\n')[0]} (content shown earlier, no longer repeated)`; m.short = true;
    }
  }
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

const T = {
  RECONNECTED: 'The connection to the phone dropped during this step and came back: the step may or may not have '
    + 'happened. Call getPageContent to see the page now before you act again.',
  HANDED_BACK_ASKED: 'The user did what you asked in the browser and gave control back. Call getPageContent to see '
    + 'the page now, then continue.',
  TOOK_CONTROL: 'The user took control of the browser (your last step did not run) and has now given it back. They '
    + 'may have changed the page: call getPageContent before you act, and do not undo what they did.',
  RESUMED: 'The user paused you and has now resumed (your last step did not run). Call getPageContent, then continue.',
  HANDED_BACK: 'The user typed the private details in the browser themselves and gave control back. Never type '
    + 'passwords, codes, card details or PINs yourself. Call getPageContent to see the page now, then continue.',
  LOGIN_SAVED: 'The user saved a login for this site in Colon Secured Login on their phone (you never see it). Call '
    + 'signIn again for the same site.',
  // 0.11.0: signIn could not use the saved login (no value ever reaches the server or the model).
  NOT_TRUSTED: 'signIn did not run: the user has not allowed Saga to use the saved login on this site (or said no '
    + 'this time). Do not call signIn again for this site and never ask for the password in the chat; use '
    + 'requestUserControl so the user signs in themselves in the browser, or continue without signing in.',
  WRONG_SITE: 'signIn did not run: the page open now is not on the site the saved login belongs to (or is not a '
    + 'secure https page). Open the site\'s own sign-in page (openUrl), call getPageContent, then call signIn again.',
  DENIED: 'The user declined this action on the phone. Do not try to do the same thing another way; continue without '
    + 'it or finish and explain.',
};

// Waits while the user types a secret: logged as a 'handoff' step (its say is the prompt the chat shows).
async function handBack(o, log, s) {
  await log({ kind: 'handoff', say: s.message, tool: s.tool, name: s.name, error: s.kind });
  if (typeof o.handoff !== 'function') return 'secret_field';
  const r = await o.handoff({ kind: s.kind, message: s.message, reason: s.reason }, { phoneStarted: Boolean(s.phone) });
  if (r !== 'return_to_ai') await log({ kind: 'end', status: 'interrupted', error: String(r).slice(0, 40) });
  return r === 'return_to_ai' ? r : r === 'timeout' ? 'handoff_timeout' : String(r || 'handoff_ended').slice(0, 40);
}

// "AI + me": the page the phone reports now differs from the one Saga last acted on (the user moved it).
function userMoved(o, here, seenAt) {
  if (o.mode !== 'shared' || typeof o.pageState !== 'function') return null;
  const p = o.pageState();
  if (!p || !p.url || p.url === here || !(p.at > seenAt)) return null;
  return p;
}

// 0.11.0: the user's messages sent while Saga works ("use the cheaper one"): their words, never page content.
function guidanceText(list) {
  const lines = (list || []).map((g) => String(g || '').replace(/\s+/g, ' ').trim().slice(0, 500)).filter(Boolean);
  if (!lines.length) return '';
  return 'The user sent this while you work (their own words, not page content; follow it if it is safe and fits '
    + `the task, without stopping): ${lines.map((l) => `"${l}"`).join(' · ')}`;
}

// A short line as a sentence for the reply ("Opened GitHub's sign-in page" -> "Opened GitHub's sign-in page.").
const sentence = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return x ? (/[.!?…]$/.test(x) ? x : `${x}.`) : ''; };
const blocked = (url) => safety.blockedHost(new URL(url).hostname, { extra: [process.env.BROWSER_READER_BLOCKLIST
  || ''] }).blocked;
const cite = (p) => ({ n: p.n, title: p.title || p.url, url: p.url });

const SPEED_TEXT = 3000;                        // speed mode: less page text per observation (slow networks)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Speed mode: waits (no model call) until the phone says the page finished loading, at most ~3 s.
const LOAD_POLLS = 8, LOAD_POLL_MS = 350;
async function waitLoad(o, opts) {
  for (let i = 0; i < LOAD_POLLS; i++) {
    const a = await o.command('get_page_state', {}, opts).catch(() => null);
    if (!a || !a.ok || !a.result || !a.result.loading) return;
    await sleep(LOAD_POLL_MS);
  }
}

// What the log (and the chat's table / CSV) keeps of an extracted table: at most 100 rows of 100-character cells.
function forChat(t) {
  const cut = (v) => String(v).slice(0, 100);
  return { what: t.what, caption: t.caption, columns: t.columns.map(cut), rows: t.rows.slice(0, 100)
    .map((r) => r.map(cut)), total: t.total };
}

module.exports = { waitLoad, forChat, SPEED_TEXT, timed, forLog, compact, handBack, userMoved, guidanceText, sentence,
  blocked, cite, T, KEEP_FULL };
