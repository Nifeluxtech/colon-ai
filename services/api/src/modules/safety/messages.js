// What Colon says when the safety layer steps in, in the user's language (en, pcm, yo, ha, ig).
// Translations are short and plain on purpose; have native speakers review them (ADR 0003, open items).
//
// Nigerian helplines (checked 2026-11-13):
//   - SURPIN (Suicide Research and Prevention Initiative, LUTH): toll-free 0800 078 7746, 24 hours.
//     Source: https://www.surpinng.com/ ("Hotlines": +234-8000787746) and
//     https://lifeline-international.com/member/nigeria-surpin/ ("+234 (0) 8000787746 (Toll Free) 24 hours").
//   - Lagos Lifeline (Lagos State Ministry of Health), open to callers outside Lagos: 0700 000 6463 (0700 000 MIND).
//     Source: https://web1.lagosstate.gov.ng/news/Health%20Services/view/6722bfa71415802f26321399 (12 Oct 2024).
//   - MANI (Mentally Aware Nigeria Initiative): 0809 111 6264.
//     Source: https://mentallyaware.org/resource-centre/ ("For urgent medical attention please call 08091116264").
//   - National emergency number: 112.
// Re-check these numbers at least once a year (docs/decisions/0003-safety-layer.md).
const HELPLINES = [
  '- Emergency: **112**',
  '- SURPIN suicide prevention (free, 24 hours): **0800 078 7746**',
  '- Lagos Lifeline (24 hours, from anywhere in Nigeria): **0700 000 6463**',
  '- Mentally Aware Nigeria Initiative (MANI): **0809 111 6264**',
].join('\n');

const SUPPORT = {
  en: 'You don’t have to carry this alone. If you are thinking about ending your life or hurting yourself, '
    + 'please talk to someone right now:',
  pcm: 'You no need carry this one alone. If you dey think to end your life or hurt yourself, abeg yarn with '
    + 'person now now:',
  yo: 'O ò dá wà nínú èyí. Tí o bá ń ronú láti pa ara rẹ tàbí ṣe ara rẹ léṣe, jọ̀wọ́ bá ẹnìkan sọ̀rọ̀ báyìí:',
  ha: 'Ba kai kaɗai ba ne. Idan kana tunanin kashe kanka ko cutar da kanka, don Allah ka yi magana da wani yanzu:',
  ig: 'Ọ bụghị naanị gị nọ n’ihe a. Ọ bụrụ na ị na-eche ibu ndụ gị ma ọ bụ imerụ onwe gị ahụ, biko gwa mmadụ okwu '
    + 'ugbu a:',
};

