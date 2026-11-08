// Core tests — every verdict path of the guardian, on the mock backend.
// Run: npm test   (node --test, no dependencies)
// Philosophy §1 discipline: a test that cannot fail is not a test — each
// case asserts the verdict AND the money state (released / not released).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMandate, verifyMandate } from '../src/core/mandate.mjs';
import { normalizeInvoice, reconcile } from '../src/core/reconcile.mjs';
import { emptyMemory, learnInvoice, memoryFlags } from '../src/core/payee-memory.mjs';
import { settleBackend } from '../src/core/settle.mjs';
import { createGuardian } from '../src/core/guardian.mjs';
import { MANDATE_DOC, INVOICE_DRIFTED, REPAIR } from '../src/fixtures/demo-fixtures.mjs';
import { toCents, fmt } from '../src/core/money.mjs';

const mandate = () => createMandate(MANDATE_DOC);
const inv = (doc) => normalizeInvoice(doc);
const exactInvoice = (over = {}) => inv({
  id: 'INV-EXACT-1', number: '2001',
  payee: MANDATE_DOC.payee, currency: 'USD',
  lines: [{ name: 'Logo design', quantity: 1, unitPrice: '200.00' }],
  ...over,
});

test('money: exact cents, no float drift', () => {
  assert.equal(toCents('200.00'), 20000);
  assert.equal(toCents('0.10') + toCents('0.20'), toCents('0.30'));
  assert.equal(fmt(26000), '260.00');
  assert.throws(() => toCents('1.005'), /BAD_MONEY_STRING/);
});

test('mandate: hash verifies; tampering breaks it', () => {
  const m = mandate();
  assert.equal(verifyMandate(m), true);
  const evil = structuredClone(m);
  evil.lines[0].unitPriceCents = 1;
  assert.equal(verifyMandate(evil), false);
});

test('reconcile: exact invoice → MATCH', () => {
  const r = reconcile(mandate(), exactInvoice(), {});
  assert.equal(r.verdict, 'MATCH');
  assert.equal(r.drift, '0.00');
});

test('reconcile: canon drift $200 → $260 → BLOCK, over cap + lines changed', () => {
  const r = reconcile(mandate(), inv(INVOICE_DRIFTED), {});
  assert.equal(r.verdict, 'BLOCK');
  assert.equal(r.drift, '+60.00');
  assert.ok(r.findings.some((f) => f.kind === 'OVER_CAP'));
  assert.ok(r.findings.some((f) => f.kind === 'LINES_CHANGED'));
});

test('reconcile: small drift (+4%) under a higher cap → EXCEPTION (human decides)', () => {
  const m = createMandate({ ...MANDATE_DOC, cap: '300.00' });
  const r = reconcile(m, exactInvoice({ lines: [{ name: 'Logo design', quantity: 1, unitPrice: '208.00' }] }), {});
  assert.equal(r.verdict, 'EXCEPTION');
  assert.equal(r.drift, '+8.00');
});

test('reconcile: zero-total drift but a changed line (qty 2 × $100 for qty 1 × $200) → BLOCK', () => {
  const m = createMandate({ ...MANDATE_DOC, cap: '300.00' });
  const r = reconcile(m, exactInvoice({ lines: [{ name: 'Logo design', quantity: 2, unitPrice: '100.00' }] }), {});
  assert.equal(r.drift, '0.00');
  assert.equal(r.verdict, 'BLOCK');
  assert.ok(r.findings.some((f) => f.kind === 'LINES_CHANGED'));
});

test('reconcile: duplicate invoice id → BLOCK', () => {
  const seen = new Set(['INV-EXACT-1']);
  const r = reconcile(mandate(), exactInvoice(), { seenInvoiceIds: seen });
  assert.equal(r.verdict, 'BLOCK');
  assert.ok(r.findings.some((f) => f.kind === 'DUPLICATE_INVOICE'));
});

