// Illegal drugs: refused when someone asks how to make, cook, extract or mix them (including Nigerian street
// mixes such as "mkpuru mmiri", "skuchies", "gutter water" and "colorado"). Effects, risks, addiction, quitting,
// treatment, drug tests, NDLEA news and pharmacology questions are left alone.
const { INSTRUCT, NEWS } = require('./common');

const DRUG = [
  String.raw`\b(?:meth|methamphetamines?|crystal meth|mkpuru mmiri|shabu|crack cocaine|crack rocks?|cocaine|heroin|`
    + String.raw`fentanyl|carfentanil|lsd|acid tabs|mdma|ecstasy(?: pills)?|ghb|pcp|angel dust|dmt|ketamine|`
    + String.raw`krokodil|desomorphine|nitazenes?|tapentadol|mephedrone)\b`,
  String.raw`\b(?:skuchies|scuchies|gutter water|monkey tail|monkey-tail|codeine (?:syrup )?mix|lean (?:drink|syrup)|`
    + String.raw`purple drank|sizzurp|zombie drug)\b`,
  // Yorùbá "oogun olóró" (hard drugs); Hausa "kwaya" (pills), "tabar wiwi"; Igbo "ọgwụ ike" (hard drugs)
  String.raw`\b(?:oogun oloro|egbo igbo|kwaya|tabar wiwi|ogwu ike)\b`,
];

const PRECURSOR = [
  String.raw`\b(?:pseudoephedrine|ephedrine|p2p|phenyl-?2-?propanone|phenylacetone|methylamine|safrole|`
    + String.raw`red phosphorus|lithium strips|anhydrous ammonia|ergotamine|lysergic|gbl|piperidone|anpp|4-anpp|`
    + String.raw`coca leaves|coca paste|benzylfentanyl)\b`,
];

// "cook meth", "mix … to get high": the verb and the drug in one phrase.
const COOK = [
  String.raw`\b(?:cook|cooking|synthesi[sz]e|synthesis of|extract|extraction of|refine|purify|isolate) (?:\w+ ){0,2}`
    + String.raw`(?:meth|crack|cocaine|heroin|fentanyl|lsd|mdma|dmt|ghb|mkpuru mmiri|colorado|skuchies)\b`,
  String.raw`\b(?:mix|combine) (?:\w+ ){0,4}(?:to (?:get|make|feel) (?:high|colorado|skuchies|lean|gutter water)|`
    + String.raw`for (?:a |the )?high)\b`,
];

const BENIGN = [
  ...NEWS,
  String.raw`\b(?:effects?|side effects?|dangers?|risks?|harm(?:s|ful)?|addict\w*|quit\w*|stop using|recover\w*|`
    + String.raw`rehab\w*|treatment|withdrawal|overdose (?:signs|symptoms|help|treatment)|detox|ndlea|drug tests?|`
    + String.raw`detect\w*|test positive|legal status|law|laws|illegal in|policy|awareness|campaign|prevention|`
    + String.raw`counsel\w*|breaking bad|pharmacolog\w*|mechanism of action|how does .{0,20} work)\b`,
  String.raw`\b(?:coke (?:zero|can|bottle|and)|coca[- ]cola|cook (?:rice|beans|jollof|stew|soup|egusi|yam)|`
    + String.raw`acid (?:reflux|rain|base)|coal|coking|blast furnace)\b`,
];

module.exports = {
  category: 'drugs',
  rules: [
    { id: 'drug_synthesis', all: [INSTRUCT, DRUG], window: 120, unless: BENIGN, action: 'refuse' },
    { id: 'drug_cook', all: [COOK], unless: BENIGN, action: 'refuse' },
    { id: 'drug_precursor', all: [PRECURSOR, [String.raw`\b(?:convert|turn|make|cook|reduce|reduction|`
      + String.raw`synthesi[sz]e|extract|into|from)\b`]], window: 100, unless: BENIGN, action: 'refuse' },
  ],
  // Model output: a synthesis route (precursor + reagent/procedure wording close together).
  output: [
    { id: 'out_drug_synthesis', all: [PRECURSOR, [String.raw`\b(?:reflux|reduction|reduce|distil\w*|`
      + String.raw`hydrochloric|hydroiodic|iodine|lye|sodium hydroxide|solvent|toluene|ether|\d+ ?(?:g|grams?|ml|`
      + String.raw`mg|°c|degrees)|step \d)\b`]], window: 200, unless: BENIGN, action: 'refuse' },
  ],
};
