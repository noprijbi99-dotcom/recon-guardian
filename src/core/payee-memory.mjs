// Payee memory — LOCKED differentiator #3 (feature moment, never the headline).
// A per-supplier billing profile: what this payee normally bills, at what
// cadence, at which prices. It feeds reconcile() as CONTEXT for drift —
// it never decides alone; the mandate decides, memory informs.
// (DESIGN-PHILOSOPHY §1: evidence, not verdicts — a flag is a fact to show,
// never an accusation.)

// profiles: { [payeeEmail]: { name, history: [{ item, unitPriceCents, invoices }] } }
export function emptyMemory() {
  return { profiles: {} };
}

export function learnInvoice(memory, invoice) {
  const p = (memory.profiles[invoice.payee.email] ??= {
    name: invoice.payee.name,
    seenInvoices: [],
    itemPrices: {},
  });
  p.seenInvoices.push(invoice.id);
  for (const l of invoice.lines) {
    const prices = (p.itemPrices[l.name] ??= []);
    if (!prices.includes(l.unitPriceCents)) prices.push(l.unitPriceCents);
  }
  return memory;
}

// Flags for reconcile(): first-time payee, and items this payee has never
// billed at the invoiced price before. Facts only.
export function memoryFlags(memory, invoice) {
  const p = memory.profiles[invoice.payee.email];
  if (!p) return [{ kind: 'NEW_PAYEE', payee: invoice.payee.email }];
  const flags = [];
  for (const l of invoice.lines) {
    const known = p.itemPrices[l.name] || [];
    if (known.length && !known.includes(l.unitPriceCents)) {
      flags.push({
        kind: 'PRICE_NOT_SEEN_BEFORE',
        item: l.name,
        seenPricesCents: known,
        invoicedPriceCents: l.unitPriceCents,
      });
    }
  }
  return flags;
}
