// Environment reading and validation. cPanel > Setup Node.js App passes settings as environment
// variables; an unset key and an empty key both mean "use the default".
const read = (env, key, fallback) => (env[key] !== undefined && env[key] !== '' ? env[key] : fallback);
const list = (v) => String(v).split(',').map(s => s.trim()).filter(Boolean);

// Checks every key of the schema against `env`. Returns a list of human-readable problems (empty = valid).
function validate(schema, env = process.env) {
  const nodeEnv = read(env, 'NODE_ENV', 'development');
  const problems = [];
  for (const item of schema) {
    const raw = env[item.key];
    const set = raw !== undefined && raw !== '';
    if (!set) {
      if (item.requiredIn && item.requiredIn.includes(nodeEnv)) {
        problems.push(`${item.key} is required when NODE_ENV=${nodeEnv} (${item.doc})`);
      }
      continue;
    }
    if (item.type === 'number' && !Number.isFinite(Number(raw))) {
      problems.push(`${item.key} must be a number, got "${String(raw).slice(0, 40)}"`);
    }
    if (item.type === 'enum' && !item.values.includes(String(raw))) {
      problems.push(`${item.key} must be one of ${item.values.join(', ')}, got "${String(raw).slice(0, 40)}"`);
    }
    if (item.type === 'url' && !/^https?:\/\/[^\s]+$/.test(String(raw))) {
      problems.push(`${item.key} must be an http(s) URL, got "${String(raw).slice(0, 60)}"`);
    }
  }
  return problems;
}

class ConfigError extends Error {
  constructor(problems) {
    super('Colon API configuration is invalid. Fix these environment variables (cPanel > Setup Node.js App)'
      + ' and restart:\n' + problems.map(p => `  - ${p}`).join('\n'));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

module.exports = { read, list, validate, ConfigError };
