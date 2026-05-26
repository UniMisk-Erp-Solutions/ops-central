#!/usr/bin/env python3
"""Read-only inspection of the existing cloudflared setup on the Ubuntu box.
Redacts tokens/secrets. Does NOT modify anything. Used to plan adding the
so-po.unimisk.com hostname without disturbing the existing tunnel."""
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
sp = PW.replace("'", "'\"'\"'")

script = f"""#!/bin/bash
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}
echo "=== cloudflared binary ==="
which cloudflared && cloudflared --version 2>/dev/null || echo "cloudflared not on PATH"
echo
echo "=== cloudflared services ==="
SUDO systemctl list-units --type=service --all 2>/dev/null | grep -i cloudflared || echo "no cloudflared systemd unit"
echo
echo "=== service files (token-based?) — count of --token, not the value ==="
for f in /etc/systemd/system/cloudflared*.service /etc/systemd/system/multi-user.target.wants/cloudflared*.service; do
  [ -f "$f" ] && echo "$f : token refs=$(grep -c -- '--token' "$f" 2>/dev/null), config refs=$(grep -c -- '--config' "$f" 2>/dev/null)"
done
echo
echo "=== running processes (redacted) ==="
ps -ef | grep -i '[c]loudflared' || echo none
echo
echo "=== ~/.cloudflared and /etc/cloudflared (names only) ==="
SUDO ls -la /root/.cloudflared/ 2>/dev/null || echo "no /root/.cloudflared"
ls -la /home/{USER}/.cloudflared/ 2>/dev/null || echo "no ~/.cloudflared"
SUDO ls -la /etc/cloudflared/ 2>/dev/null || echo "no /etc/cloudflared"
echo
echo "=== config.yml ingress (safe to show) ==="
for c in /etc/cloudflared/config.yml /root/.cloudflared/config.yml /home/{USER}/.cloudflared/config.yml; do
  if SUDO test -f "$c"; then echo "--- $c ---"; SUDO cat "$c"; fi
done
echo
echo "=== tunnel list (needs cert.pem; ids are not secret) ==="
SUDO cloudflared tunnel list 2>&1 | head -20 || true
echo DONE
"""
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i, o, e = c.exec_command("bash -s", timeout=120); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:500], file=sys.stderr)
c.close()