const REFUSE = {
  csam: {
    en: 'I can’t help with that. Sexual content involving children is never allowed. If a child is in danger, '
      + 'call **112** or report to the police or NAPTIP.',
    pcm: 'I no fit help with dis one. Anything wey join pikin and sex no dey allowed at all. If pikin dey for danger, '
      + 'call **112** or report give police or NAPTIP.',
    yo: 'Mi ò lè ràn ọ́ lọ́wọ́ nínú èyí. Ohunkóhun tó jẹ mọ́ ìbálòpọ̀ pẹ̀lú ọmọdé kò gbà láé. Tí ọmọdé bá wà nínú '
      + 'ewu, pe **112** tàbí fi tó ọlọ́pàá tàbí NAPTIP létí.',
    ha: 'Ba zan iya taimakawa da wannan ba. Duk abin da ya shafi jima’i da yara ba a yarda da shi ba. Idan yaro '
      + 'yana cikin haɗari, kira **112** ko ka kai rahoto ga ’yan sanda ko NAPTIP.',
    ig: 'Enweghị m ike inyere gị aka n’ihe a. Ihe ọ bụla metụtara mmekọ nwoke na nwanyị na ụmụaka anaghị ekwe '
      + 'ma ọlị. Ọ bụrụ na nwata nọ n’ihe egwu, kpọọ **112** ma ọ bụ kọọrọ ndị uwe ojii ma ọ bụ NAPTIP.',
  },
  violence: {
    en: 'I can’t help with making weapons or explosives, or with hurting anyone. If someone is in danger, '
      + 'call **112**.',
    pcm: 'I no fit help you make weapon or bomb, or hurt anybody. If person dey for danger, call **112**.',
    yo: 'Mi ò lè ràn ọ́ lọ́wọ́ láti ṣe ohun ìjà tàbí àdó olóró, tàbí láti ṣe ẹnikẹ́ni léṣe. Tí ẹnìkan bá wà nínú '
      + 'ewu, pe **112**.',
    ha: 'Ba zan iya taimaka maka wajen ƙera makami ko bam ba, ko cutar da wani ba. Idan wani yana cikin haɗari, '
      + 'kira **112**.',
    ig: 'Enweghị m ike inyere gị aka ịme ngwa agha ma ọ bụ bọmbụ, ma ọ bụ imerụ onye ọ bụla ahụ. Ọ bụrụ na mmadụ '
      + 'nọ n’ihe egwu, kpọọ **112**.',
  },
  drugs: {
    en: 'I can’t help with making or mixing illegal drugs. If drugs are affecting you or someone close to you, '
      + 'I can share information about help and treatment.',
    pcm: 'I no fit help you make or mix hard drugs. If drugs dey worry you or person wey you know, I fit tell you '
      + 'where una fit get help.',
    yo: 'Mi ò lè ràn ọ́ lọ́wọ́ láti ṣe tàbí po oògùn olóró. Tí oògùn bá ń da ìwọ tàbí ẹnìkan láàmú, mo lè sọ ibi '
      + 'tí ẹ ti lè rí ìrànlọ́wọ́.',
    ha: 'Ba zan iya taimakawa wajen haɗa ko yin miyagun ƙwayoyi ba. Idan ƙwayoyi suna damun ka ko wani naka, zan '
      + 'iya faɗa maka inda za a sami taimako.',
    ig: 'Enweghị m ike inyere gị aka ịme ma ọ bụ ịgwakọta ọgwụ ike. Ọ bụrụ na ọgwụ na-emetụta gị ma ọ bụ onye '
      + 'gị, enwere m ike ịgwa gị ebe unu ga-enweta enyemaka.',
  },
  hate: {
    en: 'I can’t help write something that attacks, threatens or harasses people. I’m happy to talk about the topic '
      + 'respectfully or help with something else.',
    pcm: 'I no fit help write tins wey dey attack, threaten or harass people. We fit yarn about am with respect, '
      + 'or I fit help you with another thing.',
    yo: 'Mi ò lè ràn ọ́ lọ́wọ́ láti kọ ohun tó ń kọlu, halẹ̀ mọ́, tàbí yọ àwọn ènìyàn lẹ́nu. Inú mi yóò dùn láti '
      + 'sọ̀rọ̀ nípa rẹ̀ pẹ̀lú ọ̀wọ̀, tàbí ràn ọ́ lọ́wọ́ nínú nǹkan mìíràn.',
    ha: 'Ba zan iya taimakawa wajen rubuta abin da ke kai hari, tsoratarwa ko cin zarafin mutane ba. Zan iya '
      + 'tattauna batun cikin girmamawa, ko in taimaka da wani abu.',
    ig: 'Enweghị m ike inyere gị aka ide ihe na-awakpo, na-eyi egwu ma ọ bụ na-esogbu ndị mmadụ. Anyị nwere ike '
      + 'ikwu maka ya n’ụzọ nsọpụrụ, ma ọ bụ m nyere gị aka n’ihe ọzọ.',
  },
  sexual: {
    en: 'I can’t write explicit sexual content here. I’m glad to help with relationships, sexual health or a '
      + 'romantic story that isn’t explicit.',
    pcm: 'I no fit write sex tori wey too open for here. I fit help with relationship matter, sexual health, or '
      + 'love story wey no too open.',
    yo: 'Mi ò lè kọ ohun ìbálòpọ̀ tó hàn gbangba níbí. Inú mi yóò dùn láti ràn ọ́ lọ́wọ́ nípa ìbáṣepọ̀, ìlera, '
      + 'tàbí ìtàn ìfẹ́ tí kò hàn gbangba.',
    ha: 'Ba zan iya rubuta abubuwan batsa a nan ba. Zan iya taimakawa game da soyayya, lafiyar jima’i, ko labarin '
      + 'soyayya mara batsa.',
    ig: 'Enweghị m ike ide ihe gbasara mmekọ nwoke na nwanyị n’ụzọ doro anya ebe a. Enwere m ike inyere gị aka '
      + 'gbasara mmekọrịta, ahụike, ma ọ bụ akụkọ ịhụnanya na-adịghị njọ.',
  },
  fraud: {
    en: 'I can’t help with scams, fraud or getting anyone’s BVN, OTP, PIN or passwords. If you think you’ve been '
      + 'targeted, I can help you secure your account and report it.',
    pcm: 'I no fit help with yahoo, scam or how to collect person BVN, OTP, PIN or password. If dem don try scam '
      + 'you, I fit help you secure your account and report am.',
    yo: 'Mi ò lè ràn ọ́ lọ́wọ́ nínú jìbìtì tàbí láti gba BVN, OTP, PIN tàbí ọ̀rọ̀ aṣínà ẹnikẹ́ni. Tí wọ́n bá ti '
      + 'gbìyànjú láti lù ọ́ ní jìbìtì, mo lè ràn ọ́ lọ́wọ́ láti dáàbò bo àkáǹtì rẹ kí o sì fi tó àwọn aláṣẹ létí.',
    ha: 'Ba zan iya taimakawa da zamba ko karɓar BVN, OTP, PIN ko kalmar sirri ta kowa ba. Idan an yi ƙoƙarin '
      + 'zambatar ka, zan iya taimaka maka ka kare asusunka ka kuma kai rahoto.',
    ig: 'Enweghị m ike inyere gị aka na wayo ma ọ bụ ịnara BVN, OTP, PIN ma ọ bụ paswọọdụ onye ọ bụla. Ọ bụrụ na '
      + 'mmadụ nwara ịgba gị wayo, enwere m ike inyere gị aka ichekwa akaụntụ gị ma kọọ ya.',
  },
  privacy: {
    en: 'I can’t help find, track or expose someone’s private information, such as their address, phone number, '
      + 'BVN or NIN, without their consent.',
    pcm: 'I no fit help find, track or expose person private tins like im address, phone number, BVN or NIN '
      + 'without im permission.',
    yo: 'Mi ò lè ràn ọ́ lọ́wọ́ láti wá, tọpinpin tàbí tú àṣírí ẹnìkan bí àdírẹ́sì, nọ́ńbà fóònù, BVN tàbí NIN '
      + 'láìsí àṣẹ wọn.',
    ha: 'Ba zan iya taimakawa wajen nemo, bin diddigi ko tona bayanan sirri na wani kamar adireshi, lambar waya, '
      + 'BVN ko NIN ba tare da izininsa ba.',
    ig: 'Enweghị m ike inyere gị aka ịchọta, ịchọgharị ma ọ bụ ikpughe ozi nzuzo mmadụ dịka adreesị, nọmba ekwentị, '
      + 'BVN ma ọ bụ NIN na-enweghị nkwenye ya.',
  },
};
REFUSE.provider = REFUSE.hate; // a moderation endpoint flag without a closer category

