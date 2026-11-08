# Reconciliation Guardian

**An agent holds money against what was agreed — and answers to it.**

Buyer-side protection for informal trade. A seller quotes a price in a
chat; the buyer agrees; days later an invoice arrives that does not match
the agreement. The Guardian freezes the agreement as a **mandate**, holds
exactly the capped amount (PayPal Orders v2, `AUTHORIZE` — a hold, not a
payment), then makes the arriving invoice **answer to the mandate** line
by line before any money moves.

- Exact match → the verified amount is released on its own.
- Small drift (≤ 5% of the total) → the money waits; a human decides,
  with the drift receipt as evidence.
- Anything harder (duplicate, payee shifted, over cap, changed lines) →
  BLOCK. Nothing moves, and the seller receives a **repairable drift
  receipt**: a no-install link where they correct the drifted line; the
  corrected invoice re-enters the same check against the still-open hold.

No LLM ever touches verification or money movement. Money moves only in
deterministic code (`src/core/`), and money tools are never registered
with any model.

## Run the demo locally (mock backend)

```sh
npm test            # 19 tests, zero dependencies
npm run demo:local  # the canon story in a terminal
node src/server.mjs # the buyer console + seller repair door (PORT 4173)
```

The mock backend is an in-memory ledger; its IDs are always
`MOCK-`prefixed and every screen labels the backend. Mock money is never
presented as PayPal money.

## Live settlement (PayPal Sandbox) — proven, with an honest split

The settlement chain — OAuth token → order → buyer approval → AUTHORIZE
hold → capture of the verified amount → read-back — has run **live twice**
on PayPal Sandbox (2026-11-08; both chains COMPLETED; order /
authorization / capture IDs recorded in the project proof files).

Two lanes exist because of one fact we will not decorate: a
credential-capture fault in our tooling kept the API secret from reaching
the build server intact. So:

- **Product lane (this repo):** the guardian core + `src/paypal-rest/`
  raw-REST client (Orders v2 authorize / capture / void), switchable
  backends (`BACKEND=mock|live`) behind one interface.
- **Owner lane (harness scripts):** `termux_finish_demo.py` runs the same
  raw REST calls from the owner's own phone — the secret is typed there
  via getpass, never stored, never transmitted. Approval is the owner's
  tap as the Sandbox buyer.

Field rule learned live (three rejected runs): this merchant account
rejects **any** `invoice_id` in the authorize chain as a duplicate — so
no `invoice_id` is ever sent; the mandate's number travels as a
`reference_id` label. The invoice *document* is still verified by the
guardian; the on-PayPal trail is order / authorization / capture IDs.

## Layout

- `src/core/` — money (integer cents), mandate (canonical JSON + SHA-256
  freeze), reconcile (MATCH / EXCEPTION / BLOCK), payee memory, receipts,
  settle (mock + live backends), guardian (the only money path).
- `src/intake.mjs` — deterministic quote → mandate-draft parser with an
  arithmetic cross-check. It invents nothing: a stated total that
  disagrees with the lines is flagged, never silently fixed.
- `src/server.mjs` — dependency-free demo server: buyer console, guided
  canon flow, seller repair door (unguessable token, bound to one
  invoice, dies when the hold settles), intake form.
- `src/paypal-rest/` — the raw REST client; `npm run token` smoke-tests
  credentials without ever printing them.
- `termux_*.py` — owner-lane harness + credential self-tests (stdlib
  only). `termux_token_test.py` is local-only by `.gitignore`.

## What is NOT here

- Credential probe scripts from the vault diagnosis (`.gitignore`d —
  they exist only on the build machine).
- `.env` (never committed; `.env.example` shows the shape).

License: MIT.
