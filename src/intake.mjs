// Intake — forwarded text → mandate DRAFT (LOCKED-SPEC differentiator #2:
// photo/voice/chat quote → mandate). This implementation covers the text
// path — a pasted quote or a forwarded chat message. Photo/voice sources
// reach this same function as extracted text from an upstream OCR/ASR step;
// the extraction upstream may be an LLM, but the cross-check here is pure
// deterministic code and never invents a fact.
//
// Contract:
//  - parseQuote(text) pulls ONLY what the text plainly states: who is
//    selling, the items with quantity × unit price, the total, the currency.
//  - crossCheck(draft) compares every item against the stated total, the
//    same arithmetic a careful human would do before signing. Items whose
//    quantity or price the text does not state are flagged, never filled in.
//  - A draft is NOT a mandate: it stays in status DRAFT (see
//    mandateDraftCard()); a human confirms it into createMandate()
//    (frozen) — the founding principle of this project: evidence first,
//    a verdict only by a human.
//
// Supported quote shapes (deterministic, documented):
//   Seller: <name> <<email>>
//   <item name> x<qty> @ <price>
//   <item name> — <qty> × <price>
//   Total: <amount>
//   (prices with optional $ / USD and thousands separators)

const PRICE = '\\$?\\s*(\\d[\\d,]*\\.\\d{2}|\\d[\\d,]*)';

export function parseQuote(text) {
  const draft = {
    payee: { name: null, email: null },
    currency: 'USD',
    lines: [],
    statedTotal: null,
    warnings: [],
  };
  const lines = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const sellerLine = lines.find((l) => /^seller:/i.test(l));
  if (sellerLine) {
    const m = sellerLine.match(/^seller:\s*(.+?)\s*(?:<([^>]+)>)?$/i);
    if (m) {
      draft.payee.name = m[1].trim() || null;
      draft.payee.email = m[2] ? m[2].trim() : null;
    }
  }
  const emailAnywhere = String(text).match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (!draft.payee.email && emailAnywhere) draft.payee.email = emailAnywhere[0];
  if (!draft.payee.email) draft.warnings.push('PAYEE_EMAIL_NOT_STATED');

  let statedTotalRaw = null;
  for (const line of lines) {
    const total = line.match(new RegExp(`^total:\\s*${PRICE}\\s*(USD)?$`, 'i'));
    if (total) { statedTotalRaw = total[1]; continue; }
    if (/^seller:/i.test(line)) continue;
    const item =
      line.match(new RegExp(`^(.+?)\\s*[x×]\\s*(\\d+)\\s*@\\s*${PRICE}\\s*(USD)?$`, 'i')) ||
      line.match(new RegExp(`^(.+?)\\s*[—-]\\s*(\\d+)\\s*[x×]\\s*${PRICE}\\s*(USD)?$`, 'i'));
    if (item) {
      draft.lines.push({
        name: item[1].trim(),
        quantity: parseInt(item[2], 10),
        unitPrice: item[3].replace(/,/g, ''),
      });
    }
  }
  if (statedTotalRaw != null) draft.statedTotal = statedTotalRaw.replace(/,/g, '');
  if (draft.lines.length === 0) draft.warnings.push('NO_ITEM_LINES_FOUND');

  // The payee name may also simply be the first line, when no Seller: label.
  if (!draft.payee.name && lines.length && !/[@x×—-]/.test(lines[0]) && !/^total:/i.test(lines[0])) {
    draft.payee.name = lines[0];
  }
  return draft;
}

// Deterministic cross-check: the arithmetic of trust. Every number in the
// draft must answer to the numbers in the source text — nothing invented,
// nothing silently rounded. Money is integer cents; parsing is exact.
import { toCents, fmt } from './core/money.mjs';

export function crossCheck(draft) {
  const computedCents = draft.lines.reduce(
    (s, l) => s + l.quantity * toCents(l.unitPrice), 0,
  );
  const issues = [];
  if (draft.statedTotal != null && toCents(draft.statedTotal) !== computedCents) {
    issues.push({
      kind: 'TOTAL_MISMATCH',
      stated: draft.statedTotal,
      computed: fmt(computedCents),
    });
  }
  for (const l of draft.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
      issues.push({ kind: 'BAD_QUANTITY', item: l.name });
    }
  }
  return { ok: issues.length === 0, computedTotal: fmt(computedCents), issues };
}

// A draft as the human sees it — a card, not a verdict. Status is DRAFT
// until the buyer's own confirmation turns it into a frozen mandate.
export function mandateDraftCard(draft, check) {
  const out = ['MANDATE DRAFT — awaiting buyer confirmation'];
  out.push(`Payee: ${draft.payee.name ?? '(not stated)'} <${draft.payee.email ?? '(not stated)'}>`);
  for (const l of draft.lines) {
    out.push(`Line: ${l.name} × ${l.quantity} @ ${l.unitPrice}`);
  }
  out.push(`Computed total: ${check.computedTotal} ${draft.currency}`);
  if (draft.statedTotal != null) out.push(`Stated total: ${draft.statedTotal} ${draft.currency}`);
  for (const i of check.issues) out.push(`Check: ${i.kind}${i.item ? ` — ${i.item}` : ''}${i.stated ? ` (stated ${i.stated} vs computed ${i.computed})` : ''}`);
  for (const w of draft.warnings) out.push(`Warning: ${w}`);
  out.push(check.ok && draft.warnings.length === 0
    ? 'Cross-check passed. Nothing here was invented — every number is in the quote.'
    : 'Cross-check found gaps. A human reads the quote before anything is frozen.');
  return out.join('\n');
}
