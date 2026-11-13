// CBT practice test (v0.5.8): near-duplicate questions. Exact-text de-duplication misses "What is the SI unit of
// force?" vs "The SI unit of force is", so stems are compared as token sets (lower case, no punctuation, no stop
// words, light plural folding) with Jaccard similarity. Numbers count: the same concept with different numbers is
// a fresh question (the prompt asks for that), so stems whose number sets differ are never duplicates.
const THRESHOLD = 0.6;
const SAME_ANSWER = 0.4;   // a lower bar when two items also share the correct option's text

const STOP = new Set(('a,an,the,of,to,in,on,at,by,for,from,with,and,or,but,if,is,are,was,were,be,been,being,am,'
  + 'which,what,who,whom,whose,when,where,why,how,that,this,these,those,it,its,as,into,than,then,there,their,they,'
  + 'them,he,she,his,her,we,you,your,our,i,do,does,did,can,could,would,should,will,shall,may,might,must,has,have,'
  + 'had,not,no,following,one,each,most,best,about,under,over,given,find,calculate,determine,state,identify,'
  + 'correct,true,statement,option,options,answer,below,above,used,called,known,term,refers,means,example')
  .split(','));

const fold = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y'
  : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

// Text -> { words: Set, nums: Set }. Unicode letters are kept, so Yoruba, Hausa and Igbo stems compare too.
function tokens(text) {
  const words = new Set();
  const nums = new Set();
  const parts = String(text || '').toLowerCase().replace(/\\[a-z]+/g, ' ')
    .match(/\d+(?:\.\d+)?|[\p{L}\p{M}]+/gu) || [];
  for (const p of parts) {
    if (/^\d/.test(p)) { nums.add(p); continue; }
    if (p.length < 2 || STOP.has(p)) continue;
    words.add(fold(p));
  }
  return { words, nums };
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

// Similarity of two stems (0..1); 0 when their numbers differ (same concept, new numbers = a new question).
function similarity(a, b) {
  const x = a.words ? a : tokens(a);
  const y = b.words ? b : tokens(b);
  if (!sameSet(x.nums, y.nums)) return 0;
  return jaccard(x.words, y.words);
}

// What an item is compared by: its stem's tokens and its correct option's text.
function fingerprint(item) {
  const t = tokens(item.q);
  const i = ['A', 'B', 'C', 'D'].indexOf(item.answer);
  const key = item.options && i > -1 ? String(item.options[i]).toLowerCase().replace(/\s+/g, ' ').trim() : '';
  return { words: t.words, nums: t.nums, key };
}

// Is `fp` a near-duplicate of any fingerprint in `list`? Same correct option + related stem also counts.
function nearAny(fp, list, threshold = THRESHOLD) {
  return list.some((o) => {
    const s = similarity(fp, o);
    return s >= threshold || (fp.key && o.key && fp.key === o.key && s >= SAME_ANSWER);
  });
}

module.exports = { THRESHOLD, tokens, similarity, fingerprint, nearAny };
