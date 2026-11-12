// Auth: sign up (handlers for src/http/routes/auth/signup.js).

const db = require('../../../db');
const v = require('../../../shared/validate');
const audit = require('../../../shared/audit');
const { hashPassword } = require('../../../shared/crypto');
const sessions = require('../sessions');
const { roleFor, sendVerification } = require('./auth-common');

// POST /auth/register
const postAuthRegister = async (req) => {
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);
  const name = v.name(req.body.name);
  const language = v.language(req.body.language);
  if (req.body.accept_terms !== true) v.fail('accept_terms', 'Please accept the terms and privacy policy.');
  if (await db.one('SELECT id FROM users WHERE email = ?', [email])) v.fail('email',
    'An account with this email already exists. Try signing in.');
  const result = await db.query(
    'INSERT INTO users (email, password_hash, name, language, role) VALUES (?,?,?,?,?)',
    [email, await hashPassword(password), name, language, roleFor(email)]
  );
  const user = { id: result.insertId, email };
  await audit(req, 'user.register', { actorId: user.id, targetType: 'user', targetId: user.id });
  const mailed = await sendVerification(user);
  const cookie = await sessions.create(req, user.id);
  return [201, { ok: true, verification_sent: mailed }, { 'Set-Cookie': cookie }];
};

module.exports = { postAuthRegister };
