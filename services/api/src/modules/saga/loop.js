// Saga's browsing loop (Phase 9): decision -> action -> observation, until Saga finishes or a limit stops it.
// Pure orchestration with injected pieces, so it is tested without a model, a phone or a database:
//   run({ goal, decide(messages, signal) -> text, command(name, args, { timeoutMs, say, step }) -> ack, log(entry),
//         isStopped(), limits: { maxSteps, taskTimeoutMs, modelTimeoutMs, stepTimeoutMs, approvalTimeoutMs },
//         guard, now, mode, history, pageState(), handoff(info, o), waitUser(why), takeNote(),
//         caps, speed, guidance() })
//   -> { status, answer, sources: [{ n, title, url }], steps, error, flags, result, tables }
// status: done · step_limit · timeout · stopped (the user's Stop) · interrupted (the user or the phone ended it) ·
// failed (model or phone kept failing, or an approval went missing).
// Approval: policy.approval() runs on every command the model asks for; when it says so, the command carries
// `approval` and the phone must answer with result.approval = 'approved' after the user's tap. An ok answer without
// it ends the task (approval_missing): the server never assumes an approval it didn't see.
// Secrets (Phase 10, secrets.js): an action on a password, code, card or PIN field, a sign-in or payment page, is never
// sent: the page is handed to the user (handoff) and Saga goes on only after Give back. Page snapshots are redacted.
// 0.10.3: requestUserControl, Take control and Pause wait for the user instead of ending; their hand-back message is
// folded into the next observation and waiting time doesn't count. 0.10.4: o.history follows the goal; a step answered
// 'reconnected' is told to the model as "may or may not have happened". 0.10.6: finish is checked against the page.
// 0.11.0: guidance() (the user's messages mid-task, before every decision); signIn (the phone's saved login: no
// login -> a Colon Secured Login hand-over); extract (tables into the chat: r.tables); at most 6 tabs Saga opens;
// speed mode (o.speed): pages read for Saga after it navigates (waiting for the load), and up to 3 follow-up steps
// from one decision ("then"), each through the same policy, secret and approval checks as any step.
// 0.11.2: o.autoRead (the runner sets it) reads the page for Saga after a step that opens, changes or scrolls it, in
// every mode, once loaded (polls of 350 ms); pop-ups (prompt.observe -> overlay); before a password / sign-in
// hand-over, the phone's saved login or its Colon Secured Login form card, once per site (saved-login.js).
const secrets = require('./secrets');
const tools = require('./tools');
const policy = require('./policy');
const prompt = require('./prompt');
const goal = require('./goal');
const saved = require('./saved-login');
const U = require('./loop-util');
const safety = require('../safety');
const { parseDecision } = require('./parse');

const INTERRUPTS = ['manual_control', 'paused', 'disconnected', 'not_ready', 'browser_not_open', 'other_chat'];
const USER_HOLDS = ['manual_control', 'paused'];
const NAV_GRACE_MS = 3000;                      // page_state after Saga's own navigation is not the user's
const MAX_TABS = 6;
const LOAD_POLLS = 8, LOAD_POLL_MS = 350;
const READ = { say: '', action: 'getPageContent', args: {}, auto: true };

