#!/usr/bin/env python3
"""Verify real auth + RLS end-to-end on :54331. Creates a temp Sales member with
a known password, then checks: real login JWT works; member can read; anon is
blocked; non-admin cannot create users; opc_admin_exists works. Cleans up."""
import os, sys, paramiko
HOST="192.168.16.112"; USER="mithilmistry"; PW=os.environ.get("SSH_PASSWORD","")
ANON=("eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3OTQ0"
      "ODA4MCwiZXhwIjo0OTM1MTIxNjgwLCJyb2xlIjoiYW5vbiJ9.VrYk5aEwhCXAyXuAtjqk0dfUVw5iOJMKSajL1DwM5xw")
sp=PW.replace("'", "'\"'\"'")
T=r"""#!/bin/bash
SID=hws00sks44g8k04k8wccooco; B=http://127.0.0.1:54331; A='__ANON__'
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-$SID" | head -1)
PSQL(){ SUDO docker exec "$DB" psql -U postgres -d postgres -t -A -c "$1"; }

echo "=== structure: auth.users + profiles ==="
PSQL "select email from auth.users order by email;"
echo "--- public.users (id is uuid now, no password) ---"
PSQL "select id, email, role from public.users order by email;"
PSQL "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='password') as password_col_still_there;"

echo "=== create temp Sales member (known pw) ==="
SUDO docker exec "$DB" psql -U postgres -d postgres -c "do \$\$ declare v uuid; begin v := public._opc_make_auth_user('verify@example.com','Verify123!'); insert into public.users(id,email,name,role,initials,active) values (v::text,'verify@example.com','Verify User','Sales','VU',true); end \$\$;" | tail -1

echo "=== login (real GoTrue) ==="
TOK=$(curl -s -m 15 -X POST "$B/auth/v1/token?grant_type=password" -H "apikey: $A" -H "Content-Type: application/json" -d '{"email":"verify@example.com","password":"Verify123!"}' | grep -o '"access_token":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$TOK" ]; then echo "login: OK (got JWT)"; else echo "login: FAILED"; fi

echo "=== RLS: ANON read customers (should be EMPTY/blocked) ==="
curl -s -m 15 -H "apikey: $A" -H "Authorization: Bearer $A" "$B/rest/v1/customers?select=name&limit=3"; echo
echo "=== RLS: MEMBER read customers (should return rows) ==="
curl -s -m 15 -H "apikey: $A" -H "Authorization: Bearer $TOK" "$B/rest/v1/customers?select=name&limit=3"; echo
echo "=== guard: non-admin calls opc_create_user (should ERROR) ==="
curl -s -m 15 -X POST -H "apikey: $A" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"p_name":"X","p_email":"x@y.com","p_password":"x","p_role":"Sales"}' "$B/rest/v1/rpc/opc_create_user"; echo
echo "=== opc_admin_exists via anon (should be true) ==="
curl -s -m 15 -X POST -H "apikey: $A" -H "Content-Type: application/json" "$B/rest/v1/rpc/opc_admin_exists"; echo

echo "=== cleanup temp user ==="
PSQL "delete from auth.users where email='verify@example.com'; delete from public.users where email='verify@example.com';"
echo DONE
"""
s=T.replace("__PW__",sp).replace("__ANON__",ANON)
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i,o,e=c.exec_command("bash -s", timeout=120); i.write(s); i.channel.shutdown_write()
print(o.read().decode(errors="replace")); err=e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:600], file=sys.stderr)
c.close()
