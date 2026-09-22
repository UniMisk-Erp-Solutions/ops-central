#!/usr/bin/env python3
"""Sign in as a tenant's admin and prove what they can and cannot see.

Run AS THE TENANT, over the public API, with that person's own JWT — never as
superuser against the database. Superuser bypasses row-level security, so a test
that connects that way passes whether isolation works or not.

  python scripts/verify-tenant-isolation.py                       # the dm tenant
  python scripts/verify-tenant-isolation.py --email a@b.com --password '...'

Asserts, for the signed-in tenant:
  * the login works at all
  * the organization resolved is the one expected
  * every table reads ZERO rows (a fresh tenant is fresh)
  * nothing belonging to another organization is visible
"""
import argparse, json, sys, urllib.error, urllib.request

AP = argparse.ArgumentParser()
AP.add_argument("--url", default="https://so-po.unimisk.com")
AP.add_argument("--anon", default="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc4MDM4NDg2MCwiZXhwIjo0OTM2MDU4NDYwLCJyb2xlIjoiYW5vbiJ9.0AhbGOMbIybN0azUCAuoriNKGtSwdpznBqCQbZDpxZM")
AP.add_argument("--email", default="admin@demo.com")
AP.add_argument("--password", default="qwertyui")
AP.add_argument("--expect-org", default="Demo Org")
AP.add_argument("--expect-empty", action="store_true", default=True)
A = AP.parse_args()

TABLES = ["sales_orders", "vendor_pos", "grns", "vendor_invoices", "payments",
          "products", "categories", "boms", "customers", "vendors",
          "sourcings", "rfqs", "pool", "transfer_requests", "outward_dispatches",
          "notifications", "audit"]

bad = 0


def ok(m):
    print("  ok  " + m)


def fail(m):
    global bad
    bad += 1
    print("  X  " + m)


def call(path, token=None, method="GET", body=None, extra=None):
    url = A.url.rstrip("/") + path
    headers = {
        "apikey": A.anon,
        "Content-Type": "application/json",
        # Cloudflare fronts this host and refuses urllib's default agent with
        # its own 1010 before the request ever reaches Supabase. The app is a
        # browser; a check that is not looks like an attacker.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                      " (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    if extra:
        headers.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


print("\n[1] the login works")
status, tok = call("/auth/v1/token?grant_type=password", method="POST",
                   body={"email": A.email, "password": A.password})
if status != 200 or not isinstance(tok, dict) or not tok.get("access_token"):
    fail(f"sign-in failed ({status}): {str(tok)[:300]}")
    print("\nFAILED - cannot sign in, nothing else can be checked")
    sys.exit(1)
ok(f"{A.email} signs in")
jwt = tok["access_token"]

print("\n[2] the right organization, resolved server-side")
status, me = call("/rest/v1/rpc/opc_my_context", token=jwt, method="POST", body={})
if status != 200:
    status, me = call("/rest/v1/rpc/opc_my_organizations", token=jwt, method="POST", body={})
found = json.dumps(me) if me is not None else ""
if A.expect_org and A.expect_org.lower() in found.lower():
    ok(f"the session resolves to {A.expect_org}")
else:
    fail(f"expected {A.expect_org} in the session context, got: {found[:300]}")

print("\n[3] a fresh tenant reads zero rows — and no other company's")
total = 0
for t in TABLES:
    status, rows = call(f"/rest/v1/{t}?select=*&limit=200", token=jwt)
    if status != 200:
        fail(f"{t}: {status} {str(rows)[:120]}")
        continue
    n = len(rows or [])
    total += n
    if A.expect_empty and n:
        fail(f"{t}: {n} row(s) visible to a brand-new tenant")
if not bad:
    ok(f"all {len(TABLES)} tables read 0 rows")
ok(f"{total} row(s) visible in total")

print("\n[4] logged out, nothing is readable at all")
status, rows = call("/rest/v1/sales_orders?select=id&limit=1")
if status in (401, 403):
    ok(f"anonymous read is refused ({status})")
elif status == 200 and not rows:
    ok("anonymous read returns nothing")
else:
    fail(f"anonymous read returned {status}: {str(rows)[:200]}")

print("\n[5] a wrong password is refused")
status, _ = call("/auth/v1/token?grant_type=password", method="POST",
                 body={"email": A.email, "password": A.password + "x"})
if status == 400:
    ok("a wrong password is refused")
else:
    fail(f"a wrong password returned {status}, expected 400")

print("" if bad else "\nPASS - the tenant signs in, sees its own (empty) organization, and nothing else")
if bad:
    print(f"\nFAILED - {bad} problem(s)")
sys.exit(1 if bad else 0)
