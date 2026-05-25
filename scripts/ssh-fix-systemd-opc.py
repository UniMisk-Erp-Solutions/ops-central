#!/usr/bin/env python3
import os, paramiko
PW = os.environ["SSH_PASSWORD"]
UNIT_CONTENT = """[Unit]
Description=OP Central Supabase (hws00sks44g8k04k8wccooco)
After=docker.service network-online.target
Wants=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=root
WorkingDirectory=/data/coolify/services/hws00sks44g8k04k8wccooco
ExecStartPre=/bin/bash -c 'docker network inspect hws00sks44g8k04k8wccooco >/dev/null 2>&1 || docker network create hws00sks44g8k04k8wccooco'
ExecStartPre=/bin/sed -i 's|^GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG$|GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG}|' /data/coolify/services/hws00sks44g8k04k8wccooco/.env
ExecStart=/usr/bin/docker compose --env-file .env up -d
ExecStop=/usr/bin/docker compose --env-file .env stop
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
"""
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.16.112", username="mithilmistry", password=PW, timeout=20)
sftp = c.open_sftp()
with sftp.file("/tmp/opc-supabase-compose.service", "w") as f:
    f.write(UNIT_CONTENT)
sftp.close()
sp = PW.replace("'", "'\"'\"'")
_, o, _ = c.exec_command(f"echo '{sp}' | sudo -S cp /tmp/opc-supabase-compose.service /etc/systemd/system/opc-supabase-compose.service && echo '{sp}' | sudo -S systemctl daemon-reload && echo '{sp}' | sudo -S systemctl enable opc-supabase-compose.service && systemctl is-enabled opc-supabase-compose.service && systemctl is-enabled docker", timeout=60)
print(o.read().decode())
c.close()
