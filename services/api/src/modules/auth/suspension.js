// Phase 4: suspended accounts (user_suspensions). A suspended user can't sign in and has no sessions.
// A read error counts as "not suspended" so a database hiccup (or 0004 not applied yet) never locks everyone out;
// suspending deletes the user's sessions, so access still ends straight away.
const SUSPENDED_MESSAGE = 'This account is suspended. Contact Colon AI support if you think this is a mistake.';

async function isSuspended(userId, db) {
  try {
    const row = await (db || require('../../db')).one('SELECT 1 AS x FROM user_suspensions WHERE user_id = ?',
      [userId]);
    return Boolean(row);
  } catch {
    return false;
  }
}

module.exports = { isSuspended, SUSPENDED_MESSAGE };
