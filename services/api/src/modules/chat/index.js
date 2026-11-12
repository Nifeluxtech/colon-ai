// Chat module: conversation storage, context building, streamed replies and attachment files.
module.exports = {
  store: require('./store'),
  files: require('./files'),
  context: require('./context'),
  reply: require('./reply'),
  handlers: {
    conversations: require('./handlers/conversations'),
    messages: require('./handlers/messages'),
    settings: require('./handlers/settings'),
    guest: require('./handlers/guest'),
    uploads: require('./handlers/uploads'),
  },
};
