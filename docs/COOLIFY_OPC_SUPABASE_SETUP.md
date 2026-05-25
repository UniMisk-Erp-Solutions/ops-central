# OP Central — Coolify Supabase setup (one project only)

**Your OP Central instance (do not touch others):**

| Item | Value |
|------|--------|
| Coolify service name | `supabase-hws00sks44g8k04k8wccooco` |
| Service ID | `hws00sks44g8k04k8wccooco` |
| Server LAN IP | `192.168.16.112` (check with `hostname -I`) |

**Already running on this server (leave alone):**

- `supabase-*-msc8gwwwsw0c04g8kccwss0s` → uses ports **54321** (API) and **54323** (Studio)

**OP Central must use different ports** so other projects keep working:

| OP Central | Port |
|------------|------|
| API / Kong | **54331** |
| Studio UI | **54333** |

---

## Current status (checked via SSH)

- Coolify data folder exists: `/data/coolify/services/hws00sks44g8k04k8wccooco/`
- **No Docker containers** running with `hws00sks44g8k04k8wccooco` yet → you must **Deploy** in Coolify
- Ports 54321 / 54323 are used by the **other** Supabase → do not change that stack

---

## Part 1 — Coolify UI (from Windows browser)

Open: **http://192.168.16.112:8000**

### 1. Open your service only

1. **Projects** → open the project that contains **supabase-hws00sks44g8k04k8wccooco**
2. Click service **supabase-hws00sks44g8k04k8wccooco** (not any `msc8...` service)

### 2. Expose ports (Docker Compose)

1. Go to **Service** → **Edit Compose File** (or **Configuration** → compose)
2. Find service **`supabase-kong`** — ports must be a **YAML list**, not one string:

```yaml
  supabase-kong:
    ports:
      - '54331:8000'
    image: 'kong/kong:3.9.1'
```

**Wrong (Coolify editor sometimes saves this):**
```yaml
  supabase-kong:
    ports: '54331:8000'    # INVALID — deploy may fail or ignore ports
```

3. Find service **`supabase-studio`**:

```yaml
  supabase-studio:
    ports:
      - '54333:3000'
    image: 'supabase/studio:...'
```

4. Fix **`supabase-kong` environment** — remove or fix this broken line if present:
```yaml
      - SERVICE_URL_SUPABASEKONG_8000    # INVALID (no = value)
```
Use nothing, or:
```yaml
      - 'SERVICE_URL_SUPABASEKONG_8000=${SERVICE_URL_SUPABASEKONG_8000}'
```

4. **Save**

> Do **not** edit the `msc8...` compose file. Only this service.

### 3. Deploy

1. Click **Deploy** (or **Restart** if already deployed once)
2. Wait until all containers show **Running** (can take 5–15 minutes first time)
3. Do **not** stop or redeploy other Supabase services

### 4. Verify in browser (Windows PC)

| Check | URL |
|-------|-----|
| Studio | http://192.168.16.112:54333 |
| API | http://192.168.16.112:54331/rest/v1/ |

Studio should load the Supabase dashboard. API may return `401` without a key — that is normal.

---

## Auto-start on PC reboot (like other Supabase)

Three layers (OPC only — does **not** touch `msc8...`):

1. **`docker` on boot** — `systemctl enable docker`
2. **Each OPC container** — `restart: unless-stopped` (Docker restarts them when daemon starts)
3. **systemd fallback** — `opc-supabase-compose.service` runs `docker compose up -d` for `hws00sks44g8k04k8wccooco` if stacks are down

From Windows (one time):

```powershell
$env:SSH_PASSWORD='your-password'
python scripts/ssh-autostart-opc.py
```

Or on Ubuntu:

```bash
bash ~/opc-autostart.sh   # unless-stopped only
sudo systemctl enable opc-supabase-compose.service   # after ssh-autostart-opc.py
```

Verify after setup:

```bash
sudo systemctl is-enabled docker
sudo systemctl is-enabled opc-supabase-compose.service
sudo docker inspect supabase-kong-hws00sks44g8k04k8wccooco --format '{{.HostConfig.RestartPolicy.Name}}'
# should print: unless-stopped
```

---

## Part 2 — Auto-start after Ubuntu reboot (SSH once)

SSH from Windows:

```powershell
ssh mithilmistry@192.168.16.112
```

Copy script to server or paste. Run **only** the OPC autostart script:

```bash
# On Ubuntu — only touches containers named *hws00sks44g8k04k8wccooco*
bash ~/opc-autostart.sh
```

Or from your project (after `scp`):

```powershell
scp scripts/server/autostart-opc-only.sh mithilmistry@192.168.16.112:~/opc-autostart.sh
ssh mithilmistry@192.168.16.112 "chmod +x ~/opc-autostart.sh && ~/opc-autostart.sh"
```

Also enable Docker on boot (once):

```bash
sudo systemctl enable docker
sudo systemctl enable ssh
```

Coolify itself should already restart with Docker; your Supabase OPC containers get `unless-stopped` from the script above.

---

## Part 3 — Get API keys (OP Central only)

After deploy, on Ubuntu SSH:

```bash
SID=hws00sks44g8k04k8wccooco
KONG=$(sudo docker ps --format '{{.Names}}' | grep "supabase-kong-$SID" | head -1)
echo "Kong container: $KONG"
sudo docker exec "$KONG" printenv SUPABASE_ANON_KEY
```

