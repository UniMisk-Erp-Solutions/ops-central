#!/usr/bin/env python3
import os, paramiko
pw = os.environ["SSH_PASSWORD"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.16.112", username="mithilmistry", password=pw, timeout=15)
sp = pw.replace("'", "'\"'\"'")
path = "/data/coolify/services/hws00sks44g8k04k8wccooco/.env"
cmd = f"echo '{sp}' | sudo -S cat '{path}' 2>&1"
_, o, e = c.exec_command(cmd, timeout=60)
print(o.read().decode())
print(e.read().decode())
c.close()
