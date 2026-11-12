// Health module: GET / and GET /health (database, migrations, AI and email status).
module.exports = {
  handlers: {
    health: require('./handlers/health'),
  },
};
