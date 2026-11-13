// Env reader for the browser module: unset and empty both mean "use the default". Read live, so tests can set keys.
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = { env };
