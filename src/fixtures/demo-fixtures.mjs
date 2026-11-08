// Demo fixtures — the locked canon example (LOCKED-SPEC demo script):
// agreement $200 (logo design) → invoice arrives $260 (unit price quietly
// shifted $200 → $260, quantity stays 1) → BLOCK + drift receipt → seller
// repairs the line → corrected invoice $200 → re-verify → Release.
// Sandbox accounts are ours on both sides (LOCKED-SPEC flow step 3).

export const MANDATE_DOC = {
  id: 'M-2026-001',
  payee: { name: 'Sari Design Studio', email: 'sb-3dnvs5377337@business.example.com' },
  currency: 'USD',
  source: 'photo of a paper quote, confirmed by the buyer',
  lines: [{ name: 'Logo design', quantity: 1, unitPrice: '200.00' }],
  cap: '200.00',
};

export const INVOICE_DRIFTED = {
  id: 'INV-SARI-1042',
  number: '1042',
  payee: { name: 'Sari Design Studio', email: 'sb-3dnvs5377337@business.example.com' },
  currency: 'USD',
  lines: [{ name: 'Logo design', quantity: 1, unitPrice: '260.00' }],
};

// The seller's repair: same payee, same item, unit price corrected back to
// the agreed $200. A repaired invoice is a NEW document (new id + number).
export const REPAIR = {
  id: 'INV-SARI-1043',
  number: '1043',
  lines: [{ name: 'Logo design', quantity: 1, unitPriceCents: 20000 }],
};
