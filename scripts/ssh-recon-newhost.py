#!/usr/bin/env python3
"""READ-ONLY recon of the new Coolify host (192.168.0.18 / webadmin).

Modifies NOTHING. Used to plan the SO-PO Supabase cutover:
  - confirm SSH works + sudo works
  - list Coolify-managed docker containers (find the SO-PO Supabase stack)
  - locate Kong/REST ports for the new Supabase
  - inspect cloudflared tunnel + ingress (so we add 1 route, break none)
Redacts obvious secrets (tokens/keys) where practical.
"""
import os, sys
try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr); sys.exit(1)

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)
sp = PW.replace("'", "'\"'\"'")

script = r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
echo "=== whoami / host ==="
whoami; hostname; uname -a
echo
echo "=== sudo check ==="
SUDO true && echo "sudo OK" || echo "sudo FAILED (password may differ)"
echo
echo "=== docker present? ==="
which docker || echo "docker not on PATH"
SUDO docker version --format '{{.Server.Version}}' 2>/dev/null || echo "(cannot talk to docker daemon)"
echo
echo "=== all containers (names + ports) ==="
SUDO docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | head -80
echo
echo "=== containers whose name hints supabase / so-po / kong / postgres ==="
SUDO docker ps --format '{{.Names}}' 2>/dev/null | grep -iE 'supabase|so.?po|kong|postgres|rest|auth|realtime|storage|meta|studio' || echo "(none matched)"
echo
echo "=== listening tcp ports (look for kong 8000/54321-ish, studio) ==="
SUDO ss -ltnp 2>/dev/null | head -60 || SUDO netstat -ltnp 2>/dev/null | head -60
echo
echo "=== cloudflared binary / version ==="
which cloudflared && cloudflared --version 2>/dev/null || echo "cloudflared not on PATH"
echo
echo "=== cloudflared systemd units ==="
SUDO systemctl list-units --type=service --all 2>/dev/null | grep -i cloudflared || echo "no cloudflared systemd unit"
echo
echo "=== cloudflared processes (redacted token) ==="
ps -ef | grep -i '[c]loudflared' | sed -E 's/(--token )[A-Za-z0-9._-]+/\1<REDACTED>/g' || echo none
echo
echo "=== cloudflared config dirs (names only) ==="
SUDO ls -la /etc/cloudflared/ 2>/dev/null || echo "no /etc/cloudflared"
SUDO ls -la /root/.cloudflared/ 2>/dev/null || echo "no /root/.cloudflared"
ls -la /home/__USER__/.cloudflared/ 2>/dev/null || echo "no ~/.cloudflared"
echo
echo "=== config.yml ingress (the existing routes — DO NOT BREAK) ==="
for c in /etc/cloudflared/config.yml /root/.cloudflared/config.yml /home/__USER__/.cloudflared/config.yml; do
  if SUDO test -f "$c"; then echo "--- $c ---"; SUDO cat "$c"; fi
done
echo
echo "=== tunnel list (ids are not secret) ==="
SUDO cloudflared tunnel list 2>&1 | head -20 || true
echo DONE
"""
script = script.replace("__PW__", sp).replace("__USER__", USER)

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    c.connect(HOST, username=USER, password=PW, timeout=20)
except Exception as ex:
    print("SSH CONNECT FAILED:", type(ex).__name__, str(ex), file=sys.stderr); sys.exit(2)
i, o, e = c.exec_command("bash -s", timeout=150); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:600], file=sys.stderr)
c.close()
