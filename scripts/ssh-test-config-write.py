#!/usr/bin/env python3
"""Verify an admin JWT can UPDATE public.config under RLS (the saveConfig path).
Creates a temp admin, logs in, PATCHes config (updated_at) with return=representation,
confirms a row comes back, then cleans up. Touches only :54331. Non-destructive."""
import os, sys, paramiko
HOST="192.168.16.112"; USER="mithilmistry"; PW=os.environ.get("SSH_PASSWORD","")
ANON=("eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3OTQ0"
      "ODA4MCwiZXhwIjo0OTM1MTIxNjgwLCJyb2xlIjoiYW5vbiJ9.VrYk5aEwhCXAyXuAtjqk0dfUVw5iOJMKSajL1DwM5xw")
sp=PW.replace("'", "'\"'\"'")
T=r"""#!/bin/bash
SID=hws00sks44g8k04k8wccooco; B=http://127.0.0.1:54331; A='__ANON__'
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-$SID" | head -1)
echo "=== temp admin ==="
SUDO docker exec "$DB" psql -U postgres -d postgres -c "do \$\$ declare v uuid; begin v := public._opc_make_auth_user('cfgadmin@test.com','Admin123!'); insert into public.users(id,email,name,role,initials,active) values (v::text,'cfgadmin@test.com','Cfg Admin','Org Admin','CA',true); end \$\$;" | tail -1
TOK=$(curl -s -m 15 -X POST "$B/auth/v1/token?grant_type=password" -H "apikey: $A" -H "Content-Type: application/json" -d '{"email":"cfgadmin@test.com","password":"Admin123!"}' | grep -o '"access_token":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$TOK" ] && echo "login OK" || echo "login FAILED"
echo "=== admin UPDATE config (expect row returned) ==="
curl -s -m 15 -X PATCH "$B/rest/v1/config?id=eq.singleton" -H "apikey: $A" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" -o /tmp/u.json -w "PATCH HTTP %{http_code}\n"
echo -n "rows returned: "; grep -o '"id"' /tmp/u.json | wc -l
echo "=== member can read config back ==="
curl -s -m 15 -H "apikey: $A" -H "Authorization: Bearer $TOK" "$B/rest/v1/config?select=id&id=eq.singleton" -w "  [HTTP %{http_code}]\n"
echo "=== cleanup ==="
SUDO docker exec "$DB" psql -U postgres -d postgres -c "delete from auth.users where email='cfgadmin@test.com'; delete from public.users where email='cfgadmin@test.com';" | tail -1
rm -f /tmp/u.json
echo DONE
"""
s=T.replace("__PW__",sp).replace("__ANON__",ANON)
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i,o,e=c.exec_command("bash -s", timeout=120); i.write(s); i.channel.shutdown_write()
print(o.read().decode(errors="replace")); err=e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:500], file=sys.stderr)
c.close()