const STOPPED = {
  en: 'I stopped this reply because it was heading into content I can’t provide. Ask me something else and I’ll '
    + 'gladly help.',
  pcm: 'I stop dis answer because e dey go where I no fit follow. Ask me another thing, I go help you.',
  yo: 'Mo dá ìdáhùn yìí dúró nítorí pé ó ń lọ sí ibi tí mi ò lè lọ. Bi mí ní nǹkan mìíràn, inú mi yóò dùn láti ràn ọ́ '
    + 'lọ́wọ́.',
  ha: 'Na dakatar da wannan amsa saboda tana kaiwa ga abin da ba zan iya bayarwa ba. Tambaye ni wani abu, zan '
    + 'taimaka.',
  ig: 'Akwụsịrị m azịza a n’ihi na ọ na-aga n’ihe m na-enweghị ike inye. Jụọ m ihe ọzọ, m ga-enyere gị aka.',
};

const pick = (table, lang) => table[lang] || table.en;
const refusal = (category, lang) => pick(REFUSE[category] || REFUSE.hate, lang);
const support = (lang) => `${pick(SUPPORT, lang)}\n\n${HELPLINES}\n\n`;
const stopped = (lang) => `\n\n_${pick(STOPPED, lang)}_`;

module.exports = { refusal, support, stopped, HELPLINES, REFUSE, SUPPORT, STOPPED, LANGS: ['en', 'pcm', 'yo', 'ha',
  'ig'] };
