// Reconcile — the deterministic line-by-line matcher (DESIGN-PHILOSOPHY §7:
// Match / Drift; §5: autonomy is earned, exceptions are human).
// NO LLM ever runs here. Same inputs → same verdict, every time.
//
// Verdicts (LOCKED-SPEC flow step 5):
//   MATCH     — every line matches, under cap, known payee → release may proceed
//   EXCEPTION — any drifted line whose total drift stays within ±5% of the
//               mandate total (the LOCKED-SPEC "small drift") → human confirms,
//               and the human's approval releases the BILLED amount
//   BLOCK     — duplicate / payee shifted / large drift / over cap / any
//               changed, unexpected or missing line → nothing moves; a drift
//               receipt is issued and the seller may repair the drifted lines.
import { verifyMandate } from './mandate.mjs';
import { memoryFlags } from './payee-memory.mjs';
import { fmt, fmtSigned, toCents } from './money.mjs';

export const EXCEPTION_DRIFT_LIMIT = 0.05; // ≤ +5% total drift = exception tier

export function normalizeInvoice(doc) {
  return {
    id: doc.id,
    number: doc.number,
    payee: doc.payee,
    currency: doc.currency || 'USD',
    lines: doc.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPriceCents: toCents(l.unitPrice),
    })),
  };
}

export function invoiceTotalCents(inv) {
  return inv.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
}

export function reconcile(mandate, invoice, { memory, seenInvoiceIds = new Set() } = {}) {
  if (!verifyMandate(mandate)) throw new Error('MANDATE_HASH_MISMATCH: the frozen agreement does not verify');

  const findings = [];
  const billedTotal = invoiceTotalCents(invoice);
  const driftCents = billedTotal - mandate.totalCents;

  // --- hard blocks -------------------------------------------------------
  if (seenInvoiceIds.has(invoice.id)) {
    findings.push({ kind: 'DUPLICATE_INVOICE', severity: 'BLOCK', invoiceId: invoice.id });
  }
  if (invoice.payee.email !== mandate.payee.email) {
    findings.push({
      kind: 'PAYEE_SHIFTED', severity: 'BLOCK',
      agreed: mandate.payee.email, billed: invoice.payee.email,
    });
  }
  if (invoice.currency !== mandate.currency) {
    findings.push({
      kind: 'CURRENCY_CHANGED', severity: 'BLOCK',
      agreed: mandate.currency, billed: invoice.currency,
    });
  }
  if (billedTotal > mandate.capCents) {
    findings.push({
      kind: 'OVER_CAP', severity: 'BLOCK',
      cap: fmt(mandate.capCents), billed: fmt(billedTotal),
    });
  }

  // --- line-by-line match --------------------------------------------------
  const mandateByName = new Map(mandate.lines.map((l) => [l.name, l]));
  const invoicedNames = new Set();
  const lineResults = [];
  for (const il of invoice.lines) {
    invoicedNames.add(il.name);
    const ml = mandateByName.get(il.name);
    if (!ml) {
      findings.push({ kind: 'UNEXPECTED_LINE', severity: 'BLOCK', item: il.name });
      lineResults.push({ item: il.name, status: 'UNEXPECTED', invoiced: il });
      continue;
    }
    const diffs = [];
    if (il.quantity !== ml.quantity) diffs.push('quantity');
    if (il.unitPriceCents !== ml.unitPriceCents) diffs.push('unitPrice');
    lineResults.push({
      item: il.name,
      status: diffs.length ? 'DRIFT' : 'MATCH',
      diffs,
      agreed: ml,
      invoiced: il,
      lineDriftCents: il.quantity * il.unitPriceCents - ml.quantity * ml.unitPriceCents,
    });
  }
  for (const ml of mandate.lines) {
    if (!invoicedNames.has(ml.name)) {
      findings.push({ kind: 'MISSING_LINE', severity: 'BLOCK', item: ml.name });
      lineResults.push({ item: ml.name, status: 'MISSING', agreed: ml });
    }
  }

  // --- payee memory context (facts for the receipt, never the verdict) ---
  const flags = memory ? memoryFlags(memory, invoice) : [];

  // --- verdict -------------------------------------------------------------
  const linesAllMatch = lineResults.every((l) => l.status === 'MATCH');
  const smallDrift = driftCents !== 0 && Math.abs(driftCents) <= mandate.totalCents * EXCEPTION_DRIFT_LIMIT;
  // Evidence completeness: whenever lines changed beyond the exception tier,
  // the receipt names it — even when a harder finding already decided BLOCK.
  if (!linesAllMatch && !smallDrift) {
    findings.push({ kind: 'LINES_CHANGED', severity: 'BLOCK', drift: fmtSigned(driftCents) });
  }
  let verdict;
  if (findings.some((f) => f.severity === 'BLOCK')) verdict = 'BLOCK';
  else if (linesAllMatch && driftCents === 0) verdict = 'MATCH';
  else if (smallDrift) verdict = 'EXCEPTION'; // any drifted line within ±5% of the total: the human decides
  else verdict = 'BLOCK';

  return {
    verdict,
    mandateId: mandate.id,
    mandateHash: mandate.hash,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    agreedTotal: fmt(mandate.totalCents),
    billedTotal: fmt(billedTotal),
    drift: fmtSigned(driftCents),
    driftCents,
    lines: lineResults,
    findings,
    memoryFlags: flags,
  };
}

// Repair — LOCKED differentiator #1: the seller fixes the drifted lines;
// the corrected document re-enters reconcile() against the same mandate
// (in production: against the still-open AUTHORIZE hold). A corrected
// invoice carries a NEW id/number — a repaired document is a new document,
// so the duplicate check can never punish an honest fix.
export function repairInvoice(invoice, { id, number, lines }) {
  return normalizeInvoice({
    id,
    number,
    payee: invoice.payee,
    currency: invoice.currency,
    lines: lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      unitPrice: fmt(l.unitPriceCents),
    })),
  });
}