Put the anon key in your Windows `.env` (see `.env.example`).

---

## Part 4 — Run SQL schema (Studio)

1. Open http://192.168.16.112:54333  
2. **SQL Editor** → New query  
3. Paste contents of `supabase/migrations/001_op_central.sql` from this repo  
4. **Run**

---

## Part 5 — Health check (OP Central only)

On Ubuntu:

```bash
SID=hws00sks44g8k04k8wccooco
sudo docker ps --format 'table {{.Names}}\t{{.Status}}' | grep "$SID"
curl -s -o /dev/null -w "API 54331: %{http_code}\n" http://127.0.0.1:54331/rest/v1/
curl -s -o /dev/null -w "Studio 54333: %{http_code}\n" http://127.0.0.1:54333/
```

From Windows after deploy:

```powershell
curl http://192.168.16.112:54331/rest/v1/
curl http://192.168.16.112:54333/
```

---

## “No API key found in request” on :54331/rest/v1/

**This is not a deploy failure.** Kong is running; the browser did not send a Supabase key.

| How you open it | Result |
|-----------------|--------|
| Browser address bar → `/rest/v1/` | **No API key found** (expected) |
| App / curl with `apikey` header | **200** (working) |
| Supabase Studio → :54333 | UI (no apikey in URL) |

Get anon key (SSH):

```bash
sudo docker exec supabase-kong-hws00sks44g8k04k8wccooco printenv SUPABASE_ANON_KEY
```

Test API (PowerShell):

```powershell
$key = "PASTE_ANON_KEY"
curl.exe -H "apikey: $key" -H "Authorization: Bearer $key" http://192.168.16.112:54331/rest/v1/
```

Frontend `.env` uses the same key — `@supabase/supabase-js` sends it automatically.

---

## Part 6 — Windows `.env` (OP Central app)

```env
VITE_SUPABASE_URL=http://192.168.16.112:54331
VITE_SUPABASE_ANON_KEY=<paste from kong container>
VITE_API_URL=http://192.168.16.112:54331/functions/v1/main
```

**Never** use `54323` in frontend `.env`.  
**Never** use `localhost` on your working PC for Supabase.

---

## Part 7 — Node.js API (local dev on Windows)

```powershell
cd backend
npm install
copy ..\.env .env
npm run dev
```

Test: http://127.0.0.1:3001/health

---

## Why Coolify Deploy did “nothing” (fixed via SSH)

Two separate bugs blocked **all** containers from starting:

### Bug 1 — Broken `.env` line (Coolify keeps re-writing it)

```env
GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG    ← missing }
```

**Symptom:** `Invalid template: "${SERVICE_URL_SUPABASEKONG"`  
**Fix in Coolify UI:** Environment → set `GOTRUE_SITE_URL` to exactly:

```env
GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG}
```

Save, then Deploy. If you edit only on disk, the next Coolify save can break it again.

### Bug 2 — Docker network missing

**Symptom:** `network hws00sks44g8k04k8wccooco declared as external, but could not be found`  
**Fix (once on server):**

```bash
sudo docker network create hws00sks44g8k04k8wccooco
cd /data/coolify/services/hws00sks44g8k04k8wccooco
sudo docker compose --env-file .env up -d
```

Coolify normally creates this network on deploy; if deploy fails at `.env` parse time, the network never gets created.

### After both fixes

| URL | Expected |
|-----|----------|
| http://192.168.16.112:54333 | Studio (307 redirect is OK) |
| http://192.168.16.112:54331/rest/v1/ | API — browser shows **No API key found** (normal); use `apikey` header or `.env` |

---

## Deploy error: `Invalid template: "${SERVICE_URL_SUPABASEKONG"`

**Cause:** Broken line in service `.env` — missing closing `}`:

```env
# WRONG
GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG

# CORRECT
GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG}
```

**Fix in Coolify:** Service → **Environment Variables** (or **Storages** → edit `.env`) → fix `GOTRUE_SITE_URL` → Save → **Deploy**.

**Fix on server (SSH):**

```bash
sudo sed -i 's|^GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG$|GOTRUE_SITE_URL=${SERVICE_URL_SUPABASEKONG}|' \
  /data/coolify/services/hws00sks44g8k04k8wccooco/.env
grep '^GOTRUE_SITE_URL=' /data/coolify/services/hws00sks44g8k04k8wccooco/.env
```

---

## Mistakes to avoid

| Wrong | Right |
|-------|--------|
| Use 54321/54323 for OP Central | Use **54331/54333** (other project owns 54321/54323) |
| Stop `msc8...` containers | Leave them running |
| Deploy / edit wrong Coolify service | Only **supabase-hws00sks44g8k04k8wccooco** |
| `192.168.12.116` | Use **`192.168.16.112`** (current LAN IP) |
| `npx supabase start` on Windows | Supabase runs only on Ubuntu / Coolify |

---

## Quick checklist

- [ ] Coolify: compose ports **54331** + **54333** on **hws00...** service only  
- [ ] Coolify: **Deploy** → all `*-hws00sks44g8k04k8wccooco` containers running  
- [ ] Browser: Studio opens at **:54333**  
- [ ] SSH: autostart script run once  
- [ ] Router: DHCP reserve **192.168.16.112**  
- [ ] SQL migration run in Studio  
- [ ] `.env` on Windows with **54331** + anon key  

When all checked, OP Central local Supabase is ready for the Node backend and Edge Function deploy.
