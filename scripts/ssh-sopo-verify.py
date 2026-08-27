#!/usr/bin/env python3
"""READ-ONLY: verify SO-PO Kong serves REST + auth with the new anon key.
Tries Traefik host-header, direct kong IP, and GoTrue health. No writes."""
import os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = "spfohj2m4ij61p4riaup006i"
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)
sp = PW.replace("'", "'\"'\"'")

script = r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
SID=spfohj2m4ij61p4riaup006i
KONG="supabase-kong-$SID"
AK=$(SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^ANON_KEY=' | head -1 | cut -d= -f2-)
IP=$(SUDO docker inspect "$KONG" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)
echo "Kong IP: $IP"
HOSTHDR="supabasekong-$SID.122.179.131.66.sslip.io"

echo "=== (1) direct to kong IP :8000 /rest/v1/categories ==="
curl -s -m 12 -o /tmp/r1 -w 'HTTP %{http_code}\n' -H "apikey: $AK" "http://$IP:8000/rest/v1/categories?select=name&limit=3"
echo -n "body: "; head -c 200 /tmp/r1; echo

echo "=== (2) Traefik :80 with Host header /rest/v1/categories ==="
curl -s -m 12 -o /tmp/r2 -w 'HTTP %{http_code}\n' -H "Host: $HOSTHDR" -H "apikey: $AK" "http://127.0.0.1:80/rest/v1/categories?select=name&limit=3"
echo -n "body: "; head -c 200 /tmp/r2; echo

echo "=== (3) GoTrue auth health via kong IP ==="
curl -s -m 12 -o /tmp/r3 -w 'HTTP %{http_code}\n' -H "apikey: $AK" "http://$IP:8000/auth/v1/health"
echo -n "body: "; head -c 200 /tmp/r3; echo

echo "=== (4) admin-exists RPC (frontend uses this on load) ==="
curl -s -m 12 -o /tmp/r4 -w 'HTTP %{http_code}\n' -X POST -H "apikey: $AK" -H "Content-Type: application/json" "http://$IP:8000/rest/v1/rpc/opc_admin_exists"
echo -n "body: "; head -c 200 /tmp/r4; echo
rm -f /tmp/r1 /tmp/r2 /tmp/r3 /tmp/r4
echo DONE
"""
script = script.replace("__PW__", sp)
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i, o, e = c.exec_command("bash -s", timeout=90); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:600], file=sys.stderr)
c.close()
