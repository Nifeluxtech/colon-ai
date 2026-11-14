/* Colon AI · text that should never be sent as a chat message (0.11.0, Colon Secured Login, ADR 0007). Before the
   composer sends, a message that looks like a password ("my password is …", "pass: …", or one word mixing letters,
   digits and symbols) is held back: the chat warns and offers the secure card instead, which saves the login on the
   phone (never in the chat, the server, logs or any model prompt). Also reads "save my github login" requests.
   Pure and DOM-free: unit-tested in packages/ui/test/secret-text.test.js. Mirrors StepLog.looksLikePassword
   (apps/android) for the one-word rule. */

var SAID = new RegExp('\\b(?:my\\s+)?(?:password|passcode|passwd|pwd|pass ?word|pin|otp|login code|security code)'
  + '\\b\\s*(?:is|was|=|:|-)\\s*\\S+', 'i');
var URLISH = /^https?:\/\/|^www\.|\.(?:com|ng|org|net|io|app|dev)(?:\/|$)/i;

/** One word of 8-64 characters mixing letters with digits and symbols (or both cases and digits). */
function passwordLike(word) {
  var t = String(word || '').trim();
  if (t.length < 8 || t.length > 64 || /\s/.test(t) || URLISH.test(t)) return false;
  var lower = /[a-z]/.test(t), upper = /[A-Z]/.test(t), digit = /\d/.test(t), symbol = /[^A-Za-z0-9]/.test(t);
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return false;           // an email address on its own
  // Without a symbol, 10+ characters (product names like "iPhone15" stay chat; the app's timeline hides both).
  return (digit && symbol && (lower || upper)) || (lower && upper && digit && t.length >= 10);
}

/** Does this message look like it carries a password? (a statement of one, or a lone password-like word) */
function looksLikePassword(text) {
  var s = String(text || '').trim();
  if (!s || s.length > 400) return false;
  if (SAID.test(s)) return true;
  var words = s.split(/\s+/);
  return words.length <= 3 && words.some(passwordLike);
}

var SAVE = new RegExp('^(?:please\\s+)?(?:save|store|remember|add|keep)\\s+(?:my\\s+|a\\s+|the\\s+)?(?:(.+?)\\s+)?'
  + '(?:login|log-?in|password|sign-?in|account|credentials)(?:\\s+(?:for|on|to)\\s+(.+?))?'
  + '(?:\\s+(?:securely|safely|please|for saga))*\\s*[.!]?$', 'i');
var HOST = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,24})(?:[/?#].*)?$/i;
var NAMES = { github: 'github.com', gmail: 'google.com', google: 'google.com', facebook: 'facebook.com',
  instagram: 'instagram.com', twitter: 'x.com', x: 'x.com', linkedin: 'linkedin.com', jumia: 'jumia.com.ng',
  konga: 'konga.com', yolotask: 'yolotask.com', netflix: 'netflix.com', paypal: 'paypal.com' };

/** A site from free text: "github", "github.com", "https://www.github.com/login" -> "github.com" ('' if none). */
function siteOf(text) {
  var t = String(text || '').trim().toLowerCase().replace(/^(?:my|the|a)\s+/, '');
  var m = HOST.exec(t);
  if (m) return m[1];
  return NAMES[t.replace(/\s+(?:account|site|website)$/, '')] || '';
}

/** "save my github login" -> { site: 'github.com' }; "save a login" -> { site: '' }; anything else -> null. */
function saveLoginIntent(text) {
  var m = SAVE.exec(String(text || '').trim());
  if (!m) return null;
  return { site: siteOf(m[2] || m[1] || '') };
}

export { looksLikePassword, passwordLike, saveLoginIntent, siteOf };
