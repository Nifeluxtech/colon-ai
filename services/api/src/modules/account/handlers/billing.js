// Account: plan and credits (handlers for src/http/routes/account/billing.js). v0.12.0, Blueprint step A.
const billing = require('../../billing');

// GET /account/billing -> { mode, billable, plan, credits {balance, monthly, period, renews}, ledger[], plans[] }
const getAccountBilling = async (req) => [200, await billing.summary(req.user)];

module.exports = { getAccountBilling };
