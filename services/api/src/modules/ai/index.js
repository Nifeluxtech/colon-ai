// AI module: the model router (generate, fallback, hedging) and everything around it.
// Other layers import only this file: ai.generate(), ai.listModels(), ai.dynamic.load(), ai.limits.*, ...
const generate = require('./generate');

module.exports = {
  ...generate,
  routing: require('./routing'),
  dynamic: require('./dynamic'),
  limits: require('./limits'),
  prompts: require('./prompts'),
  client: require('./client'),
  sse: require('./sse'),
  calls: require('./calls'),
};
