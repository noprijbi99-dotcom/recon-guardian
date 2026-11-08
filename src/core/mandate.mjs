// Mandate — the frozen agreement (DESIGN-PHILOSOPHY §7 vocabulary: Mandate).
// Canonical JSON + SHA-256 (per LOCKED-SPEC correction #5: mirror AP2's
// separation of intent / cart / payment, but not its signing stack —
// canonical JSON + own hash suffices here).
// A mandate is shown to the human and confirmed BEFORE activation; once
// frozen its hash is the identity every later invoice must answer to.
import { createHash } from 'node:crypto';
import { toCents, fmt } from './money.mjs';

// Stable canonical form: object keys sorted recursively, amounts in cents.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

export function mandateHash(mandate) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(mandate)))
    .digest('hex');
}

// Build a mandate from an agreed document (shape = demo/fixtures input).
// Lines: { name, quantity, unitPrice: "200.00" }. Amounts become cents here.
export function createMandate(doc) {
  const lines = doc.lines.map((l) => ({
    name: l.name,
    quantity: l.quantity,
    unitPriceCents: toCents(l.unitPrice),
  }));
  const totalCents = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  const mandate = {
    id: doc.id,
    payee: { name: doc.payee.name, email: doc.payee.email },
    currency: doc.currency || 'USD',
    lines,
    totalCents,
    capCents: doc.cap != null ? toCents(doc.cap) : totalCents,
    source: doc.source, // where the agreement came from — stated, never hidden
    status: 'FROZEN', // shown to and confirmed by the human before activation
  };
  mandate.hash = mandateHash(mandateCore(mandate));
  return mandate;
}

// The hashable core — status/hash fields are not part of the promise itself.
export function mandateCore(m) {
  return {
    id: m.id,
    payee: m.payee,
    currency: m.currency,
    lines: m.lines,
    totalCents: m.totalCents,
    capCents: m.capCents,
    source: m.source,
  };
}

// Integrity check: recompute and compare. Money moves only for what is proven.
export function verifyMandate(m) {
  return mandateHash(mandateCore(m)) === m.hash;
}

export function mandateTotal(m) {
  return fmt(m.totalCents);
}
