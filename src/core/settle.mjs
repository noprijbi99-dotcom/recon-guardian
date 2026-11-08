// Settle — where money moves, and only here (LOCKED-SPEC: deterministic code
// moves money; the LLM never holds money tools; money tools are not even
// registered with the LLM).
//
// Two backends behind one door:
//   live — raw REST through paypal-rest/client.mjs (Sandbox play money)
//   mock — an in-memory ledger with the same shapes, for the local demo and
//          tests. Mock IDs are always MOCK-prefixed: mock money is never
//          presented as PayPal money (DESIGN-PHILOSOPHY §1, §3).
//
// Vocabulary (§7): createHold = the HOLD (Orders v2 AUTHORIZE),
// releaseVerified = the RELEASE (capture of the verified amount only,
// final_capture=true releases the remainder back to the buyer).
import {
  getAccessToken,
  createAuthorizeOrder,
  captureAuthorization,
  voidAuthorization,
} from '../paypal-rest/client.mjs';
import { fmt } from './money.mjs';

// --- Mock ledger -----------------------------------------------------------
export function mockBackend() {
  const holds = new Map();
  let seq = 0;
  const nid = (p) => `MOCK-${p}-${String(++seq).padStart(4, '0')}`;
  return {
    name: 'mock',
    async createHold({ amountCents, currency, payeeEmail, invoiceId }) {
      const holdId = nid('HOLD');
      holds.set(holdId, { amountCents, currency, payeeEmail, invoiceId, status: 'HELD', releasedCents: 0 });
      return { holdId, status: 'HELD', heldCents: amountCents };
    },
    async releaseVerified(holdId, { amountCents, finalCapture = true, invoiceId }) {
      const h = holds.get(holdId);
      if (!h) throw new Error(`UNKNOWN_HOLD: ${holdId}`);
      if (h.status !== 'HELD') throw new Error(`HOLD_NOT_OPEN: ${holdId} is ${h.status}`);
      if (amountCents > h.amountCents) throw new Error('RELEASE_EXCEEDS_HOLD');
      h.releasedCents = amountCents;
      h.status = finalCapture ? 'RELEASED' : 'PARTIALLY_RELEASED';
      return {
        releaseId: nid('REL'),
        releasedCents: amountCents,
        remainderCents: finalCapture ? h.amountCents - amountCents : 0,
      };
    },
    async voidHold(holdId) {
      const h = holds.get(holdId);
      if (!h) throw new Error(`UNKNOWN_HOLD: ${holdId}`);
      h.status = 'VOIDED';
      return { holdId, status: 'VOIDED' };
    },
  };
}

// --- Live backend (PayPal Sandbox) ------------------------------------------
// The AUTHORIZE order reaches an authorization only after the buyer approves
// it in the checkout flow; that approval is the account owner's step (the
// proven harness is the Termux lane — termux_finish_demo.py — where the
// owner approves as the Sandbox buyer; see the submission's proof files).
// Amounts shown to anyone are re-read from PayPal's own record first
// (philosophy §3). The mandate/invoice numbers travel as reference labels
// only — never as PayPal invoice_id fields (field rule in client.mjs).
export function liveBackend() {
  return {
    name: 'live',
    async createHold({ amountCents, currency, payeeEmail, invoiceId, description }) {
      await getAccessToken();
      const created = await createAuthorizeOrder({
        amount: fmt(amountCents), currency, payeeEmail, referenceId: invoiceId, description,
      });
      if (!created.ok) throw new Error(`HOLD_CREATE_FAILED http=${created.status}`);
      return { holdId: created.data.id, status: created.data.status, heldCents: amountCents };
    },
    async releaseVerified(authorizationId, { amountCents, currency = 'USD', finalCapture = true }) {
      const res = await captureAuthorization(authorizationId, {
        amount: fmt(amountCents), currency, finalCapture,
      });
      if (!res.ok) throw new Error(`RELEASE_FAILED http=${res.status}`);
      return { releaseId: res.data.id, releasedCents: amountCents, remainderCents: 0 };
    },
    async voidHold(authorizationId) {
      const res = await voidAuthorization(authorizationId);
      if (!res.ok && res.status !== 204) throw new Error(`VOID_FAILED http=${res.status}`);
      return { holdId: authorizationId, status: 'VOIDED' };
    },
  };
}

export function settleBackend(kind) {
  return kind === 'live' ? liveBackend() : mockBackend();
}
