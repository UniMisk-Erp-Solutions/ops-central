#!/usr/bin/env python3
"""Bring up the cloudflared connector on THIS host for tunnel 13922d0c so that
so-po.unimisk.com -> the new SO-PO Supabase (via the local proxy :54321).

Safety:
  * backs up the existing /etc/cloudflared/config.yml
  * the candidate config KEEPS the existing taskflow-api route and only ADDS
    so-po (purely additive vs this host's current config)
  * validates the candidate BEFORE installing it
  * installs a systemd unit and starts it; if it fails to become active, the
    old config is restored
  * deletes nothing in Cloudflare; DNS for so-po already exists (no CNAME change)
"""
import os, sys
import paramiko

HOST=os.environ.get("SSH_HOST","192.168.0.18"); USER=os.environ.get("SSH_USER","webadmin")
PW=os.environ.get("SSH_PASSWORD","")
TUNNEL_ID="13922d0c-0c65-484e-8764-30b454293460"
TARGET="http://192.168.0.18:54321"   # the SO-PO Kong via the socat proxy (name-based, stable)
if not PW: print("Set SSH_PASSWORD",file=sys.stderr); sys.exit(1)
sp=PW.replace("'","'\"'\"'")

script=r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
CFG=/etc/cloudflared/config.yml
TID=__TID__
TS=$(date +%Y%m%d%H%M%S)

echo "=== current config.yml ==="
SUDO cat "$CFG" 2>/dev/null || echo "(none)"
echo "=== backup ==="
SUDO cp "$CFG" "$CFG.bak-$TS" 2>/dev/null && echo "backed up -> $CFG.bak-$TS"

echo "=== write candidate (keeps taskflow-api, ADDS so-po) ==="
cat > /tmp/cf_cand.yml <<'YAML'
tunnel: 13922d0c-0c65-484e-8764-30b454293460
credentials-file: /etc/cloudflared/13922d0c-0c65-484e-8764-30b454293460.json
no-autoupdate: true

ingress:
  - hostname: so-po.unimisk.com
    service: http://192.168.0.18:54321
    originRequest:
      connectTimeout: 30s
      keepAliveTimeout: 90s
  - hostname: taskflow-api.unimisk.com
    service: http://localhost:8001
  - service: http_status:404
YAML

echo "=== validate candidate BEFORE going live ==="
if SUDO cloudflared --config /tmp/cf_cand.yml tunnel ingress validate; then
  echo "VALIDATE_OK"
else
  echo "VALIDATE_FAIL — leaving everything untouched"; rm -f /tmp/cf_cand.yml; exit 1
fi
echo "--- rule check: which service serves each host ---"
SUDO cloudflared --config /tmp/cf_cand.yml tunnel ingress rule https://so-po.unimisk.com 2>&1 | tail -2
SUDO cloudflared --config /tmp/cf_cand.yml tunnel ingress rule https://taskflow-api.unimisk.com 2>&1 | tail -2

echo "=== install candidate ==="
SUDO cp /tmp/cf_cand.yml "$CFG"

echo "=== install systemd unit (idempotent) ==="
cat > /tmp/cloudflared.service <<'UNIT'
[Unit]
Description=cloudflared tunnel (so-po + taskflow-api)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared --no-autoupdate --config /etc/cloudflared/config.yml tunnel run
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
UNIT
SUDO cp /tmp/cloudflared.service /etc/systemd/system/cloudflared.service
SUDO systemctl daemon-reload
SUDO systemctl enable cloudflared >/dev/null 2>&1
SUDO systemctl restart cloudflared
sleep 8
ST=$(SUDO systemctl is-active cloudflared)
echo "cloudflared active: $ST"
if [ "$ST" != "active" ]; then
  echo "SERVICE_FAILED — restoring previous config"
  SUDO journalctl -u cloudflared --no-pager -n 20 2>/dev/null | tail -20
  [ -f "$CFG.bak-$TS" ] && SUDO cp "$CFG.bak-$TS" "$CFG" && SUDO systemctl restart cloudflared
  rm -f /tmp/cf_cand.yml /tmp/cloudflared.service; exit 1
fi
echo "--- recent connector log (registered connection?) ---"
SUDO journalctl -u cloudflared --no-pager -n 12 2>/dev/null | tail -12
echo "=== local origin reachable? (proxy :54321) ==="
curl -s -o /dev/null -w 'http://192.168.0.18:54321/rest/v1/ -> %{http_code} (401=ok)\n' http://192.168.0.18:54321/rest/v1/
rm -f /tmp/cf_cand.yml /tmp/cloudflared.service
echo DONE
"""
script=script.replace("__PW__",sp).replace("__TID__",TUNNEL_ID)

c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST,username=USER,password=PW,timeout=20)
i,o,e=c.exec_command("bash -s",timeout=180); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err=e.read().decode(errors="replace")
if err.strip(): print("STDERR:",err[:1200],file=sys.stderr)
c.close()
