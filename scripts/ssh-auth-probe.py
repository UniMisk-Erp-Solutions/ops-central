#!/usr/bin/env python3
"""Read-only probe of GoTrue (Supabase Auth) on the OP Central instance.
Does NOT print the service-role key. Creates a throwaway probe user via the
admin API to confirm it works, then deletes it. Touches only the hws00 service.
"""
import os, sys
try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr); sys.exit(1)

HOST = os.environ.get("SSH_HOST", "192.168.16.112")
USER = os.environ.get("SSH_USER", "mithilmistry")
PW = os.environ.get("SSH_PASSWORD", "")
SID = "hws00sks44g8k04k8wccooco"
ANON = ("eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3OTQ0"
        "ODA4MCwiZXhwIjo0OTM1MTIxNjgwLCJyb2xlIjoiYW5vbiJ9.VrYk5aEwhCXAyXuAtjqk0dfUVw5iOJMKSajL1DwM5xw")
if not PW:
    print("Set SSH_PASSWORD", file=sys.stderr); sys.exit(1)

sp = PW.replace("'", "'\"'\"'")
script = f"""#!/bin/bash
SID='{SID}'; ANON='{ANON}'
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}
KONG=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-kong-$SID" | head -1)
SR=$(SUDO docker exec "$KONG" printenv SERVICE_ROLE_KEY 2>/dev/null)
[ -z "$SR" ] && SR=$(SUDO docker exec "$KONG" printenv SUPABASE_SERVICE_ROLE_KEY 2>/dev/null)
if [ -n "$SR" ]; then echo "service_role key: FOUND (hidden)"; else echo "service_role key: NOT FOUND"; fi
echo "--- /auth/v1/health ---"; curl -s http://127.0.0.1:54331/auth/v1/health; echo
echo "--- /auth/v1/settings (signup/autoconfirm flags) ---"
curl -s http://127.0.0.1:54331/auth/v1/settings -H "apikey: $ANON"; echo
echo "--- admin create user (proper API) ---"
RESP=$(curl -s -X POST http://127.0.0.1:54331/auth/v1/admin/users -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" -d '{{"email":"probe-del@example.com","password":"Probe12345!","email_confirm":true}}' -w "\nHTTP:%{{http_code}}")
echo "$RESP" | sed 's/"[a-zA-Z0-9._-]\\{{60,}}"/"<hidden>"/g' | head -c 600; echo
UID=$(echo "$RESP" | grep -o '"id":"[0-9a-f-]\\{{36\\}}"' | head -1 | cut -d'"' -f4)
echo "probe user id: $UID"
echo "--- password login test ---"
curl -s -X POST "http://127.0.0.1:54331/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" -d '{{"email":"probe-del@example.com","password":"Probe12345!"}}' -o /tmp/tok.json -w "login HTTP %{{http_code}}\n"
grep -o '"access_token"' /tmp/tok.json >/dev/null && echo "login: access_token received" || echo "login: no token"
echo "--- cleanup probe user ---"
if [ -n "$UID" ]; then curl -s -X DELETE "http://127.0.0.1:54331/auth/v1/admin/users/$UID" -H "apikey: $SR" -H "Authorization: Bearer $SR" -o /dev/null -w "delete HTTP %{{http_code}}\n"; fi
rm -f /tmp/tok.json
echo DONE
"""
c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i, o, e = c.exec_command("bash -s", timeout=120); i.write(script); i.channel.shutdown_write()
print(o.read().decode(errors="replace"))
err = e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err, file=sys.stderr)
c.close()
