#!/usr/bin/env python3
"""READ-ONLY: Studio access details for SO-PO + post-restore sanity.
Shows dashboard (Studio) credentials + URLs, studio container IP, and confirms
the admin bootstrap RPC now sees the restored users. Writes nothing."""
import os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
SID = "spfohj2m4ij61p4riaup006i"
if not PW: print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)
sp = PW.replace("'", "'\"'\"'")

script = r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
SID=spfohj2m4ij61p4riaup006i
KONG="supabase-kong-$SID"; STU="supabase-studio-$SID"
echo "=== Studio (dashboard) credentials from kong env ==="
SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -iE 'DASHBOARD_USERNAME|DASHBOARD_PASSWORD|SERVICE_FQDN|^STUDIO' | head
echo "=== Studio container IP (coolify net) + studio env STUDIO_DEFAULT_* ==="
SUDO docker inspect "$STU" --format 'studio_ip={{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null
KIP=$(SUDO docker inspect "$KONG" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)
echo "kong_ip=$KIP"
echo "=== anon key + admin-exists (should now be true) ==="
AK=$(SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^ANON_KEY=' | head -1 | cut -d= -f2-)
curl -s -m 12 -o /tmp/ae -w 'opc_admin_exists -> HTTP %{http_code}: ' -X POST -H "apikey: $AK" -H "Content-Type: application/json" "http://$KIP:8000/rest/v1/rpc/opc_admin_exists"; cat /tmp/ae; echo
echo "=== Coolify default sslip domain for this service ==="
SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^SUPABASE_PUBLIC_URL=' | head -1
rm -f /tmp/ae
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