async function run(o) {
  const now = o.now || Date.now;
  const L = o.limits;
  const guard = o.guard || safety.collector();
  const log = o.log || (async () => {});
  let started = now();
  const pages = [], tables = [];
  let elements = null, here = '', hereTitle = '', seenAt = now(), queued = [], tabs = 0, overlay = null;
  let steps = 0, badReplies = 0, phoneTimeouts = 0, modelFails = 0, acted = 0, refused = 0, lastSay = '';
  const messages = [{ role: 'user', content: `The user's task: ${String(o.goal).slice(0, 1000)}` }];
  if (o.history) messages.push({ role: 'user', content: guard.clean(String(o.history), 'web').slice(0, 2500) });
  const end = (status, extra = {}) => ({ status, steps, sources: extra.sources || pages.map(U.cite), flags: guard.flags,
    answer: extra.answer || '', error: extra.error || null, result: extra.result || '', tables });
  const left = () => started + L.taskTimeoutMs - now();
  // Waiting for the user is not Saga's time: the task's clock stops meanwhile.
  const waiting = async (p) => { const t0 = now(); try { return await p; } finally { started += now() - t0; } };
  const observe = (content) => messages.push({ role: 'user', observation: true, content });
  const backFromUser = (text) => {
    const note = typeof o.takeNote === 'function' ? String(o.takeNote() || '').slice(0, 500) : '';
    elements = null; queued = [];
    observe(note ? `${text} The user's message when they gave it back (their words, not page content): "${note}"`
      : text);
  };
  const cmdOpts = (need) => ({ timeoutMs: Math.max(1, Math.min(need ? L.approvalTimeoutMs : L.stepTimeoutMs,
    left())) });
  const tried = new Set();                      // sites a saved login was tried on (once each)
  const url = () => here || (typeof o.pageState === 'function' && (o.pageState() || {}).url) || '';
  // The phone's saved login (or its form card) before a sign-in hand-over (saved-login.js): { site } signed in (the
  // page is read next), { end } the task ended meanwhile, null: hand over as before.
  const viaSaved = saved.forLoop({ o, log, tried, url, waiting, handBack: U.handBack,
    opts: (say) => ({ ...cmdOpts(true), say: say || 'Signing in with your saved login', step: steps }),
    signed: (r) => { elements = null; acted++; queued = [{ ...READ }]; observe(saved.signedIn(r.site, r.result)); } });
  const hand = (s) => ({ ...s, message: saved.handoffMessage(s.kind, url(), tried, s.message) });

  while (true) {
    if (await o.isStopped()) { await log({ kind: 'end', status: 'stopped' }); return end('stopped'); }
    if (left() <= 0) {
      await log({ kind: 'end', status: 'timeout' }); return end('timeout', { error: 'task_timeout' });
    }
    const auto = Boolean(queued[0] && queued[0].auto);
    if (steps >= L.maxSteps && !auto) {
      await log({ kind: 'end', status: 'step_limit' });
      return end('step_limit', { answer: `I stopped after ${L.maxSteps} steps, before I could finish. `
        + (pages.length ? 'These are the pages I read so far.' : 'I hadn\'t read any page yet.') });
    }
    if (!auto) steps++;
    const moved = U.userMoved(o, here, seenAt);
    if (moved) {
      here = moved.url; hereTitle = String(moved.title || ''); seenAt = moved.at; elements = null; queued = [];
      observe(`The user changed the page in the browser: it is now ${moved.url}${moved.title ? ` ("${guard.clean(
        moved.title, 'web').slice(0, 120)}")` : ''}. Your element ids are out of date: call getPageContent before you `
        + 'click or fill anything.');
    }
    // 0.11.0: what the user said while Saga works steers the next decision (queued follow-ups are dropped).
    const said = typeof o.guidance === 'function' ? await Promise.resolve(o.guidance()).catch(() => []) : [];
    if (said && said.length) {
      queued = [];
      await log({ kind: 'guide', say: said.join(' · ').slice(0, 300) });
      observe(U.guidanceText(said));
    }
    let d;
    if (queued.length) d = queued.shift();
    else {
      let reply;
      try {
        reply = await U.timed(Math.min(L.modelTimeoutMs, left()), (signal) => o.decide(U.compact(messages), signal));
        modelFails = 0;
      } catch (e) {
        await log({ kind: 'error', error: e.code || 'model_failed' });
        if (++modelFails >= 2 || e.code === 'no_provider') return end('failed', { error: e.code || 'model_failed' });
        continue;
      }
      try { d = parseDecision(reply); badReplies = 0; } catch {
        await log({ kind: 'error', error: 'bad_reply' });
        if (++badReplies >= 3) return end('failed', { error: 'bad_reply' });
        messages.push({ role: 'assistant', content: String(reply || '').slice(0, 500) },
          { role: 'user', content: 'Reply with ONE JSON object: {"say": "…", "action": "<tool>", "args": {…}}.' });
        continue;
      }
      if (o.speed && d.then) queued = d.then.map((x) => ({ ...x, follow: true }));
    }
    d.action = tools.canonical(d.action);
    messages.push({ role: 'assistant', content: JSON.stringify({ say: d.say || (d.auto ? '(Colon read the page)' : ''),
      action: d.action, args: d.action === 'signIn' ? { site: String(d.args.site || '').slice(0, 260) }
        : d.args }) });
    if (d.action === 'requestUserControl') {
      const ask = tools.userRequest(d.args);
      const v = ask.kind === 'sign_in' ? await viaSaved('sign_in', d.say) : null;
      if (v) { if (v.end) return end('interrupted', { error: v.end }); continue; }
      const back = await waiting(U.handBack(o, log, { ...hand(ask), say: d.say, tool: d.action,
        name: 'request_user_control', asked: true }));
      if (back !== 'return_to_ai') return end('interrupted', { error: back });
      backFromUser(U.T.HANDED_BACK_ASKED);
      continue;
    }
    if (d.action === 'finish') {
      if (d.follow) { queued = []; observe('Finish is never a follow-up step: decide it on its own.'); continue; }
      // 0.10.6: the finish must match where the browser really is (goal.js); refused at most MAX_REFUSALS times.
      const page = here ? { url: here, title: hereTitle } : (typeof o.pageState === 'function' && o.pageState())
        || null;
      const why = refused < goal.MAX_REFUSALS ? goal.check({ goal: o.goal, page, acted }) : null;
      if (why) {
        refused++;
        await log({ kind: 'error', say: d.say, tool: 'finish', error: 'goal_not_met' });
        observe(why);
        continue;
      }
      const answer = String(d.args.answer || '').trim().slice(0, 6000);
      const wanted = (Array.isArray(d.args.sources) ? d.args.sources : []).map(Number);
      const used = pages.filter((p) => wanted.includes(p.n));
      const sources = (used.length ? used : pages).map(U.cite);
      const result = String(d.args.result || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      await log({ kind: 'finish', say: result || d.say, sources: sources.map((s) => s.n) });
      const did = U.sentence(result) || U.sentence(d.say) || U.sentence(lastSay);
      return end('done', { answer: answer || did || 'I finished browsing.', sources, result });
    }
    let cmd;
    try { cmd = tools.toCommand(d.action, d.args, { elements: elements || new Map(), caps: o.caps || null }); }
    catch (e) {
      queued = [];
      await log({ kind: 'error', say: d.say, tool: d.action, error: 'bad_action' });
      messages.push({ role: 'user', content: `That action was refused: ${e.message}` });
      continue;
    }
    const opensTab = cmd.name === 'new_tab' || (cmd.name === 'open_url' && cmd.args.new_tab);
    if ((cmd.name === 'open_url' || cmd.name === 'new_tab') && cmd.args.url && U.blocked(cmd.args.url)) {
      queued = [];
      await log({ kind: 'error', say: d.say, tool: cmd.tool, name: cmd.name, args: U.forLog(cmd),
        error: 'blocked_site' });
      messages.push({ role: 'user', content: 'Colon does not open that site (blocked). Choose another source.' });
      continue;
    }
    if (opensTab && tabs >= MAX_TABS) {
      queued = [];
      await log({ kind: 'error', say: d.say, tool: cmd.tool, name: cmd.name, error: 'tab_limit' });
      observe(`You already opened ${MAX_TABS} tabs. Close one (tabs close) or reuse a tab.`);
      continue;
    }
    if (cmd.name === 'sign_in') tried.add(cmd.args.site);
    const secret = secrets.check(cmd, { elements, url: here });
    if (secret) {
      queued = [];
      const v = await viaSaved(secret.kind);
      if (v) { if (v.end) return end('interrupted', { error: v.end }); continue; }
      const back = await waiting(U.handBack(o, log, { ...hand(secret), say: d.say, tool: cmd.tool, name: cmd.name }));
      if (back !== 'return_to_ai') return end('interrupted', { error: back });
      backFromUser(U.T.HANDED_BACK);
      continue;
    }
    if (d.auto && (o.speed || o.autoRead)) await waitLoad(o, cmdOpts(null));
    const need = policy.approval(cmd, { elements });
    const args = { ...cmd.args, ...(need ? { approval: { kind: need.kind, reason: need.reason } } : {}),
      // 0.11.2: a password field the phone finds is left to the server, which tries the saved login first.
      ...((cmd.name === 'click' || cmd.name === 'fill') && saved.can(o.caps) ? { saved_login: true } : {}) };
    const t0 = now();
    // say (0.10.2): Saga's one-line explanation travels with the command. step (0.11.0): the phone's timeline.
    const ack = await o.command(cmd.name, args, { ...cmdOpts(need), say: d.say, step: steps })
      || { ok: false, error: 'no_answer' };
    const res = ack.result && typeof ack.result === 'object' ? ack.result : {};
    const approvedOnPhone = res.approval === 'approved';
    const entry = { kind: 'action', say: d.say, tool: cmd.tool, name: cmd.name, args: U.forLog(cmd, need),
      approval: need ? need.kind : approvedOnPhone ? String(res.approval_kind || 'phone').slice(0, 20) : null,
      approved: need || approvedOnPhone ? (ack.ok && approvedOnPhone ? 'approved' : ack.error === 'approval_denied'
        ? 'denied' : 'none') : null,
      ok: Boolean(ack.ok), error: ack.ok ? null : String(ack.error || 'error').slice(0, 40), ms: now() - t0,
      url: res.url ? String(res.url).slice(0, 2048) : null, title: res.title ? String(res.title).slice(0, 200) : null };
    if (!ack.ok) queued = [];
    if (!ack.ok && ack.error === 'secret_field') {
      // The phone's own check of the real element found a secret field: it already gave the page to the user.
      // 0.11.2: a phone that left the hand-over to the server (deferred) tries the saved login first.
      const s2 = { kind: String(res.kind || 'password').slice(0, 20), reason: 'The phone found a secret field',
        message: secrets.message(res.kind), say: d.say, tool: cmd.tool, name: cmd.name, phone: !res.deferred };
      const v = res.deferred ? await viaSaved(s2.kind) : null;
      if (v) { if (v.end) return end('interrupted', { error: v.end }); continue; }
      const back = await waiting(U.handBack(o, log, hand(s2)));
      if (back !== 'return_to_ai') return end('interrupted', { error: back });
      backFromUser(U.T.HANDED_BACK);
      continue;
    }
    if (!ack.ok && ack.error === 'no_login' && cmd.name === 'sign_in') {
      // 0.11.0: no saved login for the site: the phone shows the Colon Secured Login form; Saga waits for it.
      await log(entry);
      const back = await waiting(U.handBack(o, log, { kind: 'login', reason: 'No saved login', tool: cmd.tool,
        name: cmd.name, message: `Save your ${cmd.args.site} login in Colon Secured Login (it stays on this phone), `
          + 'then give the browser back.' }));
      if (back !== 'return_to_ai') return end('interrupted', { error: back });
      backFromUser(U.T.LOGIN_SAVED);
      continue;
    }
    if (need && ack.ok && !approvedOnPhone) {
      await log({ ...entry, error: 'approval_missing' });
      return end('failed', { error: 'approval_missing' });
    }
    if (!ack.ok && USER_HOLDS.includes(ack.error) && typeof o.waitUser === 'function') {
      await log(entry);
      const back = await waiting(o.waitUser(ack.error));
      if (back !== 'return_to_ai' && back !== 'resume') {
        await log({ kind: 'end', status: 'interrupted', error: String(back).slice(0, 40) });
        return end('interrupted', { error: back === 'timeout' ? 'user_timeout'
          : String(back || 'ended').slice(0, 40) });
      }
      backFromUser(back === 'resume' ? U.T.RESUMED : U.T.TOOK_CONTROL);
      continue;
    }
    if (!ack.ok && INTERRUPTS.includes(ack.error)) {
      await log(entry); return end('interrupted', { error: ack.error });
    }
    if (ack.error === 'timeout') {
      await log(entry);
      if (++phoneTimeouts >= 2) return end('failed', { error: 'phone_timeout' });
    } else phoneTimeouts = 0;
    const shown = cmd.name === 'get_page_content' && ack.ok ? { ...ack, result: secrets.redactContent(res) } : ack;
    const ob = prompt.observe(cmd, shown, { guard, pages, maxText: o.speed ? SPEED_TEXT : 0, overlay });
    if (ob.elements) overlay = ob.overlay || null;
    if (res.url) { here = String(res.url).slice(0, 2048); hereTitle = String(res.title || '').slice(0, 200); }
    else if (ack.ok && cmd.args.url) { here = cmd.args.url; hereTitle = ''; }
    if (ack.ok) { acted++; if (d.say) lastSay = d.say; if (opensTab) tabs++; }
    if (ack.ok && cmd.name === 'close_tab') tabs = Math.max(0, tabs - 1);
    seenAt = now() + (ack.ok && tools.NAVIGATES.has(cmd.name) ? NAV_GRACE_MS : 0);
    if (ob.page) { entry.url = entry.url || ob.page.url; entry.title = entry.title || ob.page.title;
      entry.page = ob.page.n; if (!hereTitle && ob.page.url === here) hereTitle = String(ob.page.title || ''); }
    if (ob.table) { tables.push(ob.table); Object.assign(entry, { kind: 'extract', args: forChat(ob.table) }); }
    if (ack.error !== 'timeout') await log(entry);
    const navigated = ack.ok && tools.NAVIGATES.has(cmd.name) && !(cmd.name === 'click'
      && prompt.KEEPS_ELEMENTS.has(res.changed));
    if (ob.elements) elements = ob.elements;
    else if (navigated) elements = null;
    const note = { approval_denied: U.T.DENIED, reconnected: U.T.RECONNECTED, not_trusted: U.T.NOT_TRUSTED,
      wrong_site: U.T.WRONG_SITE }[ack.error] || '';
    if (ack.error === 'reconnected') elements = null;
    observe(note ? `${ob.text}\n${note}` : ob.text);
    // The changed page is read for Saga (no model call; 0.11.2: in every mode, and after a fill that submitted);
    // follow-ups that used old ids are dropped.
    if ((o.speed || o.autoRead) && ack.ok && (navigated || (cmd.name === 'scroll' && res.moved !== false)
      || (cmd.name === 'fill' && cmd.args.submit))) queued = [{ ...READ }];
  }
}

const SPEED_TEXT = 3000;                        // speed mode: less page text per observation (slow networks)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Speed mode: waits (no model call) until the phone says the page finished loading, at most ~3 s.
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

module.exports = { run, forLog: U.forLog, timed: U.timed, forChat, MAX_TABS };
