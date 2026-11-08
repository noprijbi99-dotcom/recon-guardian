// PayPal REST client — raw REST for ALL money movement (per LOCKED-SPEC:
// the official toolkit cannot authorize / partially capture, so money
// never goes through toolkit tools and never through the LLM).
// Deterministic code moves money. This module is that code's hands.
import { randomUUID } from 'node:crypto';
import { paypalConfig } from '../config.mjs';

let tokenCache = { token: null, expiresAt: 0 };

export async function getAccessToken() {
  const { base, clientId, clientSecret, ready } = paypalConfig();
  if (!ready) throw new Error('PAYPAL_NOT_CONFIGURED: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing in .env');
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt - 30_000) return tokenCache.token;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`TOKEN_FAILED http=${res.status} name=${data.name || ''} message=${data.message || ''}`);
  tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in * 1000) };
  return tokenCache.token;
}

// Generic authenticated request. requestId makes mutating calls retry-safe.
export async function ppRequest(path, { method = 'GET', body, requestId } = {}) {
  const { base } = paypalConfig();
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (method !== 'GET') headers['PayPal-Request-Id'] = requestId || randomUUID();
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

// Orders v2 — create an order with intent=AUTHORIZE (the HOLD).
// The mandate acts as the authorization: money is held in the agreement's
// name, NOT paid. Capture happens later, only for the verified amount.
// FIELD RULE (proven in three rejected Sandbox runs, 2026-11-08): never
// send a PayPal invoice_id on the order or the capture. This merchant
// account enforces invoice-id uniqueness so aggressively that ANY
// invoice_id in the authorize chain is rejected as DUPLICATE_INVOICE_ID.
// The mandate's number rides in reference_id — our own label, not
// uniqueness-policed. The invoice DOCUMENT is still verified line-by-line
// against the mandate by the guardian core; the on-PayPal trail is
// order / authorization / capture IDs.
export function createAuthorizeOrder({ amount, currency = 'USD', payeeEmail, referenceId, description }) {
  const unit = {
    reference_id: referenceId || `mandate-${randomUUID()}`,
    amount: { currency_code: currency, value: amount },
    ...(description ? { description } : {}),
    ...(payeeEmail ? { payee: { email_address: payeeEmail } } : {}),
  };
  return ppRequest('/v2/checkout/orders', {
    method: 'POST',
    body: { intent: 'AUTHORIZE', purchase_units: [unit] },
  });
}

export function getOrder(orderId) {
  return ppRequest(`/v2/checkout/orders/${orderId}`);
}

// Capture against an existing authorization — only ever called with the
// VERIFIED amount after reconciliation says MATCH (or human-approved
// exception). No invoice_id here either — see the field rule above.
export function captureAuthorization(authorizationId, { amount, currency = 'USD', finalCapture = true }) {
  return ppRequest(`/v2/payments/authorizations/${authorizationId}/capture`, {
    method: 'POST',
    body: {
      amount: { value: amount, currency_code: currency },
      final_capture: finalCapture,
    },
  });
}

export function voidAuthorization(authorizationId) {
  return ppRequest(`/v2/payments/authorizations/${authorizationId}/void`, { method: 'POST', body: {} });
}
