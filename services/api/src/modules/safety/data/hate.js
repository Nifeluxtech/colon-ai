// Hate and harassment: refused when someone asks to attack, dehumanise or incite violence against people for who
// they are (ethnic group, religion, sex, sexuality, disability, nationality), or to write threats or bullying
// messages. Asking whether a stereotype is true, the history of the civil war, news about hate speech, or how to
// handle a bully gets an answer (with care where the question repeats a slur or a stereotype).
const { NEWS } = require('./common');

const GROUP = String.raw`(?:igbos?|ndi igbo|yorubas?|hausas?|fulanis?|hausa-fulanis?|ijaws?|tivs?|efiks?|ibibios?|`
  + String.raw`urhobos?|itsekiris?|edos?|binis?|kanuris?|nupes?|igalas?|idomas?|northerners|southerners|easterners|`
  + String.raw`westerners|christians|muslims|jews|pagans|traditionalists|atheists|gays?|lesbians?|homosexuals?|`
  + String.raw`trans(?:gender)? people|women|girls|albinos?|disabled people|cripples|blacks?|whites?|africans|`
  + String.raw`nigerians|ghanaians|cameroonians|foreigners|refugees|immigrants|almajiris?|yarbawa|inyamurai|`
  + String.raw`nyamiri|gambaris?|awon (?:igbo|hausa|yoruba|fulani)|ndi (?:hausa|yoruba|fulani)|'?yan (?:igbo|kudu))`;

const DEHUMANIZE = String.raw`(?:animals?|beasts?|cockroach(?:es)?|vermin|parasites?|rats?|dogs?|baboons?|`
  + String.raw`monkeys?|apes?|pigs?|goats?|subhumans?|sub-human|savages?|devils?|demons?|scum|filth|cancer|`
  + String.raw`inferior|not human|less than human|a disease|a plague)`;

const ATTACK_VERB = String.raw`(?:kill|exterminate|wipe out|burn|slaughter|massacre|behead|lynch|cleanse|eliminate|`
  + String.raw`chase out|drive out|expel|rape|attack|stone|deport all)`;

const BENIGN = [
  ...NEWS,
  String.raw`\b(?:is it true|why do (?:people|some)|stereotypes?|prejudice|tribalism|bias|myth|misconception|`
    + String.raw`hate speech (?:law|bill|definition|examples?)|define|definition|meaning of|what does .{0,30} mean|`
    + String.raw`how (?:to|do i|can i|should i) (?:respond|reply|counter|handle|deal with|report|stop)|`
    + String.raw`civil war|biafra|history|unity|peace|reconcil\w*|translate|quoted?|someone said|they (?:call|said))\b`,
];

const COMPOSE = [
  String.raw`\b(?:write|compose|draft|craft|create|generate|make|give me|help me (?:write|send|make))(?: \w+){0,4} `
    + String.raw`(?:threatening|threat|threats|insulting|abusive|harass\w*|bully\w*|humiliat\w*|degrading|hateful|`
    + String.raw`racist|tribalist\w*|sexist|homophobic|death threat)(?: \w+){0,2} (?:message|messages|text|letter|`
    + String.raw`post|tweet|comment|note|song|poem|email|dm|caption|chant|speech)\b`,
  String.raw`\b(?:help me|how (?:do|can) i|how to|ways? to)(?: \w+){0,1} (?:harass|bully|cyberbully|stalk|`
    + String.raw`intimidate|threaten|blackmail|humiliate|terrori[sz]e)(?: \w+){0,1} `
    + String.raw`(?:my |him|her|them|someone|somebody|a |this |that |the )`,
];

module.exports = {
  category: 'hate',
  rules: [
    { id: 'hate_dehumanize', all: [[String.raw`\b${GROUP} (?:are|is|be|na|dey|dem be|people are)(?: all| just| only|`
      + String.raw` nothing but| like)? ${DEHUMANIZE}\b`]], unless: BENIGN, unlessAction: 'allow_with_care',
    unlessCare: 'hate_context', action: 'refuse' },
    { id: 'hate_incite', all: [[String.raw`\b${ATTACK_VERB} (?:all |every |the |these |those |una )?`
      + String.raw`(?:\w+ )?${GROUP}\b`, String.raw`\b${GROUP} (?:must|should|deserve to|go) (?:all )?(?:die|be killed|`
      + String.raw`be wiped out|be exterminated|be burned|leave|be chased out|be expelled)\b`]],
    unless: BENIGN, unlessAction: 'allow_with_care', unlessCare: 'hate_context', action: 'refuse' },
    { id: 'harass_compose', all: [COMPOSE], unless: [String.raw`\b(?:being|been|was|is|am|i'?m|keeps?) `
      + String.raw`(?:bullied|harassed|threatened|stalked|blackmailed)\b`, String.raw`\b(?:someone|he|she|they|my \w+) `
      + String.raw`(?:is|are|keeps?|has been) (?:bullying|harassing|threatening|stalking|blackmailing)\b`,
    String.raw`\b(?:report|stop|protect|respond|deal with|cope|lawyer|police)\b`], action: 'refuse' },
  ],
  output: [],
};
