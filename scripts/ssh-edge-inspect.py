#!/usr/bin/env python3
"""READ-ONLY: inspect SO-PO edge-functions container — command, mounts, env,
the functions volume on disk, and crash logs. Writes nothing."""
import os, sys
import paramiko
HOST=os.environ.get("SSH_HOST","192.168.0.18"); USER=os.environ.get("SSH_USER","webadmin")
PW=os.environ.get("SSH_PASSWORD",""); SID="spfohj2m4ij61p4riaup006i"
if not PW: print("Set SSH_PASSWORD",file=sys.stderr); sys.exit(1)
sp=PW.replace("'","'\"'\"'")
script=r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
SID=spfohj2m4ij61p4riaup006i
EF="supabase-edge-functions-$SID"
echo "=== container status ==="
SUDO docker ps -a --filter "name=$EF" --format '{{.Names}} :: {{.Status}}'
echo "=== command / entrypoint ==="
SUDO docker inspect "$EF" --format 'CMD={{json .Config.Cmd}} ENTRY={{json .Config.Entrypoint}}'
echo "=== mounts (functions volume) ==="
SUDO docker inspect "$EF" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Type}}){{println}}{{end}}'
echo "=== relevant env ==="
SUDO docker inspect "$EF" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -iE 'FUNCTIONS|JWT|VERIFY|SUPABASE_URL|SERVICE_ROLE|ANON|MAIN' | sed -E 's/(KEY|SECRET|ROLE_KEY)=.*/\1=<redacted>/' | head -20
echo "=== functions dir on disk ==="
SUDO ls -la /data/coolify/services/$SID/volumes/functions/ 2>/dev/null || echo "(no functions volume dir)"
echo "--- main/ contents ---"
SUDO ls -la /data/coolify/services/$SID/volumes/functions/main/ 2>/dev/null || echo "(no main/ dir)"
echo "=== last 40 log lines (why crash-looping) ==="
SUDO docker logs --tail 40 "$EF" 2>&1 | tail -40
echo DONE
"""
script=script.replace("__PW__",sp)
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST,username=USER,password=PW,timeout=20)
i,o,e=c.exec_command("bash -s",timeout=90); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err=e.read().decode(errors="replace")
if err.strip(): print("STDERR:",err[:600],file=sys.stderr)
c.close()
