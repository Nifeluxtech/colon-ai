// Env reader shared by the provider files: unset and empty both mean "use the default".
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = { env };
