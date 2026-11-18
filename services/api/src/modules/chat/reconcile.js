// Replies cut off by a restart (0.16.0, the 'chat.reconcile' job; Blueprint C12). A chat or Research reply streams
// inside its HTTP request; when Passenger recycles the worker mid-answer the request dies with it, the message stays
// 'streaming' and the credits reserved for it (1, or 3 in Research mode) stay reserved. This job, run by the cron
// every interval, closes such replies the way reply.js would have: the message becomes an error ('interrupted', the
// same thing the app already shows for it), and the reservation is settled when text was saved (an answer reached
// the user) or refunded in full when nothing was. Billing follows BILLING_MODE as always (off: nothing to do).
const db = require('../../db');
const billing = require('../billing');
const log = require('../../shared/logger');

const AFTER_MS = 15 * 60e3;    // replies are capped at AI_MAX_REPLY_MS (3 min); a reservation this old is orphaned
const INTERRUPTED = { code: 'interrupted', message: 'This reply was interrupted. Try regenerating it.' };

/** run({ now, limit, engine }) -> { checked, refunded, settled, marked } */
async function run(o = {}) {
  const now = o.now || new Date();
  const engine = o.engine || billing;
  const out = { checked: 0, refunded: 0, settled: 0, marked: 0 };
  const rows = await engine.staleReservations({ before: new Date(now.getTime() - AFTER_MS), prefix: 'chat:',
    limit: Math.min(200, Number(o.limit) || 100) });
  for (const u of rows) {
    out.checked++;
    const requestId = String(u.request_id);
    const id = requestId.slice('chat:'.length);
    const m = await db.one('SELECT id, status, content FROM chat_messages WHERE id = ?', [id]);
    if (m && m.status === 'streaming') {
      const r = await db.query("UPDATE chat_messages SET status = 'error', error = ? WHERE id = ? AND status = "
        + "'streaming'", [JSON.stringify(INTERRUPTED), id]);
      if (Number(r.affectedRows)) out.marked++;
    }
    const delivered = Boolean(m && String(m.content || '').trim() && m.status !== 'error');
    const user = { id: Number(u.user_id), role: 'user' };
    try {
      if (delivered) { if (await engine.settle({ user, requestId })) out.settled++; }
      else if (await engine.refund({ user, requestId, reason: 'Reply interrupted' })) out.refunded++;
    } catch (e) {
      log.warn('chat_reconcile_failed', { request: requestId, err: e.message });
      throw e;                                   // the job is retried with backoff; settle / refund are idempotent
    }
  }
  if (out.checked) log.info('chat_reconciled', out);
  return out;
}

module.exports = { run, AFTER_MS };
