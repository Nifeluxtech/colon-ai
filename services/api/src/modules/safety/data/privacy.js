// Personal data exposure. Refused: finding, tracking or exposing another person (home address, phone number,
// BVN/NIN, bank details, location; "doxxing"; spying on a partner's phone). With care: a parent asking about a
// child's phone, and users pasting their OWN secrets (card number, BVN, OTP, PIN, password): Colon tells them not
// to share those and the secret itself is masked before the message goes to an AI provider (redact.js).

const TARGET = String.raw`(?:my ex|my (?:ex-)?(?:wife|husband|girlfriend|boyfriend|partner|crush|neighbou?r|boss|`
  + String.raw`landlord|colleague)|this (?:guy|girl|man|woman|person|user|account|lady|babe|number)|that (?:guy|girl|`
  + String.raw`man|woman|person)|a stranger|a (?:girl|guy|man|woman|lady) i (?:met|saw|like)|`
  + String.raw`(?:\w+ ){0,2}(?:on|from) (?:twitter|x|instagram|ig|tiktok|facebook|snapchat|whatsapp|linkedin))`;

const PII = String.raw`(?:home address|house address|address|residen\w* address|location|exact location|`
  + String.raw`phone number|phone numbers|whatsapp number|number|bvn|nin|bank details|account number|`
  + String.raw`account details|date of birth|real name|identity|where (?:he|she|they) (?:lives?|stays?|works?))`;

const SEEK = [
  String.raw`\b(?:find|get|give me|tell me|look ?up|track|trace|locate|search for|dig up|reveal|leak|expose|`
    + String.raw`fetch|pull up|check)(?: out)?(?: \w+){0,2} ${PII} (?:of|for|belonging to) ${TARGET}\b`,
  String.raw`\b(?:find|get|track|trace|locate|reveal|leak|expose|dig up) ${TARGET}'?s? ${PII}\b`,
  String.raw`\b(?:dox|doxx|doxxing|doxing) (?:\w+ ){0,2}(?:someone|him|her|them|this|that|my|a)\b`,
  String.raw`\b(?:track|trace|monitor|spy on|hack|read|see|check) (?:my )?(?:wife|husband|girlfriend|boyfriend|`
    + String.raw`partner|ex|spouse|someone|somebody)'?s? (?:\w+ ){0,1}(?:phone|location|whatsapp|messages|chats|calls|`
    + String.raw`dms|texts|instagram|facebook)(?: without)?\b`,
  String.raw`\bspy on (?:my )?(?:wife|husband|girlfriend|boyfriend|partner|ex|spouse|someone|somebody|neighbou?r)\b`,
  String.raw`\b(?:whose|who owns (?:this|the)) (?:bvn|nin|phone number|number|account number) is\b`,
  String.raw`\b(?:bvn|nin) (?:lookup|search|check) (?:of|for|on) (?:\w+ ){0,1}(?:someone|another|my ex|this|a)\b`,
];

const BENIGN = [
  String.raw`\b(?:my (?:own|lost|stolen|missing) (?:phone|device|account)|find my (?:phone|device|iphone|android)|`
    + String.raw`protect (?:my|our) (?:privacy|data)|privacy settings|how to (?:stop|prevent|avoid) (?:being )?`
    + String.raw`(?:tracked|doxx?ed|spied)|i (?:am|was|got|think i'?m) (?:being )?(?:tracked|doxx?ed|stalked|spied)|`
    + String.raw`nimc office|office address|company address|business address|embassy|hospital|school address|`
    + String.raw`customer care number|helpline|official (?:number|address|website))\b`,
];

const CHILD = [String.raw`\b(?:track|monitor|check) (?:my )?(?:child|son|daughter|kid|kids|children)'?s? `
  + String.raw`(?:\w+ ){0,1}(?:phone|location|whatsapp|messages|online|screen time|activity)\b`];

// The user's own secrets pasted into chat (they are masked before reaching the provider: redact.js).
const OWN_SECRET = [
  String.raw`\b(?:my )?(?:bvn|nin)(?: number)?(?: is| na|:|=)? ?\d{11}\b`,
  String.raw`\b(?:my )?(?:otp|one[- ]time (?:password|code)|token|verification code)(?: is| na|:|=) ?\d{4,8}\b`,
  String.raw`\b(?:my )?(?:atm |card |transfer |bank )?pin(?: is| na|:|=) ?\d{4,6}\b`,
  String.raw`\b(?:my )?(?:password|passcode|pass word)(?: is| na|:|=) ?\S{4,}`,
  String.raw`\b(?:my )?(?:cvv|cvc)(?: is| na|:|=)? ?\d{3,4}\b`,
];

module.exports = {
  category: 'privacy',
  rules: [
    { id: 'pii_seek', all: [SEEK], unless: BENIGN, action: 'refuse' },
    { id: 'child_monitoring', all: [CHILD], action: 'allow_with_care', care: 'child_monitoring' },
    { id: 'own_secret', all: [OWN_SECRET], action: 'allow_with_care', care: 'own_data' },
  ],
  output: [],
};
