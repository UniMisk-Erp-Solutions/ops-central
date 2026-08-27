#!/usr/bin/env python3
"""Expose ONLY the SO-PO Kong/Studio on a LAN host port via a dedicated socat
proxy container on SO-PO's own docker network. Touches no existing container and
no other project's port. Idempotent: recreates its own proxy container only.

Result: http://192.168.0.18:54321  -> SO-PO Kong (Studio behind dashboard auth).
"""
import os, sys
import paramiko
HOST=os.environ.get("SSH_HOST","192.168.0.18"); USER=os.environ.get("SSH_USER","webadmin")
PW=os.environ.get("SSH_PASSWORD",""); SID="spfohj2m4ij61p4riaup006i"
PORT=os.environ.get("EXPOSE_PORT","54321")
BIND=os.environ.get("EXPOSE_BIND","192.168.0.18")
if not PW: print("Set SSH_PASSWORD",file=sys.stderr); sys.exit(1)
sp=PW.replace("'","'\"'\"'")
script=r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
SID=spfohj2m4ij61p4riaup006i
NET="$SID"
KONG="supabase-kong-$SID"
NAME="sopo-public-proxy"
PORT=__PORT__
BIND=__BIND__
echo "=== remove any prior proxy (only our own container) ==="
SUDO docker rm -f "$NAME" 2>/dev/null && echo "removed old $NAME" || echo "(no prior $NAME)"
echo "=== run socat proxy: $BIND:$PORT -> $KONG:8000 on net $NET ==="
SUDO docker run -d --name "$NAME" --restart unless-stopped \
  --network "$NET" \
  -p "$BIND:$PORT:8000" \
  alpine/socat tcp-listen:8000,fork,reuseaddr "tcp-connect:$KONG:8000" >/dev/null \
  && echo "started $NAME" || { echo "FAILED to start (trying 0.0.0.0 bind)"; \
     SUDO docker run -d --name "$NAME" --restart unless-stopped --network "$NET" -p "$PORT:8000" alpine/socat tcp-listen:8000,fork,reuseaddr "tcp-connect:$KONG:8000" >/dev/null && echo "started $NAME on 0.0.0.0:$PORT"; }
sleep 2
echo "=== status ==="
SUDO docker ps --filter "name=$NAME" --format '{{.Names}} {{.Status}} {{.Ports}}'
echo "=== verify from host: REST (401=reachable, needs key) ==="
AK=$(SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^ANON_KEY=' | head -1 | cut -d= -f2-)
curl -s -m 12 -o /dev/null -w 'http://'"$BIND"':'"$PORT"'/rest/v1/ -> HTTP %{http_code}\n' "http://$BIND:$PORT/rest/v1/"
curl -s -m 12 -o /dev/null -w 'with anon key /rest/v1/ -> HTTP %{http_code}\n' -H "apikey: $AK" "http://$BIND:$PORT/rest/v1/"
echo "=== verify Studio root (200 or 401 basic-auth = good) ==="
curl -s -m 12 -o /dev/null -w 'http://'"$BIND"':'"$PORT"'/ -> HTTP %{http_code}\n' "http://$BIND:$PORT/"
echo DONE
"""
script=script.replace("__PW__",sp).replace("__PORT__",PORT).replace("__BIND__",BIND)
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST,username=USER,password=PW,timeout=20)
i,o,e=c.exec_command("bash -s",timeout=120); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err=e.read().decode(errors="replace")
if err.strip(): print("STDERR:",err[:800],file=sys.stderr)
c.close()
