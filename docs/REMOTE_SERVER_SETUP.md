# Remote server workflow (no Remote Desktop)

Control the **server-room Ubuntu PC** from your **working PC** using only:

- **SSH** — full terminal (setup, Docker, backups)
- **SCP** — copy Edge Function files
- **Browser** — Coolify + Supabase Studio
- **Cursor** — edit code locally, or Remote-SSH into the server

---

## Architecture

```
Working PC (Cursor, npm, browser)
    │  SSH / SCP / HTTP (LAN only)
    ▼
Server-room PC @ 192.168.16.112 (LAN — confirm with `hostname -I`)
    ├── Coolify     → :8000
    └── Supabase    → :54321 (API)  :54323 (Studio)
        ├── Postgres, Auth, Storage, Realtime
        └── Edge Functions → /functions/v1/main
```

**Coolify service ID (current):** `hws00sks44g8k04k8wccooco`  
**Coolify service name:** `supabase-hws00sks44g8k04k8wccooco`

Container names follow: `supabase-<component>-hws00sks44g8k04k8wccooco`  
Data path: `/data/coolify/services/hws00sks44g8k04k8wccooco/`

---

## URLs (from your working PC)

| Service | URL | Use for |
|---------|-----|---------|
| Coolify | http://192.168.16.112:8000 | Deploy / env / logs |
| Supabase Studio | http://192.168.16.112:54323 | Tables, SQL, Auth UI |
| Supabase API | http://192.168.16.112:54321 | Frontend `.env`, REST, Auth |
| Edge Functions | http://192.168.16.112:54321/functions/v1/main | Backend API |

**Never use `localhost` on your working PC** for Supabase — use the server LAN IP from `hostname -I` (currently `192.168.16.112`).  
**Do not use** `192.168.12.116` — that was the wrong/old IP.  
**Never put `54323` in frontend `.env`** — use `54321`.

---

## 1. One-time: SSH terminal (no RDP)

### On server-room Ubuntu (physical keyboard once, or existing access)

```bash
sudo apt update
sudo apt install -y openssh-server
sudo systemctl enable ssh
sudo systemctl start ssh
sudo ufw allow OpenSSH
# Optional: allow LAN dashboards only (adjust subnet if needed)
sudo ufw allow from 192.168.12.0/24 to any port 8000
sudo ufw allow from 192.168.12.0/24 to any port 54321
sudo ufw allow from 192.168.12.0/24 to any port 54323
sudo ufw enable
```

### On your working PC (Windows PowerShell)

```powershell
# Test connection (same LAN / VPN)
ssh mithilmistry@192.168.12.116

# Passwordless login (recommended)
ssh-keygen -t ed25519 -C "cursor-work-pc"
type $env:USERPROFILE\.ssh\id_ed25519.pub
# Copy output, then on server:
#   mkdir -p ~/.ssh && chmod 700 ~/.ssh
#   nano ~/.ssh/authorized_keys   # paste pubkey, save
#   chmod 600 ~/.ssh/authorized_keys
```

Optional `~/.ssh/config` on Windows (`C:\Users\Galaxy\.ssh\config`):

```
Host opc-server
  HostName 192.168.12.116
  User mithilmistry
  IdentityFile ~/.ssh/id_ed25519
```

Then: `ssh opc-server`

### Cursor terminal without RDP

1. Install extension: **Remote - SSH** (Microsoft).
2. `F1` → **Remote-SSH: Connect to Host** → `mithilmistry@192.168.12.116`.
3. Open folder e.g. `/home/mithilmistry` or Coolify paths (read-only caution on `/data/coolify`).

You get a full integrated terminal on the server — same as SSH, inside Cursor.

---

## 2. Static IP (critical)

On your router, **DHCP reservation** for the server-room PC MAC → **192.168.12.116**.

If the IP changes, every URL and `.env` breaks until you update them.

---

## 3. Auto-start Docker + Coolify + Supabase (never off)

Run once on the server (via SSH):

```bash
# Docker on boot
sudo systemctl enable docker
sudo systemctl start docker

# All Coolify-managed containers should restart automatically
sudo docker ps -a --format "{{.Names}}\t{{.RestartPolicy}}" | grep supabase

# If any show "no", fix in Coolify UI: Service → Settings → restart policy
# Or (emergency) per container:
# sudo docker update --restart unless-stopped CONTAINER_NAME
```

Coolify itself should also start on boot (how you installed it):

- **Docker install:** ensure the Coolify container has `--restart unless-stopped`.
- **Systemd install:** `sudo systemctl enable coolify` (if applicable).

After a reboot, verify:

```bash
ssh mithilmistry@192.168.12.116 "sudo docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'coolify|supabase'"
curl -s -o /dev/null -w "%{http_code}" http://192.168.12.116:54321/rest/v1/
```

---

## 4. Discover exact container names (new project)

Old docs used `msc8gwwwsw0c04g8kccwss0s`. Your **new** ID is `hws00sks44g8k04k8wccooco`.

```bash
ssh mithilmistry@192.168.12.116

# List Supabase containers
sudo docker ps -a --format "table {{.Names}}\t{{.Status}}" | grep supabase

# Kong holds anon/service keys
KONG=$(sudo docker ps --format '{{.Names}}' | grep 'supabase-kong-hws00sks44g8k04k8wccooco' | head -1)
sudo docker exec "$KONG" printenv SUPABASE_ANON_KEY
sudo docker exec "$KONG" printenv SUPABASE_SERVICE_ROLE_KEY

# Edge functions volume
sudo ls -la /data/coolify/services/hws00sks44g8k04k8wccooco/volumes/functions/
```

