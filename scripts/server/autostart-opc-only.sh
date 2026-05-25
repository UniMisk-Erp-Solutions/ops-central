#!/usr/bin/env bash
# Auto-restart ONLY supabase-hws00sks44g8k04k8wccooco — does not touch msc8 or other IDs.
set -euo pipefail

SID="hws00sks44g8k04k8wccooco"

echo "=== OP Central Supabase autostart ($SID only) ==="

echo "Docker on boot:"
sudo systemctl enable docker 2>/dev/null || true
sudo systemctl enable ssh 2>/dev/null || true

mapfile -t NAMES < <(sudo docker ps -a --format '{{.Names}}' | grep "$SID" || true)

if [[ ${#NAMES[@]} -eq 0 ]]; then
  echo "No containers found for $SID yet."
  echo "Deploy supabase-hws00sks44g8k04k8wccooco in Coolify first, then run this script again."
  exit 0
fi

for c in "${NAMES[@]}"; do
  sudo docker update --restart unless-stopped "$c"
  echo "  restart policy: $c"
done

echo
echo "Status:"
sudo docker ps --format 'table {{.Names}}\t{{.Status}}' | grep "$SID" || true

echo
echo "Ports (expect 54331 and 54333 when compose is configured):"
sudo docker ps --format '{{.Names}}\t{{.Ports}}' | grep "$SID" | grep -E '54331|54333' || echo "  (54331/54333 not exposed yet — add in Coolify compose)"

echo
echo ""
echo "Optional: enable systemd boot service (run on server as root once):"
echo "  sudo systemctl enable opc-supabase-compose.service"
echo "  (created by scripts/ssh-autostart-opc.py)"

echo "Done. Other supabase projects were not modified."
