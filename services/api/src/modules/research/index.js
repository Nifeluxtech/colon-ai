// Research module (0.17.0, Production Blueprint D16): deep research as a metered background job on colon_jobs, run by
// the cron dispatcher (services/api/scripts/cron.js, direct to MySQL), so it survives API restarts and never holds
// an HTTP request open. The in-request Research mode (chat/reply.js) stays for quick answers; deep research is the
// background option the app offers in Research mode. Other modules use only this file:
//   instance()                   the shared service (service.js) over MySQL, the jobs queue and the tool registry
//   use({ store, deps, ... })    tests: another store (memoryStore()), fake search / model, another clock
//   jobs: runStep, sweep         the 'research.step' and 'research.sweep' job handlers (modules/jobs/types.js)
//   handlers                     the HTTP handlers (handlers.js)
// Outbound HTTPS from the cron (to the search providers, the pages read and the AI provider) is assumed to work like
// the API's: AfeesHost's ALTCHA guards inbound requests to the API subdomain, not outbound fetches.
const config = require('../../config');
const log = require('../../shared/logger');
const service = require('./service');
const steps = require('./steps');
const { sqlStore, memoryStore } = require('./store');

function defaultDeps() {
  const search = require('../search');
  const ai = require('../ai');
  const tools = require('../tools');
  return {
    cfg: config.research, now: () => new Date(),
    routing: () => ai.dynamic.load(),
    // Each search goes through the tool registry (web_search: no charge of its own, a timeout).
    webSearch: async (query, signal) => (await tools.invoke('web_search', { query: String(query).slice(0, 300),
      limit: 6 }, { signal })).result,
    readMany: (list, o) => search.reader.readMany(list, o),
    modelQueries: (text, o) => search.modelQueries(text, o),
    buildQueries: (text, o) => search.prompt.buildQueries(text, o),
    contextBlock: (o) => search.contextBlock(o),
    publicSources: (list) => search.publicSources(list),
    generate: (o) => ai.generate(o),
  };
}

let svc = null;
let over = {};
function instance() {
  if (svc) return svc;
  svc = service.create({ store: over.store || sqlStore(), jobs: over.jobs || require('../jobs'),
    tools: over.tools || require('../tools'), deps: { ...defaultDeps(), ...(over.deps || {}) },
    cfg: over.cfg || (() => config.research), now: over.now, log: over.log || log });
  return svc;
}
/** Tests: replace any of store, jobs, tools, deps, cfg, now, log (the rest stay the real ones). */
function use(o = {}) { over = o; svc = null; return instance(); }

module.exports = {
  instance, use, memoryStore, steps, create: service.create, ref: service.ref, TERMINAL: service.TERMINAL,
  jobs: {
    runStep: (job, ctx) => instance().runStep(job, ctx),
    sweep: (o) => instance().sweep(o),
  },
  handlers: require('./handlers'),
};
