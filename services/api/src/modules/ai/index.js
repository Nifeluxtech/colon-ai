// AI module: the model router (generate, fallback, hedging) and everything around it.
// Other layers import only this file: ai.generate(), ai.listModels(), ai.dynamic.load(), ai.limits.*, ...
const generate = require('./generate');

module.exports = {
  ...generate,
  routing: require('./routing'),
  dynamic: require('./dynamic'),
  limits: require('./limits'),
  prompts: require('./prompts'),
  fun: require('./fun'),   // 0.37.0: tone that follows the user, and stickers
  client: require('./client'),
  sse: require('./sse'),
  calls: require('./calls'),
  specialists: require('./specialists'),
  classify: require('./classify'),
  modelSet: require('./model-set'),
  support: require('./support'),
  toolCall: require('./tool-call'),   // 0.11.5: the chat model's function calling (browser tools)
  answered: () => require('./hedge').recent.slice(),
};
