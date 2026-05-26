#!/usr/bin/env python3
"""Add so-po.unimisk.com -> http://127.0.0.1:54331 to the EXISTING cloudflared
tunnel (taskflow-supabase) without disturbing supabase.unimisk.com.

Safety: backs up config.yml, validates the new config BEFORE installing it,
adds the DNS route, restarts cloudflared, and auto-restores the backup if the
service fails to come back. Prints no secrets.
"""
import os, sys
try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr); sys.exit(1)

HOST = os.environ.get("SSH_HOST", "192.168.16.112")
USER = os.environ.get("SSH_USER", "mithilmistry")
PW = os.environ.get("SSH_PASSWORD", "")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

TUNNEL_ID = "13922d0c-0c65-484e-8764-30b454293460"
HOSTNAME = "so-po.unimisk.com"
TARGET = "http://127.0.0.1:54331"

TEMPLATE = r"""#!/bin/bash
SUDO(){ echo '__SUDOPW__' | sudo -S "$@" 2>/dev/null; }
TS=$(date +%Y%m%d%H%M%S)
CFG=/etc/cloudflared/config.yml
echo "=== backup ==="
SUDO cp "$CFG" "$CFG.bak-$TS" && echo "backed up to $CFG.bak-$TS"

echo "=== write candidate config ==="
cat > /tmp/opc_cf_config.yml <<'YAML'
tunnel: 13922d0c-0c65-484e-8764-30b454293460
credentials-file: /root/.cloudflared/13922d0c-0c65-484e-8764-30b454293460.json

ingress:
  - hostname: supabase.unimisk.com
    service: http://127.0.0.1:54321
    originRequest:
      noHappyEyeballs: true
      connectTimeout: 30s
      keepAliveTimeout: 90s
  - hostname: so-po.unimisk.com
    service: http://127.0.0.1:54331
    originRequest:
      noHappyEyeballs: true
      connectTimeout: 30s
      keepAliveTimeout: 90s
  - service: http_status:404
YAML

echo "=== validate candidate (before touching live) ==="
if SUDO cloudflared --config /tmp/opc_cf_config.yml tunnel ingress validate; then
  echo "VALIDATE_OK"
else
  echo "VALIDATE_FAIL — leaving live config untouched"; rm -f /tmp/opc_cf_config.yml; exit 1
fi

echo "=== install new config ==="
SUDO cp /tmp/opc_cf_config.yml "$CFG"

echo "=== add DNS route (creates CNAME via cert.pem) ==="
SUDO cloudflared tunnel route dns 13922d0c-0c65-484e-8764-30b454293460 so-po.unimisk.com 2>&1 | tail -3 || echo "(route may already exist — continuing)"

echo "=== restart cloudflared ==="
SUDO systemctl restart cloudflared
sleep 5
ST=$(SUDO systemctl is-active cloudflared)
echo "cloudflared active: $ST"
if [ "$ST" != "active" ]; then
  echo "RESTART_FAILED — restoring backup"
  SUDO cp "$CFG.bak-$TS" "$CFG"
  SUDO systemctl restart cloudflared; sleep 4
  echo "after restore active: $(SUDO systemctl is-active cloudflared)"
  rm -f /tmp/opc_cf_config.yml; exit 1
fi

echo "=== which rule serves each hostname (sanity) ==="
SUDO cloudflared --config "$CFG" tunnel ingress rule https://supabase.unimisk.com 2>&1 | tail -2
SUDO cloudflared --config "$CFG" tunnel ingress rule https://so-po.unimisk.com 2>&1 | tail -2

echo "=== local reachability of Kong :54331 ==="
curl -s -o /dev/null -w 'local 54331 /rest/v1/ -> %{http_code} (401=reachable, needs key)\n' http://127.0.0.1:54331/rest/v1/
rm -f /tmp/opc_cf_config.yml
echo DONE
"""

script = TEMPLATE.replace("__SUDOPW__", PW.replace("'", "'\"'\"'"))
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i, o, e = c.exec_command("bash -s", timeout=180); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:800], file=sys.stderr)
c.close()
