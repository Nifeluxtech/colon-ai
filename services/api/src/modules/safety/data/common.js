// Shared cue lists for the safety rules, in English, Nigerian Pidgin, Yorùbá, Hausa and Igbo.
// Write natural spelling: the engine folds patterns and messages the same way (tone marks and subdots dropped,
// lower case), so "ọ̀nà" and "ona" both match. Each entry is a regular-expression fragment.
// The Yorùbá, Hausa and Igbo phrasing is a starting list: have native speakers review it (ADR 0003, open items).

// "Tell me how to make/do X": the request for instructions that turns a topic into a how-to.
const INSTRUCT = [
  String.raw`how (?:do|can|would|should|could|will|might) (?:i|we|you|one|someone|somebody|a person) (?:\w+ ){0,2}`
    + String.raw`(?:make|build|create|produce|cook|manufacture|assemble|prepare|synthesi[sz]e|mix|brew|extract|`
    + String.raw`wire|detonate|construct|craft|fabricate)`,
  String.raw`how to (?:\w+ ){0,1}(?:make|build|create|produce|cook|manufacture|assemble|prepare|synthesi[sz]e|`
    + String.raw`mix|brew|extract|wire|detonate|construct|craft|fabricate)`,
  String.raw`(?:steps?|step[- ]by[- ]step|instructions?|tutorial|guide|recipe|formula|procedure|blueprint|`
    + String.raw`ingredients?|materials? needed|chemicals? needed) (?:to|for|on|of)`,
  String.raw`(?:teach|show|tell) me how`,
  String.raw`give me (?:the |a )?(?:steps|recipe|formula|instructions|procedure|method)`,
  String.raw`(?:make|build|cook|synthesi[sz]e|manufacture|brew|produce) (?:a |an |some |me |my own |homemade )`,
  String.raw`i (?:want|need|wan|plan) (?:to )?(?:make|build|cook|produce|brew)`,
  // Pidgin
  String.raw`how (?:i|we|person|man|pesin) (?:fit|go|wan|dey|take) (?:\w+ ){0,2}(?:make|build|cook|do|mix|produce)`,
  String.raw`abeg (?:show|teach|tell|give) me (?:how|the way|wetin)`,
  String.raw`wetin (?:i|person|we) (?:go|fit|dey) (?:use|mix|need) (?:take )?(?:make|cook|build)`,
  // Yorùbá: "bawo ni mo ṣe le ṣe…", "kọ́ mi bí a ṣe ń…", "ọ̀nà tí mo lè fi ṣe…"
  String.raw`bawo ni (?:mo|a|eniyan|eeyan|mo ti) (?:se|ti) (?:le|n|maa) (?:se|ko|po|da)`,
  String.raw`ko mi (?:bi|bawo) (?:a|mo|won) (?:se|ti) (?:n|le|maa)`,
  String.raw`ona ti (?:mo|a|eniyan) (?:le|fi) (?:fi )?(?:se|ko|po)`,
  // Hausa: "yaya zan yi…", "koya min yadda ake…", "ta yaya zan haɗa…"
  String.raw`(?:ta )?yaya (?:zan|za a|zamu|ake|zan iya) (?:yi|hada|kera|sarrafa)`,
  String.raw`koya (?:min|mani|mana) yadda (?:zan|ake|za a)`,
  // Igbo: "kedu ka m ga-esi mee…", "kụziere m otú e si eme…"
  String.raw`kedu (?:ka|otu) (?:m|esi|e si|anyi|mmadu) (?:ga-esi|ga esi|si|ga) (?:mee|eme|kpu|kwado|gwakota)`,
  String.raw`kuziere (?:m|anyi) (?:otu|ka) (?:esi|e si|m ga-esi|m ga esi) (?:eme|mee|akpu|kpu)`,
];

// Asking for something to be written, shown or found (used for sexual content and scams).
const GENERATE = [
  String.raw`\b(?:write|story|stories|roleplay|role-play|role play|describe|narrate|fanfic|fantasy|imagine|pretend|`
    + String.raw`pictures?|pics?|photos?|images?|videos?|clips?|send|generate|draw|links?|sites?|content|chat as|`
    + String.raw`continue the|scene|poem|caption)\b`,
  String.raw`where (?:can|do|to) (?:i |we )?(?:find|get|download|watch|buy)`,
  String.raw`\b(?:ko|kọ) (?:itan|oro)\b`, String.raw`\brubuta\b`, String.raw`\bdee\b`,
];

// News, history, study and research framing: a question about a harm, not a request to commit it.
const NEWS = [
  String.raw`\b(?:news|history|historical|happened|reported|report on|headline|article|journalis\w*|documentary|`
    + String.raw`court|trial|convicted|sentenced|arrested|charged|investigat\w*|police said|according to)\b`,
  String.raw`\b(?:who (?:was|were) (?:behind|responsible)|what (?:happened|caused)|why did|when did)\b`,
  String.raw`\b(?:essay|research|thesis|project work|assignment|lecture|textbook|exam question|waec|neco|jamb)\b`,
];

module.exports = { INSTRUCT, GENERATE, NEWS };
