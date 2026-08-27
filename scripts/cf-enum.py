#!/usr/bin/env python3
"""READ-ONLY Cloudflare enumeration: accounts, unimisk.com zone, all tunnels +
their configurations (ingress + source local/cloudflare), and DNS records.
Makes only GET calls. Token from env CF_API_TOKEN."""
import os, sys, json, urllib.request, urllib.error

T = os.environ.get("CF_API_TOKEN", "")
if not T: print("Set CF_API_TOKEN", file=sys.stderr); sys.exit(1)
BASE = "https://api.cloudflare.com/client/v4"

def api(path):
    req = urllib.request.Request(BASE + path, headers={
        "Authorization": "Bearer " + T, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"success": False, "http": e.code, "body": e.read().decode(errors="replace")[:400]}

accts = api("/accounts")
print("=== ACCOUNTS ===")
for a in accts.get("result", []) or []:
    print(" ", a["id"], a["name"])
acc = (accts.get("result") or [{}])[0].get("id")
print("using account:", acc)

print("\n=== ZONE unimisk.com ===")
z = api("/zones?name=unimisk.com")
for zz in z.get("result", []) or []:
    print(" ", zz["id"], zz["name"], "status=", zz.get("status"))
zone = (z.get("result") or [{}])[0].get("id")

print("\n=== TUNNELS (cfd_tunnel) ===")
tuns = api(f"/accounts/{acc}/cfd_tunnel?is_deleted=false")
if not tuns.get("success"): print("  tunnels err:", tuns)
for t in tuns.get("result", []) or []:
    print(f"  id={t['id']} name={t.get('name')} status={t.get('status')} conns={len(t.get('connections') or [])}")

print("\n=== TUNNEL CONFIGURATIONS (ingress + source) ===")
for t in tuns.get("result", []) or []:
    cfg = api(f"/accounts/{acc}/cfd_tunnel/{t['id']}/configurations")
    src = (cfg.get("result") or {}).get("source")
    ing = (((cfg.get("result") or {}).get("config")) or {}).get("ingress")
    print(f"  --- {t.get('name')} ({t['id']}) source={src} ---")
    if ing:
        for rule in ing:
            print("       ", rule.get("hostname","<catch-all>"), "->", rule.get("service"))
    else:
        print("       (no remote ingress / locally-managed) raw:", json.dumps(cfg.get("result")) [:200])

print("\n=== DNS RECORDS for unimisk.com (do NOT modify others) ===")
if zone:
    dns = api(f"/zones/{zone}/dns_records?per_page=200")
    for d in dns.get("result", []) or []:
        print(f"  {d['type']:6} {d['name']:40} -> {d.get('content')}  proxied={d.get('proxied')}")
print("\nDONE")
