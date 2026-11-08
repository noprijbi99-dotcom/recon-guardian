#!/usr/bin/env python3
# Live demo Reconciliation Guardian — dijalankan di Termux HP pemilik akun.
# Pola yang sama dengan termux_token_test.py (yang sudah terbukti STATUS 200):
# Secret TIDAK tertulis di file ini; diketik/paste sendiri oleh pemilik
# saat script jalan (getpass, tidak tampil di layar), dan tidak pernah
# meninggalkan HP. Token + secret TIDAK PERNAH di-print.
#
# Yang dilakukan (Sandbox, play money only):
#   1. Minta OAuth token (bukti kredensial hidup)
#   2. Buat order AUTHORIZE $200.00 (HOLD atas mandat — bukan bayar)
#      invoice INV-DEMO-001, contoh kanonik dari stage-1 core
#   3. Baca ulang order dari PayPal dan tampilkan status + jumlah
#      dari catatan PayPal sendiri (bukan dari input kita)
# Catatan: order AUTHORIZE baru berstatus APPROVED setelah payer approve
# lewat checkout flow; tahap ini memverifikasi pembuatan + read-back,
# sama seperti scripts/demo-authorize.mjs di VM.
#
# Cara jalanin di Termux (sama seperti token test kemarin):
#   python3 termux_live_demo.py
# lalu ketik/paste Secret key 1 saat diminta (getpass).

import urllib.request, urllib.parse, urllib.error, base64, json, getpass, uuid

CID = "BAAH9drR8_7pxQOi3ZlfTZKUvzVLA2jbwhZQNuqk0_Fcv4r3N3r4d42N-I3eXodXeWliLoCS5ZGSL67sq8"
BASE = "https://api-m.sandbox.paypal.com"

secret = getpass.getpass("Secret key 2 — yang terbukti lolos (getpass, tidak tampil): ").strip()
if len(secret) != 80:
    print(f"PERINGATAN: panjang secret {len(secret)} karakter, harusnya 80 — cek lagi key yang dipaste.")
    raise SystemExit(1)

def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    else:
        req.add_header("Authorization", "Basic " + base64.b64encode((CID + ":" + secret).encode()).decode())
    req.add_header("Content-Type", "application/json" if body is not None else "application/x-www-form-urlencoded")
    if method != "GET":
        req.add_header("PayPal-Request-Id", str(uuid.uuid4()))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

# 1. Token — form-encoded, persis seperti termux_token_test.py yang terbukti jalan
data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
req = urllib.request.Request(BASE + "/v1/oauth2/token", data=data, method="POST")
req.add_header("Authorization", "Basic " + base64.b64encode((CID + ":" + secret).encode()).decode())
req.add_header("Content-Type", "application/x-www-form-urlencoded")
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        status, tok = r.status, json.loads(r.read())
except urllib.error.HTTPError as e:
    status, tok = e.code, json.loads(e.read() or b"{}")
print("TOKEN:", status, "-> TOKEN OK, expires_in:", tok.get("expires_in") if status == 200 else tok)
if status != 200:
    raise SystemExit(1)
token = tok["access_token"]

# 2. Buat order AUTHORIZE $200 (HOLD, bukan bayar)
status, order = call("POST", "/v2/checkout/orders", token=token, body={
    "intent": "AUTHORIZE",
    "purchase_units": [{
        "reference_id": "INV-DEMO-001",
        "amount": {"currency_code": "USD", "value": "200.00"},
        "description": "Mandate hold — logo design agreement ($200 cap)",
        "invoice_id": "INV-DEMO-001",
    }],
})
print("CREATE:", status, "ok:", 200 <= status < 300)
if not (200 <= status < 300):
    print(json.dumps(order)[:300])
    raise SystemExit(1)
oid = order["id"]
pu = order.get("purchase_units", [{}])[0]
print(f"order_id={oid} status={order.get('status')} intent={order.get('intent')}")
print(f"amount_from_paypal={pu.get('amount', {}).get('value')} {pu.get('amount', {}).get('currency_code')} invoice_id={pu.get('invoice_id', '-')}")

# 3. Read-back dari PayPal
status, back = call("GET", f"/v2/checkout/orders/{oid}", token=token)
pu2 = back.get("purchase_units", [{}])[0]
print("READBACK:", status, "status=", back.get("status"), "intent=", back.get("intent"))
print(f"readback_amount={pu2.get('amount', {}).get('value')} {pu2.get('amount', {}).get('currency_code')} invoice_id={pu2.get('invoice_id', '-')}")
print("SELESAI — hold $200 tercatat di Sandbox; belum ada uang yang bergerak.")
