// 0.11.0 (ADR 0007): passwords never go in the chat (apps/chat/src/lib/secret-text.js). The composer holds back a
// message that looks like a password and offers Colon Secured Login; "save my github login" opens the secure card.
const test = require('node:test');
const assert = require('node:assert/strict');
const { looksLikePassword, passwordLike, saveLoginIntent, siteOf } =
  require('../../../apps/chat/src/lib/secret-text.js');

test('a stated password or a lone password-like word is caught', () => {
  assert.equal(looksLikePassword('my password is hunter2'), true);
  assert.equal(looksLikePassword('Password: abc'), true);
  assert.equal(looksLikePassword('pin = 1234'), true);
  assert.equal(looksLikePassword('Tr0ub4dor&3'), true);
  assert.equal(looksLikePassword('login with Sup3rSecret'), true);
});

test('ordinary messages, links and email addresses are left alone', () => {
  for (const s of ['hello there', 'what is the weather in Lagos today?', 'https://github.com/login',
    'ada@example.com', 'open google.com', 'iPhone15', 'forgot my password, how do I reset it?', '',
    'I need to change the password on my account because I think somebody else has it now']) {
    assert.equal(looksLikePassword(s), false, s);
  }
  assert.equal(passwordLike('short1!'), false);
  assert.equal(passwordLike('x'.repeat(70) + '1!'), false);
  assert.equal(passwordLike('Abcdefgh12'), true);
  assert.equal(passwordLike('Abcdefg1'), false);
});

test('save-login requests name the site', () => {
  assert.deepEqual(saveLoginIntent('save my github login'), { site: 'github.com' });
  assert.deepEqual(saveLoginIntent('Please store my password for jumia'), { site: 'jumia.com.ng' });
  assert.deepEqual(saveLoginIntent('save a login'), { site: '' });
  assert.deepEqual(saveLoginIntent('remember the login for https://www.yolotask.com/signin'), { site: 'yolotask.com' });
  assert.equal(saveLoginIntent('save this file'), null);
  assert.equal(siteOf('GitHub account'), 'github.com');
  assert.equal(siteOf('nothing here'), '');
});
