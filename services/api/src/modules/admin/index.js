// Admin module: the Admin Dashboard API (users, moderation, AI providers/models/routing, limits, billing,
// evaluation, African AI registry, voice, system and web search settings, safety events and settings, audit).
module.exports = {
  handlers: {
    overview: require('./handlers/overview'),
    users: require('./handlers/users'),
    moderation: require('./handlers/moderation'),
    audit: require('./handlers/audit'),
    ai: require('./handlers/ai'),
    routing: require('./handlers/routing'),
    limits: require('./handlers/limits'),
    evaluation: require('./handlers/evaluation'),
    platform: require('./handlers/platform'),
    webSearch: require('./handlers/web-search'),
    safety: require('./handlers/safety'),
    billing: require('./handlers/billing'),   // v0.14.0: plans, credits, payments, costs
    jobs: require('./handlers/jobs'),         // v0.16.0: background jobs and the cron
    tools: require('./handlers/tools'),       // v0.17.0: the tool registry (read-only)
  },
};
