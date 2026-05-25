#!/usr/bin/env python3
"""Match OPC Supabase autostart to other Coolify Supabase (msc8)."""
import os
import paramiko

PW = os.environ["SSH_PASSWORD"]
SID_OPC = "hws00sks44g8k04k8wccooco"
SID_OTHER = "msc8gwwwsw0c04g8kccwss0s"
SP = PW.replace("'", "'\"'\"'")

SCRIPT = """#!/bin/bash
SUDO() { echo '""" + SP + """' | sudo -S "$@"; }

echo "=== Docker + SSH on boot ==="
SUDO systemctl enable docker
SUDO systemctl enable ssh

echo ""
echo "=== Other Supabase restart policies (reference) ==="
for c in $(SUDO docker ps -a --format '{{.Names}}' | grep """ + SID_OTHER + """ | head -3); do
  pol=$(SUDO docker inspect "$c" --format '{{.HostConfig.RestartPolicy.Name}}')
  echo "  $c -> $pol"
done

echo ""
echo "=== OPC: set unless-stopped on ALL containers ==="
count=0
for c in $(SUDO docker ps -a --format '{{.Names}}' | grep """ + SID_OPC + """ || true); do
  SUDO docker update --restart unless-stopped "$c"
  pol=$(SUDO docker inspect "$c" --format '{{.HostConfig.RestartPolicy.Name}}')
  echo "  $c -> $pol"
  count=$((count+1))
done
echo "Updated $count OPC containers"

echo ""
echo "=== Ensure Docker network exists after reboot ==="
SUDO docker network inspect """ + SID_OPC + """ >/dev/null 2>&1 || SUDO docker network create """ + SID_OPC + """

echo ""
echo "=== systemd: OPC compose on boot (same idea as Coolify stacks) ==="
UNIT=/etc/systemd/system/opc-supabase-compose.service
SUDO tee "$UNIT" >/dev/null << 'UNITEOF'
[Unit]
Description=OP Central Supabase (Coolify hws00sks44g8k04k8wccooco)
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
UNITEOF

SUDO systemctl daemon-reload
SUDO systemctl enable opc-supabase-compose.service
echo "Enabled: opc-supabase-compose.service"

echo ""
echo "=== Status ==="
SUDO systemctl is-enabled docker
SUDO systemctl is-enabled opc-supabase-compose.service
SUDO docker ps --format '{{.Names}}\t{{.Status}}' | grep """ + SID_OPC + """ | head -8

echo ""
echo "DONE"
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.16.112", username="mithilmistry", password=PW, timeout=20)
stdin, stdout, stderr = c.exec_command("bash -s", timeout=180)
stdin.write(SCRIPT)
stdin.channel.shutdown_write()
print(stdout.read().decode())
e = stderr.read().decode()
if e.strip():
    print("stderr:", e[-2000:])
c.close()
