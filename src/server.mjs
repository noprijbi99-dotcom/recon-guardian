// Reconciliation Guardian — demo server (stage 6 build).
//
// A dependency-free Node http server that puts a face on the core:
//   /            the buyer's console — the canon story as a guided flow:
//                mandate card (frozen, hashed) → hold → drifted invoice →
//                BLOCK + drift receipt → seller repair link → MATCH →
//                joined receipt.
//   /repair/<t>  the seller's repair door (LOCKED differentiator #1): a
//                public page, no install, no login, bound by an unguessable
//                token to ONE blocked invoice of ONE mandate. The seller
//                corrects the drifted lines; the corrected invoice
//                re-enters reconcile() against the same open hold.
//
// Backend is switchable: mock by default (in-memory ledger, MOCK-prefixed
// IDs, labelled everywhere the money appears). Set BACKEND=live only on a
// host whose PayPal credentials are properly in place (config.mjs / .env).
// Honest limit of the live path from THIS server: an AUTHORIZE hold only
// becomes capturable after the buyer approves the order in PayPal's
// checkout — a step this demo server does not perform (in the proven live
// runs it was the owner's own approval, via the Termux harness). Every
// page states which backend settled it.
//
// Sessions are in-memory (demo scope). Tokens are crypto-random 128-bit,
// single-mandate-bound, and die with the session.
//
// Run:  node src/server.mjs        (PORT env, default 4173)
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createMandate, verifyMandate } from './core/mandate.mjs';
import { normalizeInvoice } from './core/reconcile.mjs';
import { emptyMemory } from './core/payee-memory.mjs';
import { settleBackend } from './core/settle.mjs';
import { createGuardian } from './core/guardian.mjs';
import { fmt, toCents } from './core/money.mjs';
import { parseQuote, crossCheck, mandateDraftCard } from './intake.mjs';
import { MANDATE_DOC, INVOICE_DRIFTED, REPAIR } from './fixtures/demo-fixtures.mjs';

const PORT = process.env.PORT || 4173;
const BACKEND_KIND = process.env.BACKEND === 'live' ? 'live' : 'mock';

const sessions = new Map(); // sessionId -> session
const repairs = new Map(); // token -> { sessionId, invoice }

// --- helpers ---------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function newSession() {
  const mandate = createMandate(MANDATE_DOC);
  const session = {
    id: randomUUID(),
    mandate,
    guardian: createGuardian({ backend: settleBackend(BACKEND_KIND), memory: emptyMemory() }),
    hold: null,
    blocked: null, // { invoice, outcome }
    repaired: null, // outcome
    repairToken: null,
  };
  sessions.set(session.id, session);
  return session;
}

