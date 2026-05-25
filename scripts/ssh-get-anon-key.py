#!/usr/bin/env python3
import os, paramiko
pw = os.environ["SSH_PASSWORD"]
SID = "hws00sks44g8k04k8wccooco"
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.16.112", username="mithilmistry", password=pw, timeout=15)
sp = pw.replace("'", "'\"'\"'")
cmd = f"""echo '{sp}' | sudo -S bash -c '
KONG=$(docker ps --format "{{{{.Names}}}}" | grep "supabase-kong-{SID}" | head -1)
echo KONG=$KONG
docker exec "$KONG" printenv SUPABASE_ANON_KEY
curl -s -o /dev/null -w "with_key: %{{http_code}}\\n" http://127.0.0.1:54331/rest/v1/ -H "apikey: $(docker exec "$KONG" printenv SUPABASE_ANON_KEY)"
curl -s -o /dev/null -w "studio: %{{http_code}}\\n" http://127.0.0.1:54333/
'
"""
_, o, _ = c.exec_command(cmd, timeout=60)
print(o.read().decode())
c.close()
