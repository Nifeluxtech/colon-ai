const db = require('../db');
const log = require('./logger');

// Every security-relevant and admin action is written here (Phase 2 release standard).
async function audit(req, action, { actorId = null, targetType = null, targetId = null, meta = null } = {}) {
  try {
    await db.query(
      'INSERT INTO audit_log (actor_id, action, target_type, target_id, ip, meta) VALUES (?,?,?,?,?,?)',
      [actorId, action, targetType, targetId == null ? null : String(targetId), req.ip || '', meta ? JSON.stringify(meta) : null]
    );
  } catch (e) {
    log.error('audit_failed', { action, err: e.message });
  }
}

module.exports = audit;
