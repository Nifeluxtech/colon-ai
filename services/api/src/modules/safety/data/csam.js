// Child sexual content: always refused, for everyone, whatever the settings (fail closed).
// Protective or health framing (reporting abuse, sex education, puberty questions, a parent asking what to do)
// is answered with care instead: never sexualise a child, encourage reporting, point to help.
const { GENERATE } = require('./common');

const MINOR = [
  String.raw`\b(?:child|children|kid|kids|kiddie|minor|minors|underage|under-age|under age|pre-?teens?|teens?|`
    + String.raw`teenage|teenager|teenagers|toddlers?|infants?|newborns?|schoolgirls?|schoolboys?|pupils?|loli|lolicon|`
    + String.raw`shota|jailbait)\b`,
  String.raw`\b(?:little|young|small) (?:girl|boy|girls|boys|child|one)\b`,
  String.raw`\bunder (?:1[0-8]|[1-9])\b`,
  String.raw`\bmy (?:little |young )?(?:daughter|son|niece|nephew|stepdaughter|stepson|ward)\b`,
  String.raw`\b(?:[1-9]|1[0-7])[- ]?(?:years?|yrs?|yo|y\/o)(?:[- ]old)?\b`,
  String.raw`\b(?:primary school|jss ?[1-3]|basic [1-9]|primary [1-6])\b`,
  // Pidgin, Yorùbá, Hausa, Igbo
  String.raw`\b(?:pikin|pikins|small pikin|small girl|small boy)\b`,
  String.raw`\b(?:omode|omo kekere|omo kekeke|omo odun)\b`,
  String.raw`\b(?:yaro|yarinya|yara|kananan yara|karamar yarinya|karamin yaro)\b`,
  String.raw`\b(?:nwata|umuaka|nwatakiri|nwa agbogho nta)\b`,
];

const SEXUAL = [
  String.raw`\b(?:sex|sexual|sexually|sexy|nude|nudes|naked|porn|porno|pornographic|pornography|erotic|erotica|`
    + String.raw`explicit|lewd|nsfw|xxx|intercourse|orgasm|masturbat\w*|fuck\w*|horny|aroused|seduc\w*|`
    + String.raw`fondl\w*|undress\w*|strip(?:ping|tease)?|blow ?jobs?|oral sex|make love|making love|sleep with|`
    + String.raw`hook ?up with)\b`,
  String.raw`\b(?:knack|knacking|toto|preck|ibalopo|ibasun|jima'?i|lalata|mmeko|mmekọ|ndina)\b`,
];

const PROTECTIVE = [
  String.raw`\b(?:protect\w*|prevent\w*|report\w*|signs? of|abuse[ds]?|abuser|abusing|molest\w*|rape[ds]?|`
    + String.raw`victim|survivor|groom(?:ing|ed)|safeguard\w*|naptip|police|lawyer|law|laws|illegal|crime|`
    + String.raw`punish\w*|court|convicted|sentenced|therapy|therapist|counsel\w*|doctor|clinic|hospital)\b`,
  String.raw`\b(?:educat\w*|sex ed|sex education|curriculum|puberty|period|periods|menstruat\w*|pregnan\w*|`
    + String.raw`contracepti\w*|condoms?|sti|stis|std|stds|hiv|consent|health|healthy|is it normal|is it safe|`
    + String.raw`body changes?|talk to my (?:child|son|daughter|kid|kids)|explain to my|how do i (?:know|tell|talk))\b`,
  String.raw`\b(?:what should i do|what do i do|help my (?:child|son|daughter)|`
    + String.raw`my (?:child|son|daughter) (?:was|is|told))\b`,
  String.raw`\b(?:asked me about|explain\w*|block\w*|filter\w*|parental|safe ?search|monitor\w*|`
    + String.raw`keep (?:them|him|her) safe)\b`,
];
// Strong protective cues: even "sites"/"content" with a child and porn is a parent's question (blocking, filters).
const SHIELD = [String.raw`\b(?:block\w*|filter\w*|parental|safe ?search|protect\w*|report\w*|prevent\w*|monitor\w*|`
  + String.raw`keep (?:them|him|her|my \w+) (?:safe|away)|stop (?:them|him|her|my \w+) from)\b`];

module.exports = {
  category: 'csam',
  rules: [
    // Asking for sexual material, stories or role-play about a child: refused even with other framing.
    { id: 'minor_sexual_generate', all: [MINOR, SEXUAL, GENERATE], window: 120, unless: SHIELD,
      unlessAction: 'allow_with_care', unlessCare: 'child_protection', action: 'refuse' },
    // Child + sexual words together: refused unless clearly protective/educational/health (then: with care).
    { id: 'minor_sexual', all: [MINOR, SEXUAL], window: 80, unless: PROTECTIVE, unlessAction: 'allow_with_care',
      unlessCare: 'child_protection', action: 'refuse' },
    // Known CSAM terms on their own.
    { id: 'csam_terms', all: [[String.raw`\b(?:child porn\w*|kiddie porn|csam|cp links?|pedo(?:phile)? (?:pics|videos|`
      + String.raw`links|content)|preteen (?:pics|videos|nudes)|loli(?:con)? (?:hentai|porn|nudes))\b`]],
    unless: [String.raw`\b(?:report\w*|detect\w*|prevent\w*|law|laws|illegal|news|police|naptip|filter\w*|block\w*)\b`],
    unlessAction: 'allow_with_care', unlessCare: 'child_protection', action: 'refuse' },
  ],
  // Model output: a stream that pairs minors with explicit sexual wording is stopped straight away.
  output: [
    { id: 'out_minor_sexual', all: [MINOR, [String.raw`\b(?:naked|nude|erotic|orgasm|aroused|horny|undress\w*|`
      + String.raw`fondl\w*|moan\w*|thrust\w*|genitals?|penis|vagina|breasts?|nipples?)\b`]], window: 100,
    unless: PROTECTIVE, action: 'refuse' },
  ],
  MINOR, SEXUAL, PROTECTIVE,
};
