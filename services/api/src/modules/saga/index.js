// Saga module (Phase 9, ROADMAP "Saga browser automation"): Saga drives the phone's browser panel through the
// WebSocket bridge (modules/browser/bridge.js) with a fixed tool set, in a decision -> action -> observation loop
// with step and time limits. Page content is untrusted and fenced (modules/safety); payments, purchases, form
// submissions, messages and personal data need the user's approval tapped on the phone; every action is stored in
// saga_actions for the user's and admins' replay. Other layers import only this file.
module.exports = {
  tools: require('./tools'),
  policy: require('./policy'),
  secrets: require('./secrets'),
  prompt: require('./prompt'),
  parse: require('./parse'),
  loop: require('./loop'),
  store: require('./store'),
  runner: require('./runner'),
  handlers: {
    tasks: require('./handlers/tasks'),
    admin: require('./handlers/admin'),
  },
};