If the path differs:

```bash
sudo find /data/coolify/services -maxdepth 3 -type d -name functions 2>/dev/null
```

---

## 5. Frontend `.env` (working PC)

Copy `.env.example` to `.env` and fill keys from step 4.

```env
VITE_SUPABASE_URL=http://192.168.12.116:54321
VITE_SUPABASE_ANON_KEY=<from kong container>
VITE_API_URL=http://192.168.12.116:54321/functions/v1/main
```

Run frontend (when you add Vite/React):

```bash
npm run dev -- --host 0.0.0.0
```

`--host 0.0.0.0` lets other devices on LAN open your dev server; Supabase URL still points at **192.168.12.116**, not localhost.

---

## 6. Deploy Edge Function (working PC → server)

From project root on **working PC** (PowerShell):

```powershell
.\scripts\deploy-edge-function.ps1
```

Or manually:

```powershell
scp supabase\functions\main\index.ts mithilmistry@192.168.12.116:/tmp/main-index.ts
ssh mithilmistry@192.168.12.116
```

On **server**:

```bash
sudo cp /tmp/main-index.ts /data/coolify/services/hws00sks44g8k04k8wccooco/volumes/functions/main/index.ts
EDGE=$(sudo docker ps --format '{{.Names}}' | grep 'supabase-edge-functions-hws00sks44g8k04k8wccooco' | head -1)
sudo docker restart "$EDGE"
curl -i http://127.0.0.1:54321/functions/v1/main
```

---

## 7. Health checks (remote)

```bash
ssh mithilmistry@192.168.12.116 'bash -s' < scripts/server/health-check.sh
```

Or interactively:

```bash
ssh mithilmistry@192.168.12.116
sudo docker ps -a --format "table {{.Names}}\t{{.Status}}" | grep supabase

DB=$(sudo docker ps --format '{{.Names}}' | grep 'supabase-db-hws00sks44g8k04k8wccooco' | head -1)
sudo docker exec -it "$DB" psql -U postgres -d postgres -c "select count(*) from auth.users;"
sudo docker exec -it "$DB" psql -U postgres -d postgres -c "\dt public.*"
```

---

## 8. Daily workflow summary

| Task | Where |
|------|--------|
| Edit OP Central / app code | Working PC in Cursor (local folder) |
| Server shell | `ssh mithilmistry@192.168.12.116` or Cursor Remote-SSH |
| Coolify / Studio | Browser → `:8000` / `:54323` |
| Update Edge Function | `scp` + restart edge container |
| DB migrations | Studio SQL or `psql` via SSH |

**Do not** run `npx supabase start` on your working PC for this production-like stack.  
**Do not** put frontend source inside Supabase volumes.

---

## 9. SSH timeout: different subnets (most common)

**Symptom:** On Ubuntu, `ss -tlnp | grep :22` shows sshd listening, but from working PC:

`ssh: connect to host 192.168.12.116 port 22: Connection timed out`

**Cause:** Working PC and server are not on the same routable LAN segment.

Example from a real check:

| Machine | IP |
|---------|-----|
| Working PC | `192.168.19.103` (gateway `192.168.19.254`) |
| Server-room PC | `192.168.12.116` |

Ping goes to `192.168.19.254` → **Destination host unreachable**. SSH never reaches the server; this is **not** an OpenSSH install problem.

### Fix A — Same subnet (simplest)

1. On **Ubuntu server**, confirm IP: `hostname -I` and `ip -4 addr`.
2. Put **both PCs on the same network** (same Wi‑Fi, or same switch).
3. Either:
   - Move working PC to `192.168.12.x`, **or**
   - Reconfigure server to `192.168.19.x` and update all URLs `.env` to that IP.
4. Router: **DHCP reservation** so the server IP never changes.
5. Test from working PC: `ping <server-ip>` then `ssh mithilmistry@<server-ip>`.

### Fix B — Router inter-VLAN routing

If your router has both `192.168.12.0/24` and `192.168.19.0/24`, enable **inter-LAN routing** / allow traffic between subnets. Many home routers isolate guest Wi‑Fi — do not use guest network for the server.

### Fix C — Tailscale / WireGuard (works across subnets and from outside)

Install on **both** machines; SSH using Tailscale IP (e.g. `100.x.x.x`). No port forward, no RDP. Best when working PC is often off-site.

### Fix D — Server firewall (after ping works)

Only if ping succeeds but SSH still fails:

```bash
sudo ufw allow OpenSSH
sudo ufw status
```

### Verify on Ubuntu (server keyboard once)

```bash
hostname -I
ip route | grep default
sudo systemctl is-enabled ssh
sudo systemctl is-active ssh
```

---

## 10. Troubleshooting (other)

| Problem | Fix |
|---------|-----|
| `ssh: connect timed out` | See **§9** — subnets/VLAN/VPN first; then firewall |
| Browser can't open :54321 | `sudo docker ps`, firewall, Coolify service "Running" |
| Wrong keys / 401 | Re-fetch keys from **kong** container for service `hws00sks44g8k04k8wccooco` |
| Edge function 404 | Check path under `volumes/functions/main/index.ts`, restart edge container |
| IP changed | Router DHCP reservation; update all URLs and `.env` |

---

## 10. Optional: SSH from outside home LAN

For access without being on the same network (still **no RDP**):

- WireGuard / Tailscale on server + working PC, **or**
- Router port-forward **22 only** to 192.168.12.116 (use keys, disable password auth).

Prefer VPN over exposing SSH to the public internet.
