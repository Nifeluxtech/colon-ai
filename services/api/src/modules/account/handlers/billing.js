// Account: plan and credits (handlers for src/http/routes/account/billing.js). v0.12.0, Blueprint step A.
// v0.13.0: also says whether payments are on and lists the user's recent payments (plan page).
const billing = require('../../billing');
const payments = () => require('../../payments');

// GET /account/billing -> { mode, billable, plan, subscription, credits {balance, monthly, period, renews}, ledger[],
//   plans[], payments (on/off), payments_recent[] }
const getAccountBilling = async (req) => {
  const out = await billing.summary(req.user);
  const pay = payments();
  out.payments = pay.enabled();
  if (out.billable) {
    const names = {};
    for (const p of out.plans || []) names[p.code] = p.name;
    out.payments_recent = (await pay.history(req.user, 5).catch(() => []))
      .map((p) => ({ ...p, plan_name: names[p.plan] || p.plan }));
  }
  return [200, out];
};

module.exports = { getAccountBilling };
