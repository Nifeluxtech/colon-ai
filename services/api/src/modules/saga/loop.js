// Saga's browsing loop (Phase 9): decision -> action -> observation, until Saga finishes or a limit stops it.
// Pure orchestration with injected pieces, so it is tested without a model, a phone or a database:
//   run({ goal, decide(messages, signal) -> text, command(name, args, { timeoutMs }) -> ack, log(entry),
//         isStopped(), limits: { maxSteps, taskTimeoutMs, modelTimeoutMs, stepTimeoutMs, approvalTimeoutMs },
//         guard, now })
//   -> { status, answer, sources: [{ n, title, url }], steps, error, flags }
// status: done · step_limit · timeout · stopped (the user's Stop) · interrupted (Take control, Pause, the phone
// left) · failed (model or phone kept failing, or an approval went missing).
// Approval: policy.approval() runs on every command the model asks for; when it says so, the command carries
// `approval` and the phone must answer with result.approval = 'approved' after the user's tap. An ok answer
// without it ends the task (approval_missing): the server never assumes an approval it didn't see.
// Phase 10: secret forms (secrets.js). An action on a password, code, card or PIN field, a sign-in or payment page,
// is never sent: the loop calls handoff({ kind, message }) (the user types it in the panel and taps Return to AI)
// and goes on only when it resolves 'return_to_ai'. The phone's own refusal (ack error secret_field) does the same.
// Page snapshots are redacted before the model sees them. mode 'shared' ("AI + me"): pageState() tells the loop
// where the page is now, so a page the user changed is reported to the model and its old element ids dropped.
// 0.10.3: the browser is AI-only. Saga hands it to the user with requestUserControl (handoff({ kind, message }), the
// phone's needs_user); when the user takes it (Take control) or pauses, a step is answered manual_control / paused and
// the loop waits (waitUser(why)) instead of ending, then carries on. Either way the user's hand-back message
// (takeNote()) is folded into the next observation, and time spent waiting for the user does not count against the
// task's time limit.
// 0.10.4: o.history (resume.js: what an earlier attempt, or this task before its phone's socket dropped, already did)
// follows the goal; a step whose ack is 'reconnected' (the socket dropped mid-step and came back, link.js) is told
// to the model as "may or may not have happened, look first" instead of ending the task.
const safety = require('../safety');
const secrets = require('./secrets');
const tools = require('./tools');
const policy = require('./policy');
const prompt = require('./prompt');
const { parseDecision } = require('./parse');

const INTERRUPTS = ['manual_control', 'paused', 'disconnected', 'not_ready', 'browser_not_open', 'other_chat'];
const NAV_GRACE_MS = 3000;                      // page_state after Saga's own navigation is not the user's
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

