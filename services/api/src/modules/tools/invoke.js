// The tool router (0.17.0, Blueprint D14): every server-side tool call goes through invoke(), in this order:
//   1. known and switched on            unknown_tool (404) | tool_off (503)
//   2. arguments match the schema       invalid (422)
//   3. who may call it                  guests only when the tool allows it (login_required, 401)
//   4. plan access                      the plan is in tool.plans and has tool.entitlement switched on
//   5. monthly count                    the entitlement's limit is not used up (quota, 402)
//   6. consent                          tool.consent needs ctx.consent === true (consent_required, 409)
//   7. credits                          reserved under one request id (the existing credit engine, modules/billing)
//   8. run with a timeout               tool_timeout (504) aborts ctx.signal
//   9. settle or refund                 settled on success, refunded in full on any failure; a deferred tool
//                                       (background work) keeps its reservation until close() settles or refunds it
// BILLING_MODE (the same semantics as chat): off = no plan checks and nothing recorded; shadow = recorded, never
// blocks (a call the plan would not allow runs and is logged as gated); enforce = refused.
// Staff (moderator and above) are never gated or charged. ctx.user undefined = an internal call (system jobs,
// tests): no gating and no billing; ctx.user null = a guest.
const crypto = require('crypto');
const { validate } = require('./registry');

// extra: also sent to the app beside error / message (http/server.js), e.g. the credits a consent is for.
const err = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra, extra });
const staff = (u) => Boolean(u && u.role && u.role !== 'user');

