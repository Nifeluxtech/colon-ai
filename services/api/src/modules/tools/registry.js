// The tool registry (0.17.0, Production Blueprint D14): one entry per server-side tool, with everything the router
// needs to decide whether and how a call may run.
//   name          a-z0-9_ (also the Gemini function name when the chat model may call it)
//   description   for the model and Admin › Tools
//   schema        JSON-schema subset for the arguments (type object, properties with type / enum / maxLength /
//                 minLength / minimum / maximum, required); arguments are checked before anything else happens
//   risk          low | medium | high (shown in Admin › Tools; high tools must ask for consent or explain why not)
//   plans         null = every plan, or the plan codes that may use it
//   entitlement   a plan_entitlements feature (image_credits, research_tasks): the plan must have it switched on and
//                 its monthly count left (editable in Admin › Plans); usage is recorded under that feature
//   credits       Colon credits per call (number or function), reserved before the call and settled after it
//   timeoutMs     the call is aborted after this long (code tool_timeout)
//   consent       true = the user must have confirmed this call (ctx.consent), else consent_required (409)
//   guests        true = signed-out users may call it (never charged)
//   model         true = offered to the chat model as a function (declarations())
//   defer         true = the call starts background work: credits stay reserved until close() settles or refunds
//   enabled()     optional live switch (e.g. IMAGE_MODEL empty = off)
//   run(args, ctx) the executor; null when the caller supplies it (ctx.run, e.g. the browser tools in modules/chat)
//   note          one line for Admin › Tools (why the policy is what it is)
const RISKS = ['low', 'medium', 'high'];
const TYPES = ['string', 'integer', 'number', 'boolean', 'object', 'array'];
const NAME = /^[a-z][a-z0-9_]{1,39}$/;

function bad(msg, field) {
  return Object.assign(new Error(msg), { status: 422, code: 'invalid', field });
}

function typeOk(v, type) {
  if (type === 'integer') return Number.isInteger(v);
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'array') return Array.isArray(v);
  if (type === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  return typeof v === type;
}

/** validate(schema, args) -> a cleaned copy (unknown keys dropped). Throws 422 { field } on the first problem. */
function validate(schema, args) {
  const s = schema || { type: 'object', properties: {} };
  const a = args == null ? {} : args;
  if (!typeOk(a, 'object')) throw bad('Tool arguments must be an object.', 'args');
  const out = {};
  for (const key of s.required || []) {
    if (a[key] === undefined || a[key] === null || a[key] === '') throw bad(`${key} is required.`, key);
  }
  for (const [key, p] of Object.entries(s.properties || {})) {
    const v = a[key];
    if (v === undefined || v === null) continue;
    if (p.type && !typeOk(v, p.type)) throw bad(`${key} must be ${p.type === 'integer' ? 'a whole number'
      : `a ${p.type}`}.`, key);
    if (p.enum && !p.enum.includes(v)) throw bad(`${key} must be one of ${p.enum.join(', ')}.`, key);
    if (typeof v === 'string') {
      if (p.maxLength != null && v.length > p.maxLength) throw bad(`${key} is too long (${p.maxLength} max).`, key);
      if (p.minLength != null && v.trim().length < p.minLength) throw bad(`${key} is too short.`, key);
    }
    if (typeof v === 'number') {
      if (p.minimum != null && v < p.minimum) throw bad(`${key} must be at least ${p.minimum}.`, key);
      if (p.maximum != null && v > p.maximum) throw bad(`${key} must be at most ${p.maximum}.`, key);
    }
    out[key] = v;
  }
  return out;
}

function checkSchema(name, schema) {
  if (!schema || schema.type !== 'object') throw new Error(`tools: ${name} schema must be { type: 'object' }`);
  for (const [k, p] of Object.entries(schema.properties || {})) {
    if (p.type && !TYPES.includes(p.type)) throw new Error(`tools: ${name}.${k} has an unknown type ${p.type}`);
  }
}

function create() {
  const tools = new Map();
  function register(def) {
    if (!def || !NAME.test(def.name || '')) throw new Error(`tools: bad tool name ${def && def.name}`);
    if (tools.has(def.name)) throw new Error(`tools: ${def.name} is already registered`);
    if (!RISKS.includes(def.risk)) throw new Error(`tools: ${def.name} risk must be ${RISKS.join(', ')}`);
    if (!(Number(def.timeoutMs) > 0)) throw new Error(`tools: ${def.name} needs a timeoutMs`);
    if (def.risk === 'high' && !def.consent && !def.note) {
      throw new Error(`tools: ${def.name} is high risk: set consent, or a note saying where consent happens`);
    }
    if (def.run != null && typeof def.run !== 'function') throw new Error(`tools: ${def.name} run must be a function`);
    if (def.plans != null && !Array.isArray(def.plans)) throw new Error(`tools: ${def.name} plans must be a list`);
    const schema = def.schema || { type: 'object', properties: {} };
    checkSchema(def.name, schema);
    const entry = { description: '', plans: null, entitlement: null, credits: 0, consent: false, guests: false,
      model: false, defer: false, enabled: null, run: null, note: '', ...def, schema };
    tools.set(def.name, entry);
    return entry;
  }
  const get = (name) => tools.get(String(name || '')) || null;
  const isOn = (t) => !t.enabled || Boolean(t.enabled());
  const creditsOf = (t) => Math.max(0, Math.floor(Number(typeof t.credits === 'function' ? t.credits() : t.credits)
    || 0));
  /** Gemini function declarations for the tools the chat model may call (only switched-on ones). */
  function declarations(names) {
    const list = names ? names.map(get).filter(Boolean) : [...tools.values()].filter((t) => t.model);
    return list.filter(isOn).map((t) => ({ name: t.name, description: t.description,
      parameters: { type: 'object', ...(t.schema.required ? { required: t.schema.required } : {}),
        properties: Object.fromEntries(Object.entries(t.schema.properties || {}).map(([k, p]) => [k,
          { type: p.type || 'string', ...(p.description ? { description: p.description } : {}),
            ...(p.enum ? { enum: p.enum } : {}) }])) } }));
  }
  /** What Admin › Tools shows: the policy of every tool, no executors. */
  function describe() {
    return [...tools.values()].map((t) => ({ name: t.name, description: t.description, risk: t.risk,
      plans: t.plans, entitlement: t.entitlement, credits: creditsOf(t), timeout_ms: t.timeoutMs,
      consent: Boolean(t.consent), guests: Boolean(t.guests), model: Boolean(t.model), defer: Boolean(t.defer),
      enabled: isOn(t), runs_in: t.run ? 'server' : 'caller', note: t.note || '',
      args: Object.keys(t.schema.properties || {}), required: t.schema.required || [] }));
  }
  return { register, get, has: (n) => tools.has(n), all: () => [...tools.values()], isOn, creditsOf, declarations,
    describe };
}

module.exports = { create, validate, RISKS };
