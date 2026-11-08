// Intake tests — the deterministic quote parser + cross-check.
// Discipline (project philosophy): the parser may only state what the text
// states. Each test asserts a number the text does NOT contain is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuote, crossCheck } from '../src/intake.mjs';

const CANON = `Seller: Sari Design Studio <sb-3dnvs5377337@business.example.com>
Logo design x1 @ 200.00
Total: 200.00`;

test('intake: canon quote parses to the exact draft', () => {
  const d = parseQuote(CANON);
  assert.equal(d.payee.name, 'Sari Design Studio');
  assert.equal(d.payee.email, 'sb-3dnvs5377337@business.example.com');
  assert.equal(d.lines.length, 1);
  assert.deepEqual(d.lines[0], { name: 'Logo design', quantity: 1, unitPrice: '200.00' });
  assert.equal(d.statedTotal, '200.00');
  assert.equal(d.warnings.length, 0);
});

test('intake: cross-check passes when the arithmetic agrees', () => {
  const c = crossCheck(parseQuote(CANON));
  assert.equal(c.ok, true);
  assert.equal(c.computedTotal, '200.00');
});

test('intake: a stated total that disagrees is flagged, never "fixed"', () => {
  const d = parseQuote(CANON.replace('Total: 200.00', 'Total: 260.00'));
  const c = crossCheck(d);
  assert.equal(c.ok, false);
  assert.equal(c.issues[0].kind, 'TOTAL_MISMATCH');
  assert.equal(c.issues[0].computed, '200.00');
});

test('intake: multi-line quote with quantities and $ signs', () => {
  const d = parseQuote(`Seller: Budi Print <budi@example.com>
Banner printing x2 @ $45.00
Delivery — 1 × $10.00
Total: $100.00`);
  assert.equal(d.lines.length, 2);
  assert.equal(d.lines[1].name, 'Delivery');
  assert.equal(crossCheck(d).ok, true);
});

test('intake: missing email is a warning, never an invention', () => {
  const d = parseQuote('Logo design x1 @ 200.00');
  assert.equal(d.payee.email, null);
  assert.ok(d.warnings.includes('PAYEE_EMAIL_NOT_STATED'));
});

test('intake: prose without item lines yields no invented lines', () => {
  const d = parseQuote('Hi, I can do the logo for two hundred dollars, thanks!');
  assert.equal(d.lines.length, 0);
  assert.ok(d.warnings.includes('NO_ITEM_LINES_FOUND'));
});
