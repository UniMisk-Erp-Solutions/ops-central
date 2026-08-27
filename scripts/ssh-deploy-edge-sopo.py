#!/usr/bin/env python3
"""Deploy edge function 'main' to the SO-PO Supabase edge runtime and fix the
crash-loop (its index.ts was a stray empty DIRECTORY, so the runtime couldn't
load the main service). Writes the real files into the Coolify functions volume
and restarts ONLY the SO-PO edge container. Touches no other project.
"""
import base64, os, sys
import paramiko

HOST=os.environ.get("SSH_HOST","192.168.0.18"); USER=os.environ.get("SSH_USER","webadmin")
PW=os.environ.get("SSH_PASSWORD",""); SID="spfohj2m4ij61p4riaup006i"
PORT=os.environ.get("EXPOSE_PORT","54321"); BIND=os.environ.get("EXPOSE_BIND","192.168.0.18")
if not PW: print("Set SSH_PASSWORD",file=sys.stderr); sys.exit(1)

FILES={
  "index.ts":"supabase/functions/main/index.ts",
  "handler.mjs":"supabase/functions/main/handler.mjs",
  "lib/supabase.mjs":"supabase/functions/main/lib/supabase.mjs",
}
enc={k:base64.b64encode(open(v,"rb").read()).decode() for k,v in FILES.items()}
sp=PW.replace("'","'\"'\"'")

writes=[]
for rel,b64 in enc.items():
    tmp="/tmp/ef_"+rel.replace("/","_")
    writes.append(
        f"echo '{b64}' | base64 -d > '{tmp}'\n"
        f"SUDO cp '{tmp}' \"$FNDIR/{rel}\" && echo \"wrote {rel} ($(SUDO wc -c < \"$FNDIR/{rel}\") bytes)\"\n"
        f"rm -f '{tmp}'")
writes_block="\n".join(writes)

script=r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
SID=spfohj2m4ij61p4riaup006i
EF="supabase-edge-functions-$SID"
FNDIR="/data/coolify/services/$SID/volumes/functions/main"
echo "=== stop edge container ==="
SUDO docker stop "$EF" >/dev/null 2>&1 && echo "stopped $EF"
echo "=== fix main/index.ts (remove stray dir) + prepare dirs ==="
SUDO rm -rf "$FNDIR/index.ts"
SUDO mkdir -p "$FNDIR/lib"
echo "=== write function files ==="
__WRITES__
SUDO chmod -R 644 "$FNDIR"/*.ts "$FNDIR"/*.mjs "$FNDIR"/lib/*.mjs 2>/dev/null
echo "--- listing ---"
SUDO ls -la "$FNDIR" "$FNDIR/lib"
echo "=== start edge container ==="
SUDO docker start "$EF" >/dev/null 2>&1 && echo "started $EF"
sleep 7
echo "=== status (want 'Up', not Restarting) ==="
SUDO docker ps -a --filter "name=$EF" --format '{{.Names}} :: {{.Status}}'
echo "=== last logs ==="
SUDO docker logs --tail 15 "$EF" 2>&1 | tail -15
echo "=== test function via local proxy http://__BIND__:__PORT__/functions/v1/main ==="
AK=$(SUDO docker inspect "supabase-kong-$SID" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -E '^ANON_KEY=' | head -1 | cut -d= -f2-)
curl -s -m 15 -w '\n[HTTP %{http_code}]\n' -H "apikey: $AK" -H "Authorization: Bearer $AK" "http://__BIND__:__PORT__/functions/v1/main"
echo DONE
"""
script=script.replace("__PW__",sp).replace("__WRITES__",writes_block).replace("__BIND__",BIND).replace("__PORT__",PORT)

c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST,username=USER,password=PW,timeout=20)
i,o,e=c.exec_command("bash -s",timeout=120); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err=e.read().decode(errors="replace")
if err.strip(): print("STDERR:",err[:800],file=sys.stderr)
c.close()
