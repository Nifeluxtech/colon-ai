// Bench module: the Colon benchmark (runner, graders, sandbox, aggregation, report) and the model gate.
module.exports = {
  runner: require('./runner'),
  graders: require('./graders'),
  sandbox: require('./sandbox'),
  aggregate: require('./aggregate'),
  report: require('./report'),
  gate: require('./gate'),
  candidates: require('./candidates'),
  checkpoint: require('./checkpoint'),
  limiter: require('./limiter'),
  retry: require('./retry'),
  probe: require('./probe'),
};
