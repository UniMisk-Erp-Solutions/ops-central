#!/usr/bin/env python3
"""READ-ONLY: map each Coolify Supabase stack id -> project/service name, and
show how each is exposed (public URLs). Redacts key VALUES but shows which keys
exist. Modifies NOTHING."""
import os, sys
import paramiko

HOST = os.environ.get("SSH_HOST", "192.168.0.18")
USER = os.environ.get("SSH_USER", "webadmin")
PW = os.environ.get("SSH_PASSWORD", "")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)
sp = PW.replace("'", "'\"'\"'")

script = r"""#!/bin/bash
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
IDS="spfohj2m4ij61p4riaup006i qrnm9mnevk57tgd3suc5zkye evo3o0fdjaroxq7uohrm21cp"
for ID in $IDS; do
  echo "############ STACK $ID ############"
  KONG="supabase-kong-$ID"
  DB="supabase-db-$ID"
  echo "--- coolify labels on $KONG ---"
  SUDO docker inspect "$KONG" --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}
{{end}}' 2>/dev/null | grep -iE 'coolify|name|fqdn|domain|traefik.*host' | head -25
  echo "--- public/url env on $KONG (values shown for URLs only) ---"
  SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -iE 'SUPABASE_PUBLIC_URL|API_EXTERNAL_URL|SITE_URL|EXTERNAL|_URL=' | head -20
  echo "--- which secret keys EXIST on $KONG (values redacted) ---"
  SUDO docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep -iE 'ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET|SECRET_KEY_BASE' | sed -E 's/=.*/=<present>/' | head -20
  echo "--- db identity (name + a public-table peek count, NO writes) ---"
  SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select current_database()" 2>/dev/null
  SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | sed 's/^/public tables: /'
  SUDO docker exec "$DB" psql -U postgres -d postgres -tAc "select string_agg(table_name,', ') from information_schema.tables where table_schema='public'" 2>/dev/null | sed 's/^/public table names: /'
  echo
done
echo "=== Coolify resource dirs (names often encode project) ==="
SUDO ls -1 /data/coolify/services 2>/dev/null | head -40 || echo "(no /data/coolify/services)"
echo "=== grep docker-compose dirs for the stack ids -> human names ==="
for ID in $IDS; do
  D=$(SUDO find /data/coolify -maxdepth 3 -type d -name "*$ID*" 2>/dev/null | head -1)
  echo "$ID -> ${D:-<not found under /data/coolify>}"
done
echo DONE
"""
script = script.replace("__PW__", sp)

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i, o, e = c.exec_command("bash -s", timeout=150); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:600], file=sys.stderr)
c.close()
