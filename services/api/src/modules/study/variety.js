// CBT practice test (v0.5.8): a different "focus" for every request, so the same exam + subject + topic does not
// send the same prompt twice: a random order of syllabus areas (or, with a topic, of angles on it) to spread across,
// a random mix of question types and a random variety token. `rng` is injectable (tests pass a fixed one).
const SPREAD = 6;

// Main syllabus areas of the quick subjects (WAEC/NECO/JAMB senior secondary); other subjects use the model's own.
const AREAS = {
  mathematics: ['number bases and modular arithmetic', 'indices, logarithms and surds', 'sets and logic',
    'algebraic expressions and factorisation', 'linear and quadratic equations', 'inequalities and variation',
    'sequences and series', 'matrices and determinants', 'mensuration (areas and volumes)', 'plane geometry and '
    + 'circle theorems', 'trigonometry, bearings and heights', 'coordinate geometry', 'statistics',
    'probability', 'differentiation and integration', 'percentages, interest and ratio'],
  english: ['vocabulary in context', 'synonyms', 'antonyms', 'idioms and figurative expressions', 'concord '
    + '(subject–verb agreement)', 'tenses and verb forms', 'prepositions and phrasal verbs', 'pronouns and '
    + 'reference', 'question tags', 'sentence interpretation', 'vowel sounds', 'consonant sounds', 'word stress',
    'emphatic stress and intonation', 'punctuation and spelling', 'comprehension-style inference'],
  physics: ['measurement and units', 'motion and kinematics', 'Newton’s laws and momentum', 'work, energy and power',
    'machines', 'pressure and fluids', 'heat and temperature', 'gas laws', 'waves and sound', 'light: reflection '
    + 'and refraction', 'lenses and optical instruments', 'electrostatics and capacitors', 'current electricity',
    'magnetism and electromagnetic induction', 'atomic and nuclear physics', 'gravitation and circular motion'],
  chemistry: ['atomic structure', 'periodic table and periodicity', 'chemical bonding', 'stoichiometry and the mole',
    'gas laws and kinetic theory', 'acids, bases and salts', 'redox reactions', 'electrolysis', 'energy changes',
    'rates of reaction and equilibrium', 'water, solutions and solubility', 'metals and extraction',
    'non-metals and their compounds', 'hydrocarbons', 'functional groups and organic reactions',
    'separation techniques and lab safety'],
  biology: ['cell structure and organisation', 'cell division', 'nutrition in plants', 'nutrition in animals',
    'transport in plants and animals', 'respiration', 'excretion', 'support and movement', 'reproduction',
    'growth and development', 'coordination: nervous system and hormones', 'sense organs', 'ecology and '
    + 'ecosystems', 'genetics and variation', 'evolution and adaptation', 'classification of living things'],
  economics: ['basic concepts: scarcity, choice, opportunity cost', 'demand', 'supply', 'price determination and '
    + 'elasticity', 'theory of production', 'cost and revenue', 'market structures', 'national income', 'money and '
    + 'inflation', 'banking and financial institutions', 'public finance and taxation', 'international trade and '
    + 'balance of payments', 'population and labour', 'agriculture and industry in Nigeria', 'economic development '
    + 'and planning', 'business organisations'],
  government: ['basic concepts: state, power, authority, sovereignty', 'forms of government', 'constitutions',
    'separation of powers and checks and balances', 'arms of government', 'federalism', 'political parties and '
    + 'pressure groups', 'elections and electoral systems', 'public opinion and the press', 'citizenship and rights',
    'local government', 'public corporations and the civil service', 'pre-colonial Nigerian systems',
    'colonial rule and nationalism', 'Nigerian constitutional development', 'international organisations'],
  literature: ['literary terms and devices', 'figures of speech', 'genres: drama, prose, poetry', 'elements of '
    + 'drama', 'elements of prose fiction', 'poetic forms and metre', 'narrative techniques and point of view',
    'characterisation', 'setting and atmosphere', 'theme and subject matter', 'tone and mood', 'African '
    + 'literature', 'non-African literature', 'unseen poetry appreciation', 'unseen prose appreciation',
    'plot structure and conflict'],
};
// Angles on a single topic (the focus when the student names one).
const ANGLES = ['definitions and key terms', 'underlying principles and laws', 'worked calculations or quantities',
  'real-life and Nigerian everyday applications', 'causes and effects', 'comparisons and differences',
  'exceptions and common misconceptions', 'reading a described table, graph or diagram', 'sequences, stages and '
  + 'processes', 'examples and classification', 'advantages, disadvantages and limitations', 'experiments and '
  + 'observations'];
const TYPES = [
  ['recall', 'direct recall of a fact, term or definition'],
  ['application', 'applying a rule or idea to a new situation'],
  ['calculation', 'a short calculation (only if the subject or topic has numbers)'],
  ['interpretation', 'interpreting data, a passage, a scenario or a described diagram'],
  ['error-spotting', 'spotting the wrong statement, step or usage'],
];

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const keyOf = (subject) => String(subject || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()
  .replace(/^(?:use of )?english(?: language)?$/, 'english').replace(/^literature(?: in english)?$/, 'literature');

// -> { areas: string[] | null, start: number, angles: string[] | null, mix: [type, count][], token }
function pickFocus({ subject, topic }, count, rng = Math.random) {
  const known = AREAS[keyOf(subject)];
  const focus = { areas: null, angles: null, start: 1 + Math.floor(rng() * 12) };
  if (topic) focus.angles = shuffled(ANGLES, rng).slice(0, SPREAD + 2);
  else if (known) focus.areas = shuffled(known, rng).slice(0, SPREAD + 3);
  const types = shuffled(TYPES, rng).slice(0, 3 + Math.floor(rng() * 3));
  const mix = types.map(t => [t, 1]);
  for (let left = count - mix.length; left > 0; left--) mix[Math.floor(rng() * mix.length)][1]++;
  focus.mix = mix.map(([t, n]) => [t[1], n]);
  focus.token = Array.from({ length: 6 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(rng() * 31)]).join('');
  return focus;
}

// The focus as prompt lines (the user turn).
function focusLines(focus, hasTopic) {
  const lines = [];
  if (hasTopic) {
    lines.push(`Spread the questions over at least ${SPREAD} different aspects or sub-skills of the topic, in this `
      + `order of priority: ${focus.angles.join('; ')}.`);
  } else if (focus.areas) {
    lines.push(`Spread the questions over at least ${SPREAD} different syllabus areas, in this order of priority: `
      + `${focus.areas.join('; ')}. At most two questions from any one area.`);
  } else {
    lines.push(`List the main areas of this syllabus for yourself in syllabus order, start from area number `
      + `${focus.start} (wrapping round) and spread the questions over at least ${SPREAD} different areas. At most `
      + 'two questions from any one area.');
  }
  lines.push('Question types for this test: ' + focus.mix.map(([t, n]) => `${n} × ${t}`).join('; ')
    + '. If a type does not suit the subject, use application instead.');
  lines.push(`Variety token: ${focus.token} (use it to make fresh choices of contexts, names and numbers).`);
  return lines;
}

module.exports = { AREAS, ANGLES, TYPES, SPREAD, pickFocus, focusLines, keyOf };
