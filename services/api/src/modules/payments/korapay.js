// Korapay (Kora) client: Checkout Redirect + verify + webhook signature. Server-side only; the secret key never
// leaves the API. Docs: developers.korapay.com/docs/checkout-redirect, /docs/webhooks.
//   POST {base}/charges/initialize  { amount (major units, NGN), currency, reference, customer{email,name},
//                                     redirect_url, notification_url, narration, channels, metadata }
//                                   -> { status:true, data:{ reference, checkout_url } }
//   GET  {base}/charges/:reference  -> { status:true, data:{ reference, status, amount, currency, fee, ... } }
//   webhook: header x-korapay-signature = HMAC-SHA256(JSON.stringify(body.data), secret key), hex.
const crypto = require('crypto');

function korapay({ secretKey, baseUrl = 'https://api.korapay.com/merchant/api/v1', fetch: f = globalThis.fetch,
  timeoutMs = 20000 } = {}) {
  async function call(method, path, body) {
    if (!secretKey) throw Object.assign(new Error('Payments are not set up yet.'), { status: 503,
      code: 'payments_off' });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    let res; let json = null;
    try {
      res = await f(`${baseUrl}${path}`, { method, signal: ctl.signal,
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json',
          Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined });
      json = await res.json().catch(() => null);
    } catch (e) {
      throw Object.assign(new Error('Could not reach Korapay. Please try again.'), { status: 502,
        code: 'provider_unreachable', cause: e });
    } finally { clearTimeout(t); }
    if (!res.ok || !json || json.status !== true) {
      const msg = (json && json.message) || `Korapay error ${res.status}`;
      throw Object.assign(new Error(String(msg).slice(0, 200)), { status: res.status >= 500 ? 502 : 400,
        code: 'provider_error', providerStatus: res.status });
    }
    return json.data || {};
  }
  return {
    initialize: (p) => call('POST', '/charges/initialize', p),
    verify: (reference) => call('GET', `/charges/${encodeURIComponent(reference)}`),
    sign: (data) => crypto.createHmac('sha256', secretKey || '').update(JSON.stringify(data)).digest('hex'),
    // Constant-time check of the webhook signature.
    signatureOk(data, header) {
      if (!secretKey || !header || data == null) return false;
      const want = Buffer.from(this.sign(data), 'utf8');
      const got = Buffer.from(String(header).trim().toLowerCase(), 'utf8');
      return want.length === got.length && crypto.timingSafeEqual(want, got);
    },
  };
}

module.exports = { korapay };
