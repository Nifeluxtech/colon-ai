// Sexual content: explicit material is refused for guests (signed-out visitors may be minors; Colon has no age
// check). Signed-in adults get a non-graphic answer (care.js). Admin › Safety can change both per audience.
// Sex education, contraception, STIs, consent, relationships and romance without explicit detail are left alone.
// Anything sexual that involves a child is the csam category, always refused.

const EXPLICIT = [
  String.raw`\b(?:write|tell|create|generate|describe|narrate|roleplay|role-play|role play|continue|give me|send me|`
    + String.raw`make)(?: me)?(?: an?| some| the)?(?: \w+){0,3} (?:erotic|sex|sexual|explicit|porn|porno|smutty|smut|`
    + String.raw`dirty|nsfw|steamy|xxx|lewd|raunchy|x-rated|hardcore)(?: \w+){0,2} (?:story|stories|scene|scenes|`
    + String.raw`fanfic|fan fiction|fiction|chat|roleplay|role-play|texts?|messages?|poems?|fantasy|fantasies|`
    + String.raw`content|novel|chapter|script|letter)\b`,
  String.raw`\b(?:sext|sexting) (?:me|with me)\b`, String.raw`\btalk dirty(?: to me)?\b`,
  String.raw`\bsend (?:me )?(?:your )?nudes\b`,
  String.raw`\b(?:porn|porno|xxx|nsfw|onlyfans leaks?) (?:sites?|links?|videos?|pics?|pictures|movies?|accounts?)\b`,
  String.raw`\b(?:where (?:can|do) i (?:watch|find|download)|recommend|best|free) (?:\w+ ){0,2}(?:porn|porno|xxx)\b`,
  String.raw`\bdescribe (?:\w+ ){0,3}(?:sex|intercourse|oral sex|orgasm|their bodies) in (?:graphic |explicit |vivid |`
    + String.raw`full |great )?detail\b`,
  String.raw`\b(?:pretend|act|be) (?:to be |like |as )?my (?:girlfriend|boyfriend|wife|husband|lover|baby|babe) `
    + String.raw`(?:\w+ ){0,4}(?:sex|naked|nude|horny|bed|undress)\b`,
  // Pidgin "make we knack", Yorùbá "ìbálòpọ̀", Hausa "jima'i", Igbo "mmekọ" with a request to write/describe
  String.raw`\b(?:make we knack|knack me|i wan knack|abeg (?:write|tell) (?:\w+ ){0,3}knack)\b`,
  String.raw`\b(?:ko|so|se apejuwe) (?:\w+ ){0,4}(?:ibalopo|ibasun)\b`,
  String.raw`\b(?:ibalopo|ibasun) (?:\w+ ){0,3}itan\b`,
  String.raw`\b(?:rubuta|bayyana) (?:\w+ ){0,4}(?:jima'?i|batsa)\b`,
  String.raw`\b(?:hotunan|bidiyon|fina-finan) batsa\b`,
  String.raw`\b(?:dee|kowa) (?:\w+ ){0,4}(?:mmeko|mmeko nwoke na nwanyi|ihe gbasara mmeko)\b`,
];

const BENIGN = [
  String.raw`\b(?:sex ed|sex education|educat\w*|health|healthy|doctor|clinic|contracepti\w*|condoms?|family planning|`
    + String.raw`sti|stis|std|stds|hiv|pregnan\w*|consent|puberty|anatomy|biology|is it normal|safe sex|`
    + String.raw`relationship advice|marriage counsel\w*|therapy|therapist|addiction|block\w*|filter\w*|`
    + String.raw`quit\w*|stop)\b`,
];

module.exports = {
  category: 'sexual',
  rules: [
    { id: 'sexual_explicit', all: [EXPLICIT], unless: BENIGN, action: 'refuse', care: 'adult_sexual' },
  ],
  output: [],
};
