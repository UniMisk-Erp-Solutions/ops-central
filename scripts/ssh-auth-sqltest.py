#!/usr/bin/env python3
"""Decisive test: can a SQL-created GoTrue user log in? Creates a throwaway user
via direct auth.users+identities insert (bcrypt), tries password login through
Kong :54331, then deletes the test user. Touches only :54331."""
import os, sys
try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr); sys.exit(1)

HOST="192.168.16.112"; USER="mithilmistry"; PW=os.environ.get("SSH_PASSWORD","")
ANON=("eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3OTQ0"
      "ODA4MCwiZXhwIjo0OTM1MTIxNjgwLCJyb2xlIjoiYW5vbiJ9.VrYk5aEwhCXAyXuAtjqk0dfUVw5iOJMKSajL1DwM5xw")
if not PW: print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

TEMPLATE = r"""#!/bin/bash
SID=hws00sks44g8k04k8wccooco
SUDO(){ echo '__PW__' | sudo -S "$@" 2>/dev/null; }
DB=$(SUDO docker ps --format '{{.Names}}' | grep "supabase-db-$SID" | head -1)
cat > /tmp/authtest.sql <<'SQL'
do $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
    confirmation_token,recovery_token,email_change_token_new,email_change)
  values ('00000000-0000-0000-0000-000000000000', v, 'authenticated','authenticated',
    'sqltest@example.com', crypt('TestPass123!', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '');
  insert into auth.identities (provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
  values (v::text, v,
    jsonb_build_object('sub',v::text,'email','sqltest@example.com','email_verified',true,'phone_verified',false),
    'email', now(), now(), now());
end $$;
SQL
SUDO docker cp /tmp/authtest.sql "$DB":/tmp/authtest.sql >/dev/null 2>&1
echo "=== create ==="
SUDO docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/authtest.sql && echo INSERT_OK || echo INSERT_FAIL
echo "=== login via Kong :54331 ==="
curl -s -m 15 -X POST "http://127.0.0.1:54331/auth/v1/token?grant_type=password" \
  -H "apikey: __ANON__" -H "Content-Type: application/json" \
  -d '{"email":"sqltest@example.com","password":"TestPass123!"}' -o /tmp/t.json -w "login HTTP %{http_code}\n"
if grep -o '"access_token"' /tmp/t.json >/dev/null; then echo "RESULT: LOGIN OK (SQL-created user works)"; else echo "RESULT: LOGIN FAILED"; head -c 300 /tmp/t.json; echo; fi
echo "=== cleanup ==="
SUDO docker exec "$DB" psql -U postgres -d postgres -c "delete from auth.users where email='sqltest@example.com';" | tail -1
SUDO docker exec "$DB" rm -f /tmp/authtest.sql; rm -f /tmp/authtest.sql /tmp/t.json
echo DONE
"""
script = TEMPLATE.replace("__PW__", PW.replace("'", "'\"'\"'")).replace("__ANON__", ANON)
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i,o,e=c.exec_command("bash -s", timeout=120); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err=e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:600], file=sys.stderr)
c.close()
