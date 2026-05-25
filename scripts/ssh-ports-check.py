#!/usr/bin/env python3
import os, paramiko
pw = os.environ.get("SSH_PASSWORD", "")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.16.112", username="mithilmistry", password=pw, timeout=15)
sp = pw.replace("'", "'\"'\"'")
cmd = f"""echo '{sp}' | sudo -S docker ps --format '{{{{.Names}}}}\\t{{{{.Ports}}}}' | grep -E 'supabase|54321|54323|54331|54333' """
_, o, _ = c.exec_command(cmd, timeout=60)
print(o.read().decode())
c.close()
