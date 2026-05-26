#!/usr/bin/env python3
"""Run a local .sql file inside the DB container under a server-side timeout,
showing full stdout+stderr and the psql exit code. Reveals hangs (exit 124)
vs errors. Touches only the hws00 DB container."""
import base64, os, sys
import paramiko
HOST="192.168.16.112"; USER="mithilmistry"; PW=os.environ.get("SSH_PASSWORD","")
PATH=sys.argv[1]; SECS=sys.argv[2] if len(sys.argv)>2 else "25"
b64=base64.b64encode(open(PATH,"rb").read()).decode()
sp=PW.replace("'", "'\"'\"'")
remote=f"""#!/bin/bash
SID=hws00sks44g8k04k8wccooco
SUDO(){{ echo '{sp}' | sudo -S "$@" 2>/dev/null; }}
DB=$(SUDO docker ps --format '{{{{.Names}}}}' | grep "supabase-db-$SID" | head -1)
cat > /tmp/timed.b64 <<'B64'
{b64}
B64
base64 -d /tmp/timed.b64 > /tmp/timed.sql
SUDO docker cp /tmp/timed.sql "$DB":/tmp/timed.sql >/dev/null 2>&1
SUDO docker exec "$DB" bash -c "timeout {SECS} psql -U postgres -d postgres -f /tmp/timed.sql; echo PSQL_EXIT=\\$?"
SUDO docker exec "$DB" rm -f /tmp/timed.sql; rm -f /tmp/timed.b64 /tmp/timed.sql
echo DONE
"""
c=paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PW, timeout=20)
i,o,e=c.exec_command("bash -s", timeout=int(SECS)+40); i.write(remote); i.channel.shutdown_write()
print(o.read().decode(errors="replace")); err=e.read().decode(errors="replace")
if err.strip(): print("STDERR:", err[:1000], file=sys.stderr)
c.close()
