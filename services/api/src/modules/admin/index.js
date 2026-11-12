// Admin module: the Admin Dashboard API (users, moderation, AI providers/models/routing, limits,
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
  },
};