test('reconcile: payee shifted → BLOCK', () => {
  const r = reconcile(mandate(), exactInvoice({ payee: { name: 'Other', email: 'other@example.com' } }), {});
  assert.equal(r.verdict, 'BLOCK');
  assert.ok(r.findings.some((f) => f.kind === 'PAYEE_SHIFTED'));
});

test('reconcile: unexpected line → BLOCK', () => {
  const r = reconcile(mandate(), exactInvoice({
    lines: [
      { name: 'Logo design', quantity: 1, unitPrice: '200.00' },
      { name: 'Rush fee', quantity: 1, unitPrice: '25.00' },
    ],
  }), {});
  assert.equal(r.verdict, 'BLOCK');
  assert.ok(r.findings.some((f) => f.kind === 'UNEXPECTED_LINE'));
});

test('payee memory: first invoice flags NEW_PAYEE; learned prices flag new prices', () => {
  const mem = emptyMemory();
  assert.equal(memoryFlags(mem, exactInvoice())[0].kind, 'NEW_PAYEE');
  learnInvoice(mem, exactInvoice());
  assert.deepEqual(memoryFlags(mem, exactInvoice()), []);
  const drifted = memoryFlags(mem, inv(INVOICE_DRIFTED));
  assert.ok(drifted.some((f) => f.kind === 'PRICE_NOT_SEEN_BEFORE'));
});

test('guardian: canon story end-to-end — BLOCK, repair, MATCH, release $200.00 only', async () => {
  const m = mandate();
  const g = createGuardian({ backend: settleBackend('mock'), memory: emptyMemory() });
  const hold = await g.openHold(m);
  assert.equal(hold.heldCents, 20000);

  const blocked = await g.processInvoice(m, inv(INVOICE_DRIFTED));
  assert.equal(blocked.verdict, 'BLOCK');
  assert.match(blocked.driftReceipt, /DRIFT RECEIPT/);
  assert.match(blocked.driftReceipt, /unit price 200\.00 → 260\.00/);

  const repaired = await g.repairAndReprocess(m, inv(INVOICE_DRIFTED), REPAIR);
  assert.equal(repaired.verdict, 'MATCH');
  assert.equal(repaired.settlement.releasedCents, 20000);
  assert.equal(repaired.settlement.remainderCents, 0);
  assert.match(repaired.receipt, /RECEIPT/);
});

test('guardian: EXCEPTION holds for the human; approval releases the billed amount', async () => {
  const m = createMandate({ ...MANDATE_DOC, cap: '300.00' });
  const g = createGuardian({ backend: settleBackend('mock'), memory: emptyMemory() });
  await g.openHold(m);
  const invoice = exactInvoice({ lines: [{ name: 'Logo design', quantity: 1, unitPrice: '208.00' }] });
  const ex = await g.processInvoice(m, invoice);
  assert.equal(ex.verdict, 'EXCEPTION');
  assert.equal(ex.awaiting, 'HUMAN_DECISION');
  assert.match(ex.driftReceipt, /DRIFT RECEIPT/); // the human decides with evidence, never blind
  const done = await g.resolveException(m, invoice, { approve: true });
  assert.equal(done.verdict, 'EXCEPTION_APPROVED');
  assert.equal(done.settlement.releasedCents, 20800);
});

test('guardian: the same invoice twice — the copy is a duplicate BLOCK, no double release', async () => {
  const m = mandate();
  const g = createGuardian({ backend: settleBackend('mock'), memory: emptyMemory() });
  await g.openHold(m);
  const invoice = exactInvoice();
  const first = await g.processInvoice(m, invoice);
  assert.equal(first.verdict, 'MATCH');
  const second = await g.processInvoice(m, invoice);
  assert.equal(second.verdict, 'BLOCK');
  assert.ok(second.result.findings.some((f) => f.kind === 'DUPLICATE_INVOICE'));
});
