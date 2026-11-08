// Receipts — the joined evidence chain (DESIGN-PHILOSOPHY §7: Receipt;
// §1: evidence, not verdicts — a drift receipt states three things only:
// agreed / billed / what changed. Facts argue; we don't.)
// Vocabulary is LOCKED: Mandate, Hold, Match, Drift, Release, Receipt.
import { fmt, fmtSigned } from './money.mjs';

// The drift receipt: issued on BLOCK and EXCEPTION. On BLOCK it is also
// the seller-facing document behind the repair link — it invites a fix,
// it never accuses (§2). On EXCEPTION it is the human's evidence for the
// approve / decline decision.
export function driftReceipt(result) {
  const out = [];
  out.push('DRIFT RECEIPT');
  out.push(`Mandate ${result.mandateId} · hash ${result.mandateHash.slice(0, 12)}…`);
  out.push(`Invoice ${result.invoiceNumber} (${result.invoiceId})`);
  out.push('');
  out.push('item | agreed | billed | what changed');
  for (const l of result.lines) {
    if (l.status === 'MATCH') {
      out.push(`${l.item} | ${fmt(l.agreed.quantity * l.agreed.unitPriceCents)} | ${fmt(l.invoiced.quantity * l.invoiced.unitPriceCents)} | —`);
    } else if (l.status === 'DRIFT') {
      const changes = l.diffs.map((d) => (d === 'unitPrice'
        ? `unit price ${fmt(l.agreed.unitPriceCents)} → ${fmt(l.invoiced.unitPriceCents)}`
        : `quantity ${l.agreed.quantity} → ${l.invoiced.quantity}`)).join('; ');
      out.push(`${l.item} | ${fmt(l.agreed.quantity * l.agreed.unitPriceCents)} | ${fmt(l.invoiced.quantity * l.invoiced.unitPriceCents)} | ${changes}`);
    } else if (l.status === 'UNEXPECTED') {
      out.push(`${l.item} | — | ${fmt(l.invoiced.quantity * l.invoiced.unitPriceCents)} | not in the mandate`);
    } else if (l.status === 'MISSING') {
      out.push(`${l.item} | ${fmt(l.agreed.quantity * l.agreed.unitPriceCents)} | — | missing from the invoice`);
    }
  }
  out.push('');
  out.push(`Agreed total ${result.agreedTotal} · Billed total ${result.billedTotal} · Drift ${result.drift}`);
  for (const f of result.findings) out.push(`Finding: ${f.kind}`);
  for (const f of result.memoryFlags) out.push(`Payee memory: ${f.kind}${f.item ? ` — ${f.item}` : ''}`);
  out.push('');
  out.push('One line needs your fix — correct it and the hold releases on match. Nothing has been paid.');
  return out.join('\n');
}

// The joined receipt: issued on Release. Quiet by design (§4 — silence when
// all is well): one chain linking mandate → invoice → payment.
export function joinedReceipt({ mandate, invoice, settlement }) {
  return [
    'RECEIPT',
    `Mandate ${mandate.id} · hash ${mandate.hash.slice(0, 12)}…`,
    `Invoice ${invoice.number} (${invoice.id})`,
    `Hold ${settlement.holdId} · Release ${settlement.releaseId}`,
    `Released ${fmt(settlement.releasedCents)} ${mandate.currency} of ${fmt(settlement.heldCents)} held · Remainder ${fmt(settlement.remainderCents)} returned to the buyer`,
  ].join('\n');
}
