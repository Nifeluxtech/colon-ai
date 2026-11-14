// Model set (0.10.6): which models Saga may use at all. "gemma" (the default) = Gemma 4 only, for chat replies and
// the browser agent alike: Gemma 4 26B on Google AI Studio leads, Gemma 4 31B only when 26B fails or times out,
// one model at a time (no hedged racing, no specialist reordering). "all" = the full routing table (routing.js,
// Admin › Routing, specialists, AI_HEDGE). Read live from AI_MODEL_SET so a flip needs no code change.
const GEMMA4 = /gemma[-_ ]?4/i;
const BIG = /31b/i;

function modelSet(envValue = process.env.AI_MODEL_SET) {
  return String(envValue || 'gemma').trim().toLowerCase() === 'all' ? 'all' : 'gemma';
}

const gemmaOnly = (envValue) => modelSet(envValue) === 'gemma';

// The slot names to read targets from: Gemma slots first, then every other slot (only its Gemma 4 entries survive).
function slotNames(targets) {
  const names = Object.keys(targets || {});
  const first = ['gemma', 'gemma31'].filter(n => names.includes(n));
  return first.concat(names.filter(n => !first.includes(n)));
}

/**
 * gemmaChain(chain) -> the Gemma 4 entries of a built chain: Google AI Studio (native) hosts when there is one,
 * else any non-NVIDIA Gemma 4 host; 26B (every non-31B id) before 31B. Never MiniMax, Qwen, DeepSeek, GLM, NVIDIA.
 */
function gemmaChain(chain) {
  const g4 = chain.filter(c => GEMMA4.test(String(c.model)) && c.providerId !== 'nvidia');
  const google = g4.filter(c => c.provider && c.provider.native === 'gemini');
  const list = google.length ? google : g4;
  return list.filter(c => !BIG.test(c.model)).concat(list.filter(c => BIG.test(c.model)))
    .map(({ demoted, ...c }) => c);
}

module.exports = { modelSet, gemmaOnly, gemmaChain, slotNames, GEMMA4 };
