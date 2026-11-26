// The email Colon sends through Gmail (0.40.0): checked fields and one RFC 5322 text/plain message, base64url
// encoded for users.messages.send. UTF-8 subject and body (Yorùbá, Igbo, Hausa, ₦ all survive).
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
const MAX_TO = 10, MAX_SUBJECT = 300, MAX_BODY = 50000;
const bad = (message, field) => Object.assign(new Error(message), { status: 422, code: 'invalid', field });

function list(v, field) {
  const a = (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean);
  for (const x of a) if (!EMAIL.test(x)) throw bad(`“${x.slice(0, 80)}” isn’t an email address.`, field);
  return [...new Set(a)];
}
// -> { to: [..], cc: [..], subject, body } or a 422
function check(m = {}) {
  const to = list(m.to, 'to'), cc = list(m.cc, 'cc');
  if (!to.length) throw bad('Who should get this email? Add an address.', 'to');
  if (to.length + cc.length > MAX_TO) throw bad(`Send to at most ${MAX_TO} people at a time.`, 'to');
  const subject = String(m.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_SUBJECT);
  const body = String(m.body || '').replace(/\r\n?/g, '\n');
  if (!body.trim()) throw bad('The email is empty.', 'body');
  if (body.length > MAX_BODY) throw bad('The email is too long to send.', 'body');
  return { to, cc, subject, body };
}
const word = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
function build({ from, to, cc = [], subject, body }) {
  const head = [from ? `From: ${from}` : '', `To: ${to.join(', ')}`, cc.length ? `Cc: ${cc.join(', ')}` : '',
    `Subject: ${word(subject || '(no subject)')}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', 'X-Mailer: Colon AI'].filter(Boolean);
  const b64 = Buffer.from(body, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(`${head.join('\r\n')}\r\n\r\n${b64}`, 'utf8').toString('base64url');
}

module.exports = { check, build, EMAIL };
