// Violence, weapons and explosives: refused when someone asks HOW to make a weapon or explosive, or how to hurt,
// kidnap or poison a person. Questions about news, history, safety ("what to do if you hear gunshots"), how
// something works in general, and Nigerian slang ("bath bomb", "don't bomb your WAEC") are left alone.
const { INSTRUCT, NEWS } = require('./common');

const WEAPON = [
  String.raw`\b(?:bombs?|pipe ?bombs?|car bombs?|nail bombs?|ieds?|improvised explosive\w*|explosives?|molotovs?|`
    + String.raw`molotov cocktails?|petrol bombs?|grenades?|detonators?|blasting caps?|napalm|tatp|acetone peroxide|`
    + String.raw`hmtd|nitroglycerin\w*|semtex|c-?4|dynamite|landmines?|suicide vests?|thermite|gunpowder|`
    + String.raw`black powder)\b`,
  String.raw`\b(?:silencers?|suppressors?|ghost guns?|3d[- ]?printed (?:guns?|pistols?|rifles?)|zip guns?)\b`,
  String.raw`\b(?:local|dane|homemade|home-made|improvised|locally made|untraceable) (?:guns?|pistols?|rifles?|`
    + String.raw`shotguns?|firearms?)\b`,
  String.raw`\b(?:make|build|craft|fabricate|produce|manufacture) (?:a |an |my own |our own )?(?:guns?|pistols?|`
    + String.raw`rifles?|firearms?|ammunition|ammo|bullets)\b`,
  String.raw`\b(?:sarin|vx|nerve (?:agent|gas)|ricin|anthrax|mustard gas|chlorine gas|bioweapons?|`
    + String.raw`chemical weapons?|dirty bombs?)\b`,
  // Yorùbá "ado oloro" (explosive), "ibọn" (gun); Hausa "bam", "nakiya" (explosive), "bindiga" (gun);
  // Igbo "bọmbụ" (bomb)
  String.raw`\b(?:ado oloro|bombu|ibon ibile|ibon)\b`,
  String.raw`\b(?:bam|nakiya|bindiga|bindigar gargajiya)\b`,
];

const HARM = [
  String.raw`\b(?:how (?:do|can|would|should) i|how to|help me|ways? to|best way to|teach me (?:how )?to|`
    + String.raw`how i (?:fit|go|wan))(?: \w+){0,2} (?:kill|murder|poison|stab|strangle|kidnap|abduct|maim|shoot|`
    + String.raw`behead|burn|acid attack|throw acid on|torture|beat up|attack) (?:someone|somebody|a person|people|`
    + String.raw`him|her|them|my (?:\w+ ){0,1}(?:wife|husband|boss|neighbou?r|ex|father|mother|brother|sister|`
    + String.raw`friend|teacher|landlord|rival|colleague|stepmother|stepfather|in-law|girlfriend|boyfriend)|a (?:child|`
    + String.raw`man|woman|girl|boy)|(?:a|the) (?:president|governor|senator|pastor|imam|chairman))\b`,
  String.raw`\b(?:kill|murder|poison) (?:\w+ ){0,3}without (?:getting caught|being caught|anyone knowing|`
    + String.raw`leaving (?:a )?trace)\b`,
  String.raw`\b(?:untraceable|undetectable) poisons?\b`,
  String.raw`\bhow (?:to|do i|can i) (?:plan|carry out|organi[sz]e) (?:a |an )?(?:kidnap\w*|attack|shooting|`
    + String.raw`bombing|massacre|terror\w*)\b`,
];

const BENIGN = [
  ...NEWS,
  String.raw`\b(?:bath ?bombs?|seed bombs?|photo ?bomb\w*|bomb (?:pop|cake|shots?|dessert)|the bomb|da bomb|`
    + String.raw`love ?bomb\w*|f-?bombs?|bomb (?:the |my |an? |this |that )?(?:exam|test|interview|waec|neco|jamb|`
    + String.raw`presentation|audition|paper|course|quiz))\b`,
  String.raw`\b(?:defus\w*|dispos\w*|detect\w*|safety|protect\w*|surviv\w*|what to do if|in case of|evacuat\w*|`
    + String.raw`report\w*|first aid|treat\w*|warning signs|prevent\w*|counter[- ]?terror\w*)\b`,
  String.raw`\b(?:minecraft|fortnite|call of duty|free fire|pubg|game|gaming|movie|film|novel|anime|marvel|`
    + String.raw`water ?gun|nerf|toy gun|glue gun|nail gun|spray gun|heat gun|staple gun|airsoft|paintball)\b`,
];

module.exports = {
  category: 'violence',
  rules: [
    { id: 'weapon_howto', all: [INSTRUCT, WEAPON], window: 120, unless: BENIGN, action: 'refuse' },
    { id: 'harm_person', all: [HARM], unless: [String.raw`\b(?:protect\w*|prevent\w*|stop (?:someone|him|her|them)|`
      + String.raw`defend|self[- ]defen[cs]e|what to do if|signs? (?:of|that)|survive|escape|report|game|novel|`
      + String.raw`movie|film|characters?)\b`], action: 'refuse' },
  ],
  // Model output: an explosive or weapon recipe (two or more precursors with quantities or procedure words).
  output: [
    { id: 'out_explosive_recipe', all: [
      [String.raw`\b(?:ammonium nitrate|potassium (?:nitrate|chlorate|perchlorate)|hydrogen peroxide|nitric acid|`
        + String.raw`acetone peroxide|tatp|hmtd|nitroglycerin)\b`],
      [String.raw`\b(?:fuel oil|diesel|aluminium powder|aluminum powder|sugar|sulfur|sulphur|charcoal|acetone|`
        + String.raw`hexamine|glycerin\w*|sulfuric acid|detonators?|blasting caps?|fuses?|shrapnel|nails)\b`],
      [String.raw`\b(?:\d+ ?(?:g|grams?|kg|ml|litres?|liters?|parts?|%)|\d+ ?: ?\d+|step \d|combine|pack (?:it|the)|`
        + String.raw`ignite|detonate|stir|crystals?)\b`],
    ], window: 220, unless: [String.raw`\b(?:fertili[sz]er (?:use|application)|safety data|never mix|do not mix|`
      + String.raw`dangerous to mix)\b`], action: 'refuse' },
  ],
};