function create({ registry, engine, mode, log }) {
  const billMode = () => (typeof mode === 'function' ? mode() : mode) || 'off';
  const eng = () => (typeof engine === 'function' ? engine() : engine);
  const stats = new Map();   // name -> { calls, ok, failed, refused, gated, last_ms, last_error } (this worker only)
  const stat = (name) => stats.get(name) || stats.set(name, { calls: 0, ok: 0, failed: 0, refused: 0, gated: 0,
    last_ms: 0, last_error: null }).get(name);

  async function gate(t, ctx, out) {
    const user = ctx.user;
    if (user === null && !t.guests) throw err(401, 'login_required', 'Log in to use this.');
    if (!user || staff(user) || billMode() === 'off') return;
    const enforce = billMode() === 'enforce';
    let planCode = null;
    if (t.plans) {
      const plan = await eng().planFor(user.id);
      planCode = plan && plan.code;
      if (!t.plans.includes(planCode)) {
        if (enforce) throw err(403, 'plan', 'Your plan doesn’t include this yet. See Settings › Plan to upgrade.',
          { tool: t.name });
        out.gated = true;
      }
    }
    if (t.entitlement) {
      const q = await eng().checkQuota(user, t.entitlement);
      const off = q.limit === 0;
      if (!q.allowed) {
        throw off ? err(403, 'plan', 'Your plan doesn’t include this yet. See Settings › Plan to upgrade.',
          { tool: t.name })
          : err(402, 'quota', `You’ve used this month’s ${q.limit} ${t.unit || 'uses'} on your plan. `
            + 'They renew on the 1st.', { tool: t.name, limit: q.limit });
      }
      if (off || (q.limit != null && q.remaining <= 0)) out.gated = true;   // shadow: allowed, but recorded
      out.quota = q;
    }
  }

  function withTimeout(fn, ms, outer) {
    const ctl = new AbortController();
    const onOuter = () => ctl.abort();
    if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', onOuter, { once: true }); }
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { ctl.abort(); reject(err(504, 'tool_timeout', 'That took too long. Try again.')); },
        ms);
    });
    return Promise.race([Promise.resolve().then(() => fn(ctl.signal)), timeout]).finally(() => {
      clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onOuter);
    });
  }

  /**
   * invoke(name, args, ctx) -> { result, tool, requestId, reserved, gated, deferred }
   * ctx: { user, requestId?, consent?, signal?, run?(args, ctx) (when the tool's executor lives with the caller),
   *        ...anything the executor needs (passed through as ctx) }
   */
  async function invoke(name, args, ctx = {}) {
    const t = registry.get(name);
    if (!t) throw err(404, 'unknown_tool', `There is no tool called ${String(name).slice(0, 40)}.`);
    const s = stat(t.name);
    s.calls++;
    const started = Date.now();
    const out = { tool: t.name, gated: false, reserved: 0, deferred: Boolean(t.defer), requestId: null };
    let bill = null;
    try {
      if (!registry.isOn(t)) throw err(503, 'tool_off', 'This isn’t switched on right now.', { tool: t.name });
      const clean = validate(t.schema, args);
      await gate(t, ctx, out);
      if (t.consent && ctx.consent !== true) {
        throw err(409, 'consent_required', 'Confirm before this runs.', { tool: t.name,
          credits: registry.creditsOf(t), risk: t.risk });
      }
      const run = t.run || ctx.run;
      if (typeof run !== 'function') throw err(500, 'tool_no_runner', `${t.name} has no executor here.`);
      const credits = registry.creditsOf(t);
      const user = ctx.user;
      if (user && (credits > 0 || t.entitlement) && billMode() !== 'off') {
        const requestId = String(ctx.requestId || `tool:${t.name}:${crypto.randomBytes(9).toString('base64url')}`)
          .slice(0, 100);
        const r = await eng().reserve({ user, requestId, feature: t.entitlement || 'tool', mode: t.name.slice(0, 16),
          credits });
        if (r) { bill = { requestId, user }; out.reserved = r.reserved; out.requestId = requestId; }
      }
      out.requestId = out.requestId || (ctx.requestId ? String(ctx.requestId) : null);
      const result = await withTimeout((signal) => run(clean, { ...ctx, signal, requestId: out.requestId,
        tool: t }), t.timeoutMs, ctx.signal);
      if (bill && !t.defer) {
        await eng().settle({ user: bill.user, requestId: bill.requestId,
          credits: result && result.credits != null ? result.credits : undefined,
          provider: result && result.provider, model: result && result.model })
          .catch((e) => log.warn('tool_settle_failed', { tool: t.name, err: e.message }));
      }
      s.ok++; s.last_ms = Date.now() - started;
      if (out.gated) { s.gated++; log.warn('tool_gated_shadow', { tool: t.name, user: ctx.user && ctx.user.id }); }
      return { ...out, result };
    } catch (e) {
      if (bill) {
        await eng().refund({ user: bill.user, requestId: bill.requestId, reason: `${t.name} failed` })
          .catch((x) => log.warn('tool_refund_failed', { tool: t.name, err: x.message }));
      }
      const refused = ['login_required', 'plan', 'quota', 'consent_required', 'invalid', 'tool_off'].includes(e.code);
      if (refused) s.refused++; else s.failed++;
      s.last_ms = Date.now() - started;
      s.last_error = e.name === 'AbortError' ? 'aborted' : String(e.code || e.message || 'error').slice(0, 80);
      if (!refused && e.name !== 'AbortError') {
        log.warn('tool_failed', { tool: t.name, code: e.code, ms: s.last_ms, err: String(e.message).slice(0, 160) });
      }
      throw e;
    }
  }

  /** Ends a deferred call's reservation: settled when it delivered (ok), refunded in full when it did not. */
  async function close({ user, requestId, ok, credits, reason }) {
    if (!requestId || !user || billMode() === 'off') return null;
    return ok ? eng().settle({ user, requestId, credits })
      : eng().refund({ user, requestId, reason: reason || 'Not delivered' });
  }

  const statsOf = () => Object.fromEntries([...stats].map(([k, v]) => [k, { ...v }]));
  return { invoke, close, stats: statsOf, _reset() { stats.clear(); } };
}

module.exports = { create };
