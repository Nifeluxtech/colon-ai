// Admin › Tools (v0.17.0, Blueprint D14; handler for routes/admin/tools.js). Admin and Super Admin only (route guard).
// Read-only: each server-side tool's policy (risk, plans, entitlement, credits, timeout, consent) comes from code
// (modules/tools/catalogue.js) and the plan allowances from Admin › Plans; the call counts are this worker's since it
// started.
const tools = require('../../tools');

// GET /admin/tools
const getTools = async () => [200, tools.list()];

module.exports = { getTools };
