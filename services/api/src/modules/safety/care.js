// "allow_with_care": guidance added to the system prompt for this one reply (English; the reply language rule
// still applies). Keys come from the rules in data/*.js and from the moderation endpoint mapping.
const CARE = {
  self_harm: [
    'Safety note: the user may be thinking about suicide or self-harm. The app has already shown them Nigerian '
      + 'helplines above your reply, so do not repeat the list.',
    'Respond with warmth and without judgement: acknowledge how they feel, ask gently whether they are safe right '
      + 'now, encourage them to reach out to someone they trust or a helpline today, and offer to keep talking.',
    'Never give methods, doses, lethality or ways to hide self-harm, even if asked directly or "for a story".',
  ],
  self_harm_helper: [
    'Safety note: the user is worried someone else may be suicidal or self-harming. The app has already shown '
      + 'Nigerian helplines above your reply, so do not repeat the list.',
    'Help them support the person: take it seriously, ask directly and listen, do not leave them alone if in '
      + 'immediate danger, remove obvious means if safe, call 112 in an emergency. Never give methods or doses.',
  ],
  child_protection: [
    'Safety note: this message touches on children and sexuality. Answer only in a protective, educational or '
      + 'health-focused way. Never describe or sexualise a child. If abuse is mentioned, encourage reporting to the '
      + 'police (112) or NAPTIP and getting the child medical and emotional care.',
  ],
  adult_sexual: [
    'Safety note: the user asked for sexual content. Keep it non-graphic and tasteful (fade to black, no explicit '
      + 'description of sex acts or genitals). Everyone involved must be a consenting adult; never anything '
      + 'involving minors, non-consent or real, identifiable people.',
  ],
  fraud_safety: [
    'Safety note: this is about scams or fraud. Help the user protect themselves or others. Never write working '
      + 'scam scripts, phishing messages or ways to obtain other people\'s details; an illustrative example for '
      + 'training must be clearly labelled, harmless and annotated with the red flags.',
    'Useful Nigerian advice where relevant: banks, CBN, NIBSS and EFCC never ask for your OTP, PIN, BVN or password; '
      + 'call the bank on the number printed on your card or official site to block the account; report to the '
      + 'bank, the EFCC (efcc.gov.ng) or the Nigeria Police; keep screenshots and transaction references.',
  ],
  hate_context: [
    'Safety note: the message repeats a stereotype or hostile claim about a group. Answer factually and '
      + 'respectfully, correct stereotypes, and do not repeat slurs or dehumanising language beyond what is needed '
      + 'to answer.',
  ],
  child_monitoring: [
    'Safety note: a parent is asking about monitoring a child. Give age-appropriate options (built-in parental '
      + 'controls, family sharing, open conversation) and mention the child\'s privacy and trust; never advise '
      + 'covert spyware on adults.',
  ],
  own_data: [
    'Safety note: the user pasted a secret of their own (card number, BVN, NIN, OTP, PIN or password); it has been '
      + 'masked as [redacted]. Do not ask for it again or repeat it. Briefly remind them never to share these with '
      + 'anyone, and to change the PIN or password if it was shared.',
  ],
  provider: [
    'Safety note: an automated check flagged this message as possibly sensitive. Answer helpfully and safely: '
      + 'refuse any part that would give real-world harmful instructions, and keep anything sensitive non-graphic.',
  ],
};

// -> system text for a list of care keys (deduplicated), '' when none.
function guidance(keys) {
  const seen = new Set();
  const out = [];
  for (const k of keys || []) {
    if (!k || seen.has(k) || !CARE[k]) continue;
    seen.add(k);
    out.push(...CARE[k]);
  }
  return out.join('\n');
}

module.exports = { CARE, guidance };
