#!/usr/bin/env python3
"""READ-ONLY: fetch SO-PO (spfohj...) anon key + public URL, test Kong REST
internally, and tail the crash-looping edge-functions container. Writes nothing.
The anon key is a public client key (already shipped in config.js)."""
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
echo "=== SO-PO ANON_KEY (public client key) ==="
SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^ANON_KEY=' | head -1
echo "=== SO-PO SUPABASE_PUBLIC_URL ==="
SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^SUPABASE_PUBLIC_URL=' | head -1
echo "=== Kong container IP on coolify network (for tunnel target planning) ==="
SUDO docker inspect "$KONG" --format '{{range $n,$v := .NetworkSettings.Networks}}{{$n}}={{$v.IPAddress}} {{end}}' 2>/dev/null
echo "=== test REST through Kong internally (expect 200 with anon key on empty schema) ==="
AK=$(SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^ANON_KEY=' | head -1 | cut -d= -f2-)
SUDO docker exec "$KONG" sh -c "wget -q -O- --header=\"apikey: $AK\" http://localhost:8000/rest/v1/ 2>/dev/null | head -c 200" 2>/dev/null || echo "(wget not in kong; trying curl from host via traefik)"
echo
echo "=== reach SO-PO via host Traefik (Host header) :80 ==="
curl -s -o /dev/null -w 'traefik :80 /rest/v1/ -> HTTP %{http_code}\n' -H "Host: supabasekong-$SID.122.179.131.66.sslip.io" -H "apikey: $AK" http://127.0.0.1:80/rest/v1/
echo "=== edge-functions container status + last logs ==="
SUDO docker ps -a --filter "name=supabase-edge-functions-$SID" --format '{{.Names}} :: {{.Status}}'
echo "--- last 25 log lines ---"
SUDO docker logs --tail 25 "supabase-edge-functions-$SID" 2>&1 | tail -25
echo DONE
"""
script = script.replace("__PW__", sp)

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i, o, e = c.exec_command("bash -s", timeout=120); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:600], file=sys.stderr)
c.close()
