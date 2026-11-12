// Self-harm and suicide: never refused. The reply starts with a short supportive message and Nigerian helplines
// (messages.js) and the model is told how to answer (care.js: listen, no methods, encourage reaching out).
// Statistics, essays, films ("Suicide Squad") and idioms ("I nearly died laughing") are left alone.

const SELF = [
  // English
  String.raw`\b(?:kill|killing|hurt|hurting|harm|harming|cut|cutting|burn|burning) (?:my ?self|myself)\b`,
  String.raw`\b(?:kill|killing|kills|killed|hurt|hurting|hurts|harm|harming|cut|cutting|cuts) `
    + String.raw`(?:him|her|them)sel(?:f|ves)\b`,
  String.raw`\b(?:end|ending|take|taking) (?:my|my own|his|her|their) life\b`,
  String.raw`\bend it all\b`,
  String.raw`\b(?:commit|committing|attempt|attempted|attempting) suicide\b`,
  String.raw`\bsuicidal\b`,
  String.raw`\bself[- ]?harm\w*\b`,
  String.raw`\b(?:i|i'm|im|i am|i've|ive|i keep) (?:\w+ ){0,3}(?:want|wanna|wish|going|gonna|plan\w*|thinking|think|`
    + String.raw`feel like|tempted|ready) (?:about |of )?(?:to )?(?:die|dying|be dead|not (?:be )?(?:alive|here)|`
    + String.raw`disappear forever|sleep and never wake up)\b`,
  String.raw`\b(?:better off dead|no reason to (?:live|go on)|don'?t want to (?:live|be alive|wake up)|`
    + String.raw`can'?t (?:go on|do this) anymore|tired of (?:living|life|being alive))\b`,
  String.raw`\bhow many (?:\w+ ){0,3}(?:pills|tablets|capsules) (?:\w+ ){0,3}(?:to|will|would|can|could) `
    + String.raw`(?:kill|die|end)`,
  String.raw`\b(?:painless|easiest|quickest|surest) way to (?:die|kill myself|end (?:my|it))\b`,
  String.raw`\b(?:i|i'll|i will|i wan|i go|make i) (?:\w+ ){0,2}drink (?:sniper|otapiapia|rat poison|poison)\b`,
  // Pidgin
  String.raw`\bi (?:wan|go|fit) (?:just )?(?:kill|die|take) (?:myself|my life|reach|commot for this world)\b`,
  String.raw`\bmake i (?:just )?(?:die|kpeme|kill myself)\b`,
  String.raw`\b(?:life|this life|everything) (?:don|done) (?:tire|taya) me\b`,
  String.raw`\bi no (?:wan|fit) (?:live|continue|dey alive) again\b`,
  // Yorùbá: "pa ara mi" (kill myself), "mo fẹ́ kú" (I want to die)
  String.raw`\b(?:pa ara mi|pa ara mi l'?ara|mo fe ku|mo fe pa ara mi|ma pa ara mi|aye su mi)\b`,
  // Hausa: "kashe kaina" (kill myself), "ina so in mutu" (I want to die)
  String.raw`\b(?:kashe kaina|in kashe kaina|ina so in mutu|ina son in mutu|zan kashe kaina|na gaji da rayuwa)\b`,
  // Igbo: "igbu onwe m" (kill myself), "achọrọ m ịnwụ" (I want to die)
  String.raw`\b(?:igbu onwe m|gbuo onwe m|ga-egbu onwe m|achoro m inwu|achoro m ka m nwuo|ndu agwula m ike)\b`,
];

const OTHERS = [
  String.raw`\b(?:my|our|a) (?:friend|sister|brother|mum|mom|mother|dad|father|son|daughter|wife|husband|partner|`
    + String.raw`classmate|roommate|cousin|colleague|student|child|boyfriend|girlfriend) (?:\w+ ){0,4}(?:wants? to|is `
    + String.raw`going to|said|says|tried|threatened|talks? about|keeps? saying|is thinking)\b`,
  String.raw`\b(?:he|she|they) (?:\w+ ){0,2}(?:wants? to|is going to|said|tried|threatened|keeps? saying)\b`,
  String.raw`\bhow (?:can|do|should) i (?:help|support|talk to)\b`,
];

const BENIGN = [
  String.raw`\bsuicide (?:squad|rates?|statistics|stats|prevention|awareness|bomb\w*|mission|doors?|run|drill)\b`,
  String.raw`\b(?:laugh\w*|laughter|embarrass\w*|cringe)\b`,
  String.raw`\b(?:essay|research|thesis|statistics|lecture|presentation|assignment|novel|character|movie|film|song|`
    + String.raw`lyrics|poem about|history of|definition of|meaning of)\b`,
];

module.exports = {
  category: 'self_harm',
  rules: [
    // Someone else at risk: help the helper, with the helplines first.
    { id: 'self_harm_other', all: [SELF, OTHERS], window: 120, unless: BENIGN, action: 'allow_with_care',
      care: 'self_harm_helper', prefix: 'self_harm' },
    // The user themselves.
    { id: 'self_harm', all: [SELF], unless: BENIGN, action: 'allow_with_care', care: 'self_harm', prefix: 'self_harm' },
  ],
  output: [],
};
