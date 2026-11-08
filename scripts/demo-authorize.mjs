// Stage-1 happy path (Sandbox play money only):
//   create order intent=AUTHORIZE for $200.00 (the locked worked example)
//   -> read the order back and print its status.
// NOTE: an AUTHORIZE order reaches status APPROVED only after a payer
// approves it (checkout flow). This script verifies creation + read-back;
// the full approve → authorize → capture chain is exercised by the
// owner-run Termux harness (termux_finish_demo.py).
// No invoice_id is sent — see the field rule in src/paypal-rest/client.mjs;
// the reference label carries the mandate's number instead.
// Amounts are re-read from PayPal's own record before being shown (philosophy §3).
import { createAuthorizeOrder, getOrder } from '../src/paypal-rest/client.mjs';

const created = await createAuthorizeOrder({
  amount: '200.00', currency: 'USD', referenceId: 'M-2026-001',
  description: 'Mandate hold — logo design agreement ($200 cap)',
});
console.log(`create: http=${created.status} ok=${created.ok}`);
if (!created.ok) { console.log(JSON.stringify(created.data, null, 2)); process.exit(1); }
const order = created.data;
console.log(`order_id=${order.id} status=${order.status} intent=${order.intent}`);
const pu = order.purchase_units?.[0];
console.log(`amount_from_paypal=${pu?.amount?.value} ${pu?.amount?.currency_code} reference_id=${pu?.reference_id || '-'}`);
const readBack = await getOrder(order.id);
console.log(`readback: http=${readBack.status} status=${readBack.data?.status}`);
