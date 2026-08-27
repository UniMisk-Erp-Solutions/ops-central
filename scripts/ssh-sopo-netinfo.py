#!/usr/bin/env python3
"""READ-ONLY: exact docker network(s) for SO-PO kong + free host port check.
Used to publish ONLY SO-PO's Kong on a LAN host port without touching others."""
import os, sys
import paramiko
HOST=os.environ.get("SSH_HOST","192.168.0.18"); USER=os.environ.get("SSH_USER","webadmin")
PW=os.environ.get("SSH_PASSWORD",""); SID="spfohj2m4ij61p4riaup006i"
if not PW: print("Set SSH_PASSWORD",file=sys.stderr); sys.exit(1)
sp=PW.replace("'","'\"'\"'")
script=r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
SID=spfohj2m4ij61p4riaup006i
KONG="supabase-kong-$SID"
echo "=== networks of $KONG (name -> ip) ==="
SUDO docker inspect "$KONG" --format '{{range $n,$v := .NetworkSettings.Networks}}{{$n}} -> {{$v.IPAddress}}{{println}}{{end}}'
echo "=== candidate host ports free? (want one not listed) ==="
for P in 8002 54321 54331; do
  if SUDO ss -ltn "( sport = :$P )" 2>/dev/null | grep -q ":$P"; then echo "$P : IN USE"; else echo "$P : free"; fi
done
echo "=== existing host-published ports (avoid clashes) ==="
SUDO ss -ltn 2>/dev/null | awk 'NR>1{print $4}' | grep -oE ':[0-9]+$' | sort -tu -k2 -n | sort -u
echo "=== is alpine/socat or socat available? ==="
SUDO docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -i socat || echo "(socat image not pulled yet)"
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
