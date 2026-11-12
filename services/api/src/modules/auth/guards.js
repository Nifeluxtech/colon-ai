// Route guards. A guard throws to stop the request; otherwise the next handler runs.
const RANK = { user: 0, moderator: 1, admin: 2, super_admin: 3 };

const deny = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };

const requireUser = async (req) => { if (!req.user) deny(401, 'unauthenticated', 'Please sign in.'); };

// Staff roles must have 2FA switched on before they can use any staff endpoint.
const requireRole = (role) => async (req) => {
  await requireUser(req);
  if (RANK[req.user.role] < RANK[role]) deny(403, 'forbidden', "You don't have access to this.");
  if (!req.user.totp_enabled) deny(403, 'needs_2fa', 'Turn on two-factor authentication to use admin tools.');
};

function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, language: u.language, role: u.role,
    email_verified: Boolean(u.email_verified_at), totp_enabled: Boolean(u.totp_enabled),
    has_password: Boolean(u.has_password), has_google: Boolean(u.has_google), created_at: u.created_at,
  };
}

module.exports = { RANK, requireUser, requireRole, publicUser, deny };
