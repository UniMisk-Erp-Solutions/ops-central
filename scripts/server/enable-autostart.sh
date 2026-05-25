#!/usr/bin/env bash
# One-time on server-room Ubuntu via SSH. Enables boot-time Docker + restart policies.
set -euo pipefail

echo "Enabling Docker on boot..."
sudo systemctl enable docker
sudo systemctl start docker

echo
echo "Supabase-related containers and restart policies:"
sudo docker ps -a --format "{{.Names}}\t{{.Status}}" | grep supabase || echo "(none running yet)"

echo
echo "Setting restart policy to unless-stopped for all supabase containers..."
mapfile -t NAMES < <(sudo docker ps -a --format '{{.Names}}' | grep supabase || true)
if [[ ${#NAMES[@]} -eq 0 ]]; then
  echo "No supabase containers found. Start the Coolify service first, then re-run."
else
  for c in "${NAMES[@]}"; do
    sudo docker update --restart unless-stopped "$c"
    echo "  updated: $c"
  done
fi

echo
echo "Coolify container (if present):"
sudo docker ps -a --format "{{.Names}}\t{{.Status}}" | grep -i coolify || true

echo
echo "Done. Reboot test: sudo reboot"
echo "After reboot: bash scripts/server/health-check.sh"
