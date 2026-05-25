#!/usr/bin/env bash
# Run ONCE on server-room Ubuntu (local terminal or after SSH works).
# Enables: SSH on boot, Docker on boot, Supabase containers restart after reboot.
set -euo pipefail

SERVICE_ID="${SUPABASE_SERVICE_ID:-hws00sks44g8k04k8wccooco}"

echo "=== 1) SSH on boot ==="
sudo systemctl enable ssh
sudo systemctl start ssh
sudo systemctl is-active ssh
sudo ss -tlnp | grep ':22' || true

echo
echo "=== 2) Docker on boot ==="
sudo systemctl enable docker
sudo systemctl start docker

echo
echo "=== 3) This server's LAN IP (use this in working PC ssh/URLs) ==="
hostname -I
ip -4 addr show | grep -oP '(?<=inet )\d+(\.\d+){3}' | grep -v '^127\.'

echo
echo "=== 4) Supabase containers → restart unless-stopped ==="
mapfile -t NAMES < <(sudo docker ps -a --format '{{.Names}}' | grep supabase || true)
if [[ ${#NAMES[@]} -eq 0 ]]; then
  echo "No supabase containers yet. Start Coolify service first, then re-run this script."
else
  for c in "${NAMES[@]}"; do
    sudo docker update --restart unless-stopped "$c"
    echo "  $c"
  done
fi

mapfile -t COOLIFY < <(sudo docker ps -a --format '{{.Names}}' | grep -i coolify || true)
for c in "${COOLIFY[@]}"; do
  sudo docker update --restart unless-stopped "$c"
  echo "  $c"
done

echo
echo "=== 5) Firewall (allow SSH from LAN) ==="
if command -v ufw >/dev/null; then
  sudo ufw allow OpenSSH || true
  echo "UFW status:"
  sudo ufw status | head -20
fi

echo
echo "Done. Write down the IP above for:"
echo "  ssh mithilmistry@<THAT_IP>"
echo "  http://<THAT_IP>:8000  (Coolify)"
echo "  http://<THAT_IP>:54323 (Studio)"
echo "Reboot test: sudo reboot"
