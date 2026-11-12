// Search module: web search providers, the page reader and the Research-mode flow.
module.exports = {
  ...require('./search'),
  net: require('./net'),
  prompt: require('./prompt'),
  providers: require('./providers'),
  reader: require('./reader'),
  text: require('./text'),
};
