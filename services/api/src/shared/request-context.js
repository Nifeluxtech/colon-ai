// Per-request context (AsyncLocalStorage): the request id follows every await, so each log line
// written while handling a request carries it without passing it around.
const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

const store = new AsyncLocalStorage();
// An incoming X-Request-Id (from a proxy or the app) is kept only when it is short and plain.
const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

const requestIdFor = (incoming) => (typeof incoming === 'string' && SAFE_ID.test(incoming)
  ? incoming : crypto.randomUUID());
const run = (ctx, fn) => store.run(ctx, fn);
const current = () => store.getStore() || null;

module.exports = { requestIdFor, run, current, SAFE_ID };
