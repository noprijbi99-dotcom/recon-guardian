// Local end-to-end demo — the LOCKED canon story, on the MOCK backend
// (in-memory ledger; IDs are MOCK-prefixed and are never presented as
// PayPal records — DESIGN-PHILOSOPHY §1, §3).
//   Paper-quote agreement $200 → Mandate frozen → Hold opened →
//   invoice $260 arrives (unit price drifted) → BLOCK + drift receipt →
//   seller repairs the line via the receipt → corrected invoice $200 →
//   Match → Release $200.00, remainder $0.00 → joined Receipt.
// The same orchestrator code runs against the live Sandbox backend; the
// proven live harness today is the owner-run Termux lane
// (termux_finish_demo.py), and the server switches with BACKEND=live
// wherever credentials are properly in place.
import { createMandate } from '../src/core/mandate.mjs';
import { normalizeInvoice } from '../src/core/reconcile.mjs';
import { emptyMemory } from '../src/core/payee-memory.mjs';
import { settleBackend } from '../src/core/settle.mjs';
import { createGuardian } from '../src/core/guardian.mjs';
import { MANDATE_DOC, INVOICE_DRIFTED, REPAIR } from '../src/fixtures/demo-fixtures.mjs';
import { fmt } from '../src/core/money.mjs';

const line = (s = '') => console.log(s);

line('=== RECONCILIATION GUARDIAN — local demo (mock backend) ===');
line();

const mandate = createMandate(MANDATE_DOC);
line(`MANDATE ${mandate.id} — frozen and confirmed by the buyer`);
line(`  payee   ${mandate.payee.name} <${mandate.payee.email}>`);
for (const l of mandate.lines) line(`  line    ${l.name} × ${l.quantity} @ ${fmt(l.unitPriceCents)}`);
line(`  total   ${fmt(mandate.totalCents)} ${mandate.currency} · cap ${fmt(mandate.capCents)}`);
line(`  source  ${mandate.source}`);
line(`  hash    ${mandate.hash}`);
line();

const guardian = createGuardian({ backend: settleBackend('mock'), memory: emptyMemory() });
const hold = await guardian.openHold(mandate);
line(`HOLD ${hold.holdId} — ${fmt(hold.heldCents)} held against the mandate. Not paid. Waiting for proof.`);
line();

const drifted = normalizeInvoice(INVOICE_DRIFTED);
const blocked = await guardian.processInvoice(mandate, drifted);
line(`INVOICE ${drifted.number} arrives — billed ${blocked.result.billedTotal} vs agreed ${blocked.result.agreedTotal}`);
line(`VERDICT ${blocked.verdict} — nothing has been paid.`);
line();
line(blocked.driftReceipt);
line();

const repaired = await guardian.repairAndReprocess(mandate, drifted, REPAIR);
line(`REPAIRED INVOICE ${REPAIR.number} re-checked against the same mandate…`);
line(`VERDICT ${repaired.verdict}`);
line();
line(repaired.receipt);
line();
line('=== demo complete: hold → drift caught → repaired → release of the verified amount only ===');
