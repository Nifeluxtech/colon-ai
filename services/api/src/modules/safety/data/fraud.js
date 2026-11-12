// Fraud and scams, with the Nigerian patterns first: "Yahoo-yahoo" and its "formats" (dating, billing, client,
// military, inheritance scripts), catching a "maga"/"mugu", fake bank alerts and POS receipts, card cloning, SIM
// swaps, and phishing for BVN, NIN, OTP, PIN or card details. Refused when someone asks to do it.
// Victims and the careful get help instead (care.js "fraud_safety"): spotting scams, someone asking for an OTP,
// "I was scammed", awareness training, what the slang means.

const SCAM = [
  String.raw`\b(?:yahoo ?yahoo|yahoo (?:boy|boys|plus|format|formats|work|business|hustle|client|jazz)|yahoo\+|`
    + String.raw`g-?boy (?:format|work)|hustle format|oke ite)\b`,
  String.raw`\b(?:dating|billing|client|hook-?up|military|inheritance|crypto|bitcoin|gift ?card|lottery|romance|`
    + String.raw`sugar mummy|sugar daddy|yahoo) formats?\b`,
  String.raw`\bformats? (?:for|to) (?:billing|bill|catch|pick|scam|chop)\b`,
  String.raw`\b(?:catch|pick|land|hook|bill|billing|scam|chop) (?:a |my |one |the |dis |this )?(?:maga|mugu|mgbada|`
    + String.raw`white client|oyinbo client|foreign client)\b`,
  String.raw`\b(?:419 (?:letter|email|mail|script)|advance[- ]fee (?:letter|email|scam)|romance scam\w*|`
    + String.raw`pig butchering|ponzi scheme script)\b`,
];

const ASK = [
  String.raw`\b(?:how (?:do|can|will|would) i|how to|how i fit|how i go|teach me|show me|give me|send me|i need|`
    + String.raw`i want|abeg (?:give|send|show)|write|draft|create|make|help me|best|latest|new|working)\b`,
];

const TOOL = [
  String.raw`\b(?:write|draft|create|compose|make|design|build|code|set up|clone)(?: me)?(?: an?| some| the)?`
    + String.raw`(?: \w+){0,3} (?:phishing|scam|fake (?:bank|alert|debit|credit|transfer|login)|spoof(?:ed)?|`
    + String.raw`fraudulent)(?: \w+){0,1} (?:emails?|sms|texts?|messages?|sites?|website|page|link|alerts?|receipts?|`
    + String.raw`app|login page)\b`,
  String.raw`\bfake (?:bank |credit |debit |transfer )?alert (?:app|apps|software|generator|maker|apk)\b`,
  String.raw`\bfake (?:pos|transfer|payment|bank) (?:receipt|slip|screenshot|proof)\b`,
  String.raw`\b(?:clone|cloning|skim|skimming|duplicate) (?:a |an |someone'?s )?(?:atm |debit |credit |bank )?cards?\b`,
  String.raw`\bcarding (?:method|tutorial|bins?|guide)\b`,
  String.raw`\b(?:bypass|skip|intercept|steal) (?:\w+ ){0,2}(?:otp|2fa|token|verification code)\b`,
  String.raw`\b(?:get|collect|obtain|steal|harvest|phish|access) (?:\w+ ){0,2}(?:people'?s?|someone'?s?|somebody'?s?|`
    + String.raw`their|his|her|customers'?|victims?'?|users'?|others'?|other people'?s?|strangers'?) (?:\w+ ){0,2}`
    + String.raw`(?:bvn|otp|nin|atm pin|card pin|pin|cvv|card details|bank details|login details|password)s?\b`,
  String.raw`\b(?:trick|convince|deceive|make|lure) (?:\w+ ){0,3}(?:into|to) (?:giving|give|sharing|share|send|`
    + String.raw`sending|reveal|revealing) (?:\w+ ){0,3}(?:bvn|otp|nin|atm pin|card pin|pin|cvv|card details|`
    + String.raw`bank details|login details|password)s?\b`,
  String.raw`\bsim[- ]?swap (?:someone|my \w+'?s?|his|her|a|their|another)\b`,
  String.raw`\bhack (?:into )?(?:someone'?s?|somebody'?s?|my (?:ex|wife|husband|girlfriend|boyfriend|partner|boss)'?s?|`
    + String.raw`his|her|their|a|another person'?s?)(?: \w+){0,2} (?:account|whatsapp|facebook|instagram|tiktok|`
    + String.raw`bank|email|gmail|phone|opay|palmpay|moniepoint)\b`,
  String.raw`\b(?:impersonat\w*|pose as|pretend to be) (?:a |an |the )?(?:bank|cbn|efcc|police|customer care|`
    + String.raw`staff|official|soldier|army officer|un official)\b`,
];

const PROTECT = [
  String.raw`\bhow (?:do i|can i|to|do we|can we|do people) (?:avoid|protect|spot|identify|recogni[sz]e|detect|`
    + String.raw`report|know if|tell if|prevent|stay safe)\b`,
  String.raw`\b(?:is|was) (?:this|it|that) (?:a |an )?(?:scam|fraud|legit|real|fake|phishing)\b`,
  String.raw`\bi (?:was|got|have been|don|just got|think i was) (?:scammed|defrauded|duped|hacked|swindled|`
    + String.raw`chop scam|fall mugu|robbed|sim swapped)\b`,
  String.raw`\b(?:someone|somebody|a man|a woman|they|he|she|caller|bank) (?:\w+ ){0,2}(?:asked|is asking|called|`
    + String.raw`sent|wants|requested|requesting|dey ask)\b`,
  String.raw`\b(?:awareness|warn\w*|training|teach (?:my|our) (?:staff|parents|customers|students|team)|efcc|`
    + String.raw`victims?|recover\w*|reverse\w*|refund|what (?:is|does|are) (?:\w+ ){0,3}(?:mean|yahoo)|`
    + String.raw`meaning of|why do (?:people|boys)|history of|news|article|research|essay|red flags)\b`,
];

module.exports = {
  category: 'fraud',
  rules: [
    { id: 'scam_scheme', all: [ASK, SCAM], window: 120, unless: PROTECT, unlessAction: 'allow_with_care',
      unlessCare: 'fraud_safety', action: 'refuse' },
    { id: 'scam_tool', all: [TOOL], unless: PROTECT, unlessAction: 'allow_with_care', unlessCare: 'fraud_safety',
      action: 'refuse' },
    // A likely victim: someone asked for their OTP/BVN/PIN, or they were scammed. Answer with safety steps.
    { id: 'fraud_victim', all: [[String.raw`\b(?:asked|asking|ask|wants?|requested|requesting|called|calling|`
      + String.raw`sent|dey ask)(?: \w+){0,5} (?:my |your |the )?(?:bvn|otp|nin|pin|password|card details|cvv|`
      + String.raw`bank details|code)\b`, String.raw`\bi (?:was|got|have been|don|just got|think i was) (?:scammed|`
      + String.raw`defrauded|duped|hacked|swindled|chop scam|fall mugu|sim swapped)\b`]],
    action: 'allow_with_care', care: 'fraud_safety' },
  ],
  output: [],
};
