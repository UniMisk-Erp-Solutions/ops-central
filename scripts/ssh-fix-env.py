#!/usr/bin/env python3
"""Fix broken GOTRUE_SITE_URL template in OPC Coolify .env only."""
import os
import paramiko

HOST = "192.168.16.112"
USER = "mithilmistry"
PATH = "/data/coolify/services/hws00sks44g8k04k8wccooco/.env"
pw = os.environ.get("SSH_PASSWORD", "")
if not pw:
    print("Set SSH_PASSWORD")
    raise SystemExit(1)

sp = pw.replace("'", "'\"'\"'")
fix_cmd = f"""
echo '{sp}' | sudo -S cp '{PATH}' '{PATH}.bak-$(date +%s)'
echo '{sp}' | sudo -S sed -i 's|^GOTRUE_SITE_URL=\\${{SERVICE_URL_SUPABASEKONG$|GOTRUE_SITE_URL=${{SERVICE_URL_SUPABASEKONG}}|' '{PATH}'
echo '{sp}' | sudo -S grep '^GOTRUE_SITE_URL=' '{PATH}'
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=pw, timeout=15)
_, o, e = c.exec_command(fix_cmd, timeout=60)
print(o.read().decode())
err = e.read().decode()
if err.strip():
    print(err)
c.close()
print("Fixed. Redeploy supabase-hws00sks44g8k04k8wccooco in Coolify.")