async function run(o) {
  const now = o.now || Date.now;
  const L = o.limits;
  const guard = o.guard || safety.collector();
  const log = o.log || (async () => {});
  let started = now();
  const pages = [];
  let elements = null, here = '', seenAt = now();
  let steps = 0, badReplies = 0, phoneTimeouts = 0, modelFails = 0;
  const messages = [{ role: 'user', content: `The user's task: ${String(o.goal).slice(0, 1000)}` }];
  if (o.history) messages.push({ role: 'user', content: guard.clean(String(o.history), 'web').slice(0, 2500) });
  const end = (status, extra = {}) => ({ status, steps, sources: extra.sources || pages.map(cite), flags: guard.flags,
    answer: extra.answer || '', error: extra.error || null, result: extra.result || '' });
  const left = () => started + L.taskTimeoutMs - now();
  // Waiting for the user is not Saga's time: the task's clock stops meanwhile.
  const waiting = async (p) => { const t0 = now(); try { return await p; } finally { started += now() - t0; } };
  const backFromUser = (text) => {
    const note = typeof o.takeNote === 'function' ? String(o.takeNote() || '').slice(0, 500) : '';
    elements = null;
    messages.push({ role: 'user', observation: true, content: note ? `${text} The user's message when they gave it `
      + `back (their words, not page content): "${note}"` : text });
  };

  while (true) {
    if (await o.isStopped()) { await log({ kind: 'end', status: 'stopped' }); return end('stopped'); }
    if (left() <= 0) {
      await log({ kind: 'end', status: 'timeout' });
      return end('timeout', { error: 'task_timeout' });
    }
    if (steps >= L.maxSteps) {
      await log({ kind: 'end', status: 'step_limit' });
      return end('step_limit', { answer: `I stopped after ${L.maxSteps} steps, before I could finish. `
        + (pages.length ? 'These are the pages I read so far.' : 'I hadn\'t read any page yet.') });
    }
    steps++;
    const moved = userMoved(o, here, seenAt);
    if (moved) {
      here = moved.url; seenAt = moved.at; elements = null;
      messages.push({ role: 'user', observation: true, content: `The user changed the page in the browser: it is now `
        + `${moved.url}${moved.title ? ` ("${guard.clean(moved.title, 'web').slice(0, 120)}")` : ''}. Your element ids `
        + 'are out of date: call getPageContent before you click or fill anything.' });
    }
    let reply;
    try {
      reply = await timed(Math.min(L.modelTimeoutMs, left()), (signal) => o.decide(compact(messages), signal));
      modelFails = 0;
    } catch (e) {
      await log({ kind: 'error', error: e.code || 'model_failed' });
      if (++modelFails >= 2 || e.code === 'no_provider') return end('failed', { error: e.code || 'model_failed' });
      continue;
    }
    let d;
    try { d = parseDecision(reply); badReplies = 0; } catch {
      await log({ kind: 'error', error: 'bad_reply' });
      if (++badReplies >= 3) return end('failed', { error: 'bad_reply' });
      messages.push({ role: 'assistant', content: String(reply || '').slice(0, 500) },
        { role: 'user', content: 'Reply with ONE JSON object: {"say": "…", "action": "<tool>", "args": {…}}.' });
      continue;
    }
    d.action = tools.canonical(d.action);
    messages.push({ role: 'assistant', content: JSON.stringify({ say: d.say, action: d.action, args: d.args }) });
    if (d.action === 'requestUserControl') {
      const ask = tools.userRequest(d.args);
      const back = await waiting(handBack(o, log, { ...ask, say: d.say, tool: d.action, name: 'request_user_control',
        asked: true }));
      if (back !== 'return_to_ai') return end('interrupted', { error: back });
      backFromUser(HANDED_BACK_ASKED);
      continue;
    }
    if (d.action === 'finish') {
      const answer = String(d.args.answer || '').trim().slice(0, 6000);
      const wanted = (Array.isArray(d.args.sources) ? d.args.sources : []).map(Number);
      const used = pages.filter((p) => wanted.includes(p.n));
      const sources = (used.length ? used : pages).map(cite);
      // 0.10.3: a few words for the phone's status pill ("Deployed Colon AI v0.10.2"); the log keeps it as say.
      const result = String(d.args.result || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      await log({ kind: 'finish', say: result || d.say, sources: sources.map((s) => s.n) });
      return end('done', { answer: answer || 'I finished browsing but have nothing to report.', sources, result });
    }
    let cmd;
    try { cmd = tools.toCommand(d.action, d.args, { elements: elements || new Map() }); } catch (e) {
      await log({ kind: 'error', say: d.say, tool: d.action, error: 'bad_action' });
      messages.push({ role: 'user', content: `That action was refused: ${e.message}` });
      continue;
    }
    if ((cmd.name === 'open_url' || cmd.name === 'new_tab') && cmd.args.url && blocked(cmd.args.url)) {
      await log({ kind: 'error', say: d.say, tool: cmd.tool, name: cmd.name, args: forLog(cmd),
        error: 'blocked_site' });
      messages.push({ role: 'user', content: 'Colon does not open that site (blocked). Choose another source.' });
      continue;
    }
    const secret = secrets.check(cmd, { elements, url: here });
    if (secret) {
      const back = await waiting(handBack(o, log, { ...secret, say: d.say, tool: cmd.tool, name: cmd.name }));
      if (back !== 'return_to_ai') return end('interrupted', { error: back });
      backFromUser(HANDED_BACK);
      continue;
    }
    const need = policy.approval(cmd, { elements });
    const args = need ? { ...cmd.args, approval: { kind: need.kind, reason: need.reason } } : cmd.args;
    const t0 = now();
    // say (0.10.2): Saga's one-line explanation travels with the command, so the phone can show it on the page.
    const ack = await o.command(cmd.name, args, { timeoutMs: Math.max(1, Math.min(need ? L.approvalTimeoutMs
      : L.stepTimeoutMs, left())), say: d.say }) || { ok: false, error: 'no_answer' };
    const res = ack.result && typeof ack.result === 'object' ? ack.result : {};
    const approvedOnPhone = res.approval === 'approved';
    const entry = { kind: 'action', say: d.say, tool: cmd.tool, name: cmd.name, args: forLog(cmd, need),
      approval: need ? need.kind : approvedOnPhone ? String(res.approval_kind || 'phone').slice(0, 20) : null,
      approved: need || approvedOnPhone ? (ack.ok && approvedOnPhone ? 'approved' : ack.error === 'approval_denied'
        ? 'denied' : 'none') : null,
      ok: Boolean(ack.ok), error: ack.ok ? null : String(ack.error || 'error').slice(0, 40), ms: now() - t0,
      url: res.url ? String(res.url).slice(0, 2048) : null, title: res.title ? String(res.title).slice(0, 200) : null };
    if (!ack.ok && ack.error === 'secret_field') {
      // The phone's own check of the real element found a secret field: it already gave the page to the user.
      const s2 = { kind: String(res.kind || 'password').slice(0, 20), reason: 'The phone found a secret field',
        message: secrets.message(res.kind), say: d.say, tool: cmd.tool, name: cmd.name, phone: true };
      const back = await waiting(handBack(o, log, s2));
      if (back !== 'return_to_ai') return end('interrupted', { error: back });
      backFromUser(HANDED_BACK);
      continue;
    }
    if (need && ack.ok && !approvedOnPhone) {
      await log({ ...entry, error: 'approval_missing' });
      return end('failed', { error: 'approval_missing' });
    }
    // 0.10.3: the user took the browser (Take control) or paused it: wait for it to come back, then carry on.
    if (!ack.ok && USER_HOLDS.includes(ack.error) && typeof o.waitUser === 'function') {
      await log(entry);
      const back = await waiting(o.waitUser(ack.error));
      if (back !== 'return_to_ai' && back !== 'resume') {
        await log({ kind: 'end', status: 'interrupted', error: String(back).slice(0, 40) });
        const why = back === 'timeout' ? 'user_timeout' : String(back || 'ended').slice(0, 40);
        return end('interrupted', { error: why });
      }
      backFromUser(back === 'resume' ? RESUMED : TOOK_CONTROL);
      continue;
    }
    if (!ack.ok && INTERRUPTS.includes(ack.error)) {
      await log(entry);
      return end('interrupted', { error: ack.error });
    }
    if (ack.error === 'timeout') {
      await log(entry);
      if (++phoneTimeouts >= 2) return end('failed', { error: 'phone_timeout' });
    } else phoneTimeouts = 0;
    const shown = cmd.name === 'get_page_content' && ack.ok ? { ...ack, result: secrets.redactContent(res) } : ack;
    const ob = prompt.observe(cmd, shown, { guard, pages });
    if (res.url) here = String(res.url).slice(0, 2048);
    else if (ack.ok && cmd.args.url) here = cmd.args.url;
    // Saga's own navigation is reported by the phone a little later: not the user's doing.
    seenAt = now() + (ack.ok && tools.NAVIGATES.has(cmd.name) ? NAV_GRACE_MS : 0);
    if (ob.page) { entry.url = entry.url || ob.page.url; entry.title = entry.title || ob.page.title;
      entry.page = ob.page.n; }
    if (ack.error !== 'timeout') await log(entry);
    if (ob.elements) elements = ob.elements;
    // The old element ids are gone, unless the phone saw that a click changed nothing on the page (0.10.1).
    else if (ack.ok && tools.NAVIGATES.has(cmd.name) && !(cmd.name === 'click'
      && prompt.KEEPS_ELEMENTS.has(res.changed))) elements = null;
    const note = ack.error === 'approval_denied' ? 'The user declined this action on the phone. Do not try to do '
      + 'the same thing another way; continue without it or finish and explain.' : ack.error === 'reconnected'
      ? RECONNECTED : '';
    if (ack.error === 'reconnected') elements = null;
    messages.push({ role: 'user', content: note ? `${ob.text}\n${note}` : ob.text, observation: true });
  }
}

const USER_HOLDS = ['manual_control', 'paused'];
const RECONNECTED = 'The connection to the phone dropped during this step and came back: the step may or may not '
  + 'have happened. Call getPageContent to see the page now before you act again.';
const HANDED_BACK_ASKED = 'The user did what you asked in the browser and gave control back. Call getPageContent '
  + 'to see the page now, then continue.';
const TOOK_CONTROL = 'The user took control of the browser (your last step did not run) and has now given it back. '
  + 'They may have changed the page: call getPageContent before you act, and do not undo what they did.';
const RESUMED = 'The user paused you and has now resumed (your last step did not run). Call getPageContent, then '
  + 'continue.';
const HANDED_BACK = 'The user typed the private details in the browser themselves and gave control back. Never type '
  + 'passwords, codes, card details or PINs yourself. Call getPageContent to see the page now, then continue.';

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

const blocked = (url) => safety.blockedHost(new URL(url).hostname, { extra: [process.env.BROWSER_READER_BLOCKLIST
  || ''] }).blocked;
const cite = (p) => ({ n: p.n, title: p.title || p.url, url: p.url });

module.exports = { run, forLog, timed };
