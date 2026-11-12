// Text folding for the rule filters: one cheap pass so the pattern lists only need one spelling.
//   - Unicode NFKD, then combining marks dropped: Yorùbá tone marks and subdots (ọ → o, ṣ → s), Igbo dots (ị → i);
//   - invisible characters removed (zero-width, bidi controls, soft hyphen, Unicode "tag" characters);
//   - lower case, curly quotes made straight, look-alike digits inside words read as letters (m3th → meth);
//   - letters spelt out with spaces or dots joined (b.o.m.b → bomb), long letter runs shortened (soooo → soo);
//   - whitespace collapsed. Capped at 20,000 characters (a chat message is at most 16,000).
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', '@': 'a', $: 's' };
const MAX = 20000;

function stripMarks(s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function fold(text) {
  let s = stripMarks(String(text == null ? '' : text).slice(0, MAX)).replace(INVISIBLE, '').toLowerCase();
  s = s.replace(/[\u2018\u2019\u02BC`]/g, "'").replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/(?<=[a-z])[0134@$5](?=[a-z])/g, (c) => LEET[c]);
  s = s.replace(/\b(?:[a-z][ .\-_*]){2,}[a-z]\b/g, (m) => {
    const lead = /^[ai] /.test(m) && m.length > 7 ? m.slice(0, 2) : '';   // "a b o m b": keep the article
    return lead + m.slice(lead.length).replace(/[ .\-_*]/g, '');
  });
  s = s.replace(/([a-z])\1{2,}/g, '$1$1');
  return s.replace(/\s+/g, ' ').trim();
}

// Pattern fragments are written in natural spelling; this folds them the same way (no leet or joining).
const foldPattern = (p) => stripMarks(p).toLowerCase();

module.exports = { fold, foldPattern, stripMarks, INVISIBLE };