function getSession(req) {
  const cookie = (req.headers.cookie || '').match(/rg_session=([\w-]+)/);
  if (cookie && sessions.has(cookie[1])) return sessions.get(cookie[1]);
  return null;
}

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Reconciliation Guardian</title>
<style>
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0e1512;color:#e8f0ea;
       margin:0;padding:24px 16px 64px;display:flex;flex-direction:column;align-items:center}
  main{width:100%;max-width:720px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:24px 0 8px;color:#9fd8ae}
  .sub{color:#8aa393;font-size:13px;margin-bottom:16px}
  .card{background:#16211a;border:1px solid #26382c;border-radius:12px;padding:16px 18px;margin:12px 0}
  .verdict{font-weight:700;letter-spacing:.04em}
  .block{color:#ff9c8a}.match{color:#8fe3a8}.hold{color:#ffd98a}
  pre{white-space:pre-wrap;word-break:break-word;background:#0b100d;border-radius:8px;
      padding:12px;font-size:12.5px;line-height:1.5;overflow-x:auto}
  button,input[type=submit]{background:#2e7d46;color:#fff;border:0;border-radius:8px;
      padding:10px 16px;font-size:14px;cursor:pointer}
  button.secondary{background:#243528;color:#cfe6d4}
  input[type=text],input[type=number]{background:#0b100d;color:#e8f0ea;border:1px solid #33503c;
      border-radius:6px;padding:8px;width:110px}
  table{border-collapse:collapse;width:100%} td,th{padding:6px 8px;border-bottom:1px solid #223128;
      text-align:left;font-size:14px}
  .badge{display:inline-block;border:1px solid #33503c;border-radius:999px;padding:2px 10px;
      font-size:12px;color:#bcd8c2}
  a{color:#8fe3a8}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
</style></head><body><main>${body}</main></body></html>`;

const backendBadge = () =>
  `<span class="badge">backend: ${BACKEND_KIND}${BACKEND_KIND === 'mock' ? ' — in-memory demo ledger, no real money, IDs are MOCK-prefixed' : ' — PayPal Sandbox'}</span>`;

// --- buyer's console ---------------------------------------------------------
function consolePage(session, extra = '') {
  const m = session.mandate;
  const lines = m.lines.map((l) =>
    `<tr><td>${esc(l.name)}</td><td>× ${l.quantity}</td><td>${fmt(l.unitPriceCents)}</td><td>${fmt(l.quantity * l.unitPriceCents)}</td></tr>`).join('');
  let flow = '';
  if (!session.hold) {
    flow = `<form method="post" action="/hold"><button>Open the hold — ${fmt(m.capCents)} ${m.currency}</button></form>`;
  } else if (!session.blocked) {
    flow = `<div class="card"><span class="verdict hold">HOLD ${esc(session.hold.holdId)}</span>
      — ${fmt(session.hold.heldCents)} ${m.currency} held against the mandate. Not paid. Waiting for proof.</div>
      <form method="post" action="/invoice"><button>Simulate the seller's invoice arriving — billed 260.00</button></form>`;
  } else if (!session.repaired) {
    const b = session.blocked;
    flow = `<div class="card"><span class="verdict block">VERDICT ${esc(b.outcome.verdict)} — nothing has been paid.</span>
      <pre>${esc(b.outcome.driftReceipt)}</pre>
      <p>The seller does not need an account or an install. The drift receipt is the invitation:</p>
      <p><a href="/repair/${esc(session.repairToken)}">Open the seller repair link</a>
      <span class="sub">(in the video, the seller opens this on their own phone)</span></p></div>`;
  } else {
    flow = `<div class="card"><span class="verdict match">VERDICT ${esc(session.repaired.verdict)} — the verified amount was released.</span>
      <pre>${esc(session.repaired.receipt)}</pre>
      <p>The hold is closed. Agreed 200.00, billed first 260.00, repaired to 200.00, released exactly 200.00.</p></div>`;
  }
  return page('Buyer console', `
    <h1>Reconciliation Guardian</h1>
    <div class="sub">An agent holds money against the agreement — and answers to it.</div>
    ${backendBadge()}
    <h2>Mandate ${esc(m.id)} — frozen and confirmed by the buyer</h2>
    <div class="card"><table>
      <tr><th>Payee</th><td>${esc(m.payee.name)} &lt;${esc(m.payee.email)}&gt;</td></tr>
      <tr><th>Source</th><td>${esc(m.source)}</td></tr>
      <tr><th>Hash</th><td><code>${esc(m.hash)}</code></td></tr>
      <tr><th>Integrity</th><td>${verifyMandate(m) ? 'verified — the frozen agreement still answers to its hash' : 'MISMATCH'}</td></tr>
    </table>
    <table><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr>${lines}
      <tr><td colspan="3"><b>Agreed total · cap</b></td><td><b>${fmt(m.totalCents)} ${m.currency}</b></td></tr>
    </table></div>
    ${flow}
    ${extra}
    <h2>Intake — a forwarded quote becomes a draft</h2>
    <div class="card"><p class="sub">Paste a quote or a forwarded chat message. The draft is cross-checked
    arithmetically before a human ever sees a mandate card — nothing is invented.</p>
    <form method="post" action="/intake">
      <textarea name="quote" rows="5" style="width:100%;background:#0b100d;color:#e8f0ea;border:1px solid #33503c;border-radius:6px;padding:8px">Seller: Sari Design Studio &lt;sb-3dnvs5377337@business.example.com&gt;
Logo design x1 @ 200.00
Total: 200.00</textarea>
      <p><input type="submit" value="Draft the mandate"></p>
    </form></div>
    <p><form method="post" action="/reset"><button class="secondary">Reset the demo</button></form></p>
  `);
}

// --- seller repair page -------------------------------------------------------
function repairPage(session, token, note = '') {
  const b = session.blocked;
  const inv = b.invoice;
  const rows = inv.lines.map((l, i) => `
    <tr><td>${esc(l.name)}</td><td>${l.quantity}</td>
    <td><input type="number" step="0.01" min="0" name="price_${i}" value="${fmt(l.unitPriceCents)}"></td></tr>`).join('');
  return page('Repair your invoice', `
    <h1>One line needs your fix</h1>
    <div class="sub">Invoice ${esc(inv.number)} against mandate ${esc(session.mandate.id)}.
    Nothing has been paid. Correct the line and the hold releases on match.</div>
    ${backendBadge()}
    <div class="card"><pre>${esc(b.outcome.driftReceipt)}</pre></div>
    ${note}
    <div class="card"><form method="post" action="/repair/${esc(token)}">
      <table><tr><th>Item</th><th>Qty</th><th>Your corrected unit price</th></tr>${rows}</table>
      <p><input type="submit" value="Send the corrected invoice"></p>
    </form></div>
    <p class="sub">This link opens one invoice of one mandate. It expires with the hold.</p>
  `);
}

// --- server -------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (html, status = 200, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(html);
  };
  const readBody = () => new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(new URLSearchParams(data)));
  });

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      let session = getSession(req);
      if (!session) {
        session = newSession();
        return send(consolePage(session), 200, { 'set-cookie': `rg_session=${session.id}; Path=/; HttpOnly` });
      }
      return send(consolePage(session));
    }

    if (req.method === 'POST' && url.pathname === '/reset') {
      const old = getSession(req);
      if (old) sessions.delete(old.id);
      const session = newSession();
      return send(consolePage(session), 200, { 'set-cookie': `rg_session=${session.id}; Path=/; HttpOnly` });
    }

    if (req.method === 'POST' && url.pathname === '/hold') {
      const session = getSession(req);
      if (!session) return send('No session — open / first.', 400);
      if (!session.hold) session.hold = await session.guardian.openHold(session.mandate);
      return send(consolePage(session));
    }

    if (req.method === 'POST' && url.pathname === '/invoice') {
      const session = getSession(req);
      if (!session || !session.hold) return send('Open the hold first.', 400);
      if (!session.blocked) {
        const invoice = normalizeInvoice(INVOICE_DRIFTED);
        const outcome = await session.guardian.processInvoice(session.mandate, invoice);
        session.repairToken = randomBytes(16).toString('hex');
        session.blocked = { invoice, outcome };
        repairs.set(session.repairToken, { sessionId: session.id, invoice });
      }
      return send(consolePage(session));
    }

    if (req.method === 'POST' && url.pathname === '/intake') {
      const session = getSession(req) || newSession();
      const body = await readBody();
      const draft = parseQuote(body.get('quote') || '');
      const check = crossCheck(draft);
      const card = `<div class="card"><pre>${esc(mandateDraftCard(draft, check))}</pre></div>`;
      return send(consolePage(session, card));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/repair/')) {
      const token = url.pathname.slice('/repair/'.length);
      const entry = repairs.get(token);
      if (!entry) return send(page('Link expired', '<h1>This repair link is no longer open.</h1><p class="sub">Repair links are bound to one invoice and expire with the hold.</p>'), 404);
      const session = sessions.get(entry.sessionId);
      if (!session || session.repaired) return send(page('Already settled', '<h1>This invoice has already been settled.</h1>'), 410);
      return send(repairPage(session, token));
    }

    if (req.method === 'POST' && url.pathname.startsWith('/repair/')) {
      const token = url.pathname.slice('/repair/'.length);
      const entry = repairs.get(token);
      if (!entry) return send('Link expired.', 404);
      const session = sessions.get(entry.sessionId);
      if (!session || session.repaired) return send('Already settled.', 410);
      const body = await readBody();
      const lines = entry.invoice.lines.map((l, i) => {
        const raw = body.get(`price_${i}`);
        const cents = raw == null || raw === '' ? l.unitPriceCents : toCents(raw);
        return { name: l.name, quantity: l.quantity, unitPriceCents: cents };
      });
      const n = 1043 + session.guardian.receipts.length;
      const repair = { id: `INV-SARI-${n}`, number: String(n), lines };
      const outcome = await session.guardian.repairAndReprocess(session.mandate, entry.invoice, repair);
      if (outcome.verdict === 'MATCH') {
        session.repaired = outcome;
        repairs.delete(token); // the door closes once the hold settles
        return send(page('Repaired', `
          <h1>Thank you — your corrected invoice matches the agreement.</h1>
          <div class="card"><pre>${esc(outcome.receipt)}</pre></div>
          <p class="sub">The buyer sees the same receipt. Nothing more is owed on this invoice.</p>`));
      }
      // Still not a match: the seller stays on the door with a fresh receipt.
      session.blocked = { invoice: repairInvoiceDoc(entry.invoice, repair), outcome };
      return send(repairPage(session, token,
        `<div class="card"><span class="verdict block">Still ${esc(outcome.verdict)} — nothing has been paid.</span></div>`));
    }

    return send('Not found', 404);
  } catch (err) {
    return send(page('Something stopped', `<h1>The guardian stopped.</h1><pre>${esc(err.message)}</pre>`), 500);
  }
});

// A repaired-but-still-blocked invoice becomes the new document on the door.
function repairInvoiceDoc(original, repair) {
  return normalizeInvoice({
    id: repair.id,
    number: repair.number,
    payee: original.payee,
    currency: original.currency,
    lines: repair.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: fmt(l.unitPriceCents) })),
  });
}

server.listen(PORT, () => {
  console.log(`Reconciliation Guardian demo — http://localhost:${PORT} (backend: ${BACKEND_KIND})`);
});
