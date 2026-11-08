// Guardian — the orchestrator. This is the ONLY path money ever takes:
//   Mandate (frozen) → Hold → invoice arrives → Reconcile → verdict →
//   MATCH: Release the verified amount · EXCEPTION: hold for the human ·
//   BLOCK: nothing moves, a drift receipt is issued.
// Tiered autonomy (DESIGN-PHILOSOPHY §5): the agent pays alone only inside
// what was agreed, under the cap, with a known payee. Everything else is an
// exception, and exceptions belong to the human (§5, §6: hold is not seizure —
// on EXCEPTION the money waits, reversible, until the human decides).
import { reconcile, repairInvoice } from './reconcile.mjs';
import { learnInvoice } from './payee-memory.mjs';
import { driftReceipt, joinedReceipt } from './receipt.mjs';

export function createGuardian({ backend, memory }) {
  const seenInvoiceIds = new Set();
  const holds = new Map(); // mandateId -> { holdId, heldCents }
  const receipts = []; // the joined evidence chain, in order

  return {
    // Step 2 of the flow: the mandate acts as the authorization (the HOLD).
    async openHold(mandate) {
      const hold = await backend.createHold({
        amountCents: mandate.capCents,
        currency: mandate.currency,
        payeeEmail: mandate.payee.email,
        invoiceId: mandate.id,
        description: `Mandate hold — ${mandate.id}`,
      });
      holds.set(mandate.id, { holdId: hold.holdId, heldCents: hold.heldCents });
      return hold;
    },

    // Steps 3–5: an invoice arrives; it must answer to the frozen mandate.
    async processInvoice(mandate, invoice) {
      const hold = holds.get(mandate.id);
      if (!hold) throw new Error(`NO_HOLD for mandate ${mandate.id}`);
      const result = reconcile(mandate, invoice, { memory, seenInvoiceIds });
      seenInvoiceIds.add(invoice.id);

      if (result.verdict === 'MATCH') {
        const verifiedCents = invoice.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
        const rel = await backend.releaseVerified(hold.holdId, {
          amountCents: verifiedCents,
          currency: mandate.currency,
          finalCapture: true,
          invoiceId: invoice.number,
        });
        const settlement = {
          holdId: hold.holdId,
          releaseId: rel.releaseId,
          heldCents: hold.heldCents,
          releasedCents: rel.releasedCents,
          remainderCents: rel.remainderCents,
        };
        const receipt = joinedReceipt({ mandate, invoice, settlement });
        receipts.push(receipt);
        if (memory) learnInvoice(memory, invoice);
        return { verdict: 'MATCH', result, settlement, receipt };
      }

      if (result.verdict === 'EXCEPTION') {
        // The hold stays open. The human decides: approve (release the billed
        // amount) or decline (void). Nothing moves on the agent's own word.
        // The human gets the same evidence document a BLOCK issues — the
        // decision is theirs, but it is never made blind.
        return { verdict: 'EXCEPTION', result, awaiting: 'HUMAN_DECISION', driftReceipt: driftReceipt(result) };
      }

      // BLOCK — nothing moves; the drift receipt is the seller's repair door.
      return { verdict: 'BLOCK', result, driftReceipt: driftReceipt(result) };
    },

    // The human's answer to an EXCEPTION.
    async resolveException(mandate, invoice, { approve }) {
      const hold = holds.get(mandate.id);
      if (!hold) throw new Error(`NO_HOLD for mandate ${mandate.id}`);
      if (!approve) {
        await backend.voidHold(hold.holdId);
        return { verdict: 'EXCEPTION_DECLINED', voided: hold.holdId };
      }
      const billedCents = invoice.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
      const rel = await backend.releaseVerified(hold.holdId, {
        amountCents: billedCents,
        currency: mandate.currency,
        finalCapture: true,
        invoiceId: invoice.number,
      });
      const settlement = {
        holdId: hold.holdId,
        releaseId: rel.releaseId,
        heldCents: hold.heldCents,
        releasedCents: rel.releasedCents,
        remainderCents: rel.remainderCents,
      };
      const receipt = joinedReceipt({ mandate, invoice, settlement });
      receipts.push(receipt);
      if (memory) learnInvoice(memory, invoice);
      return { verdict: 'EXCEPTION_APPROVED', settlement, receipt };
    },

    // LOCKED differentiator #1: the seller repairs the drifted lines; the
    // corrected invoice re-enters the same gauntlet against the same mandate.
    async repairAndReprocess(mandate, blockedInvoice, repair) {
      const corrected = repairInvoice(blockedInvoice, repair);
      return this.processInvoice(mandate, corrected);
    },

    get receipts() { return receipts; },
  };
}
