#!/usr/bin/env python3
import os, paramiko
pw = os.environ["SSH_PASSWORD"]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.16.112", username="mithilmistry", password=pw, timeout=15)
sp = pw.replace("'", "'\"'\"'")
for cmd in [
    f"echo '{sp}' | sudo -S find /data/coolify/services/hws00sks44g8k04k8wccooco -maxdepth 3 -type f \\( -name '*.yml' -o -name '*.yaml' -o -name 'docker-compose*' \\) 2>/dev/null | head -20",
    f"echo '{sp}' | sudo -S ls -laR /data/coolify/services/hws00sks44g8k04k8wccooco/ 2>/dev/null | head -40",
]:
    _, o, _ = c.exec_command(cmd, timeout=60)
    print(o.read().decode())
c.close()
