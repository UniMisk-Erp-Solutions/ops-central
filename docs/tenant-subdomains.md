# Multi-tenancy & tenant subdomains

How OP Central serves many organizations from **one deployment and one database**.

---

## 1. The two modes

| Mode | Host | Who uses it |
|---|---|---|
| **Shared / generic host** | `ops-central.unimisk.com` | The default. An org with `subdomain = NULL` lives here. After login the user's data comes from their **membership**, not the hostname. |
| **Dedicated tenant subdomain** | `acme.ops-central.unimisk.com` | An org with `subdomain = 'acme'`. Same code, same deployment — the app resolves the label to an org for branding/login. |

**The hostname is never the security boundary.** It is a UX/branding signal only.
Data access is decided server-side by RLS against `organization_memberships`
joined on `auth.uid()`. A user who types another tenant's subdomain still sees
only the orgs they are a member of.

---

## 2. Platform-level (configured ONCE)

| Thing | Where | Notes |
|---|---|---|
| Base domain | `frontend/src/config.js` → `OPC_ENV.APP_BASE_DOMAIN` | **Single source of truth.** Change this one value to move the platform (e.g. to `unimisk.com` for `acme.unimisk.com`). |
| Dev tenant simulation | `OPC_ENV.DEV_TENANT_SUBDOMAIN` | Set to e.g. `acme` to test a tenant host on `localhost` with no DNS. |
| Reserved labels | table `reserved_subdomains` | Labels no tenant may claim (`so-po`, `ops-central`, `api`, `www`, …). A table, so it is editable without a deploy. |
| CORS for edge functions | `supabase/functions/_shared/cors.ts` | One module, imported by every function. Tenant origins match a regex anchored on the apex — never a per-tenant list. |
| Wildcard DNS + TLS | Cloudflare / Vercel | **Manual — see §6.** |

## 3. Per-organization (configured per tenant)

| Thing | Table | Notes |
|---|---|---|
| Identity | `organizations` | `name`, `slug` (unique), `subdomain` (optional), `status`, `branding` jsonb. |
| Who belongs | `organization_memberships` | `user_id` (text = auth uuid), `role` (`admin`/`member`), `is_active`. **This is the security boundary.** |
| Capabilities | `organization_features` | `(organization_id, feature_key, enabled)`. **No row ⇒ OFF** (`coalesce(enabled,false)`). A new org starts with everything off. |
| Tuning | `organization_settings` | Parameters for an **already-active** capability (fiscal year, currency, timezone, `data` jsonb). Deliberately separate from the on/off table. |
| Platform super-admins | `master_admin_memberships` | Not scoped to any org; bypass tenant RLS. Required to onboard new tenants. |

---

## 4. Rollout status

| Phase | What | State |
|---|---|---|
| **1** (`017`, `018`) | Control plane: tables, helper functions, RPCs, default org seeded | ✅ applied |
| **2** (`019`) | `organization_id` on every tenant table + backfill + auto-stamp default | ✅ applied |
| **3** | **Enforcement**: `NOT NULL` + swap `member_all_*` for tenant-scoped policies; per-org `config` | ⏳ **not yet — scheduled** |
| **4** | Feature flags wired into the app's permission system | ⏳ pending |

Phases 1–2 are **non-breaking by construction**: `organization_id` is nullable
and no existing policy was modified, so the app behaves exactly as before. New
rows are already stamped (column `DEFAULT public.default_org_id()`), so by the
time Phase 3 runs the data is ready.

### Before Phase 3 can run
1. Every tenant table must have **0 rows with `organization_id IS NULL`** (verified by `scripts/ssh-apply-tenancy.py`).
2. The **edge function** must stamp `organization_id` when it inserts (it uses the service key, so `auth.uid()` is NULL and the column default does not apply — currently affects `rfqs` inserted by `float-rfq`).
3. `config` must be split to one row per org (the column already exists).
4. A tested rollback script that restores the `member_all_*` policies.

---

## 5. Onboarding a new tenant (runbook)

1. **Create the login first.** In the app: *Settings → Users → add user*. The
   onboarding RPC does not create auth users (not reachable from plain SQL) and
   will raise a clear error if the profile does not exist yet.
2. **Create the org** (as a platform super-admin):
   ```sql
   select * from public.opc_create_organization(
     p_name          => 'Acme Pvt Ltd',
     p_slug          => 'acme',
     p_subdomain     => 'acme',        -- or NULL to live on the shared host
     p_admin_user_id => '<users.id of the first admin>',
     p_fiscal_year   => 'FY26'
   );
   ```
   This validates the slug/subdomain (format, reserved list, collisions), inserts
   the org, upserts the first admin membership, and seeds exactly one
   `organization_settings` row — all in one transaction.
3. **Turn on capabilities** (nothing is on by default):
   ```sql
   select public.opc_set_org_feature('<org id>', 'cross_so_transfer', true);
   ```
4. **DNS** — nothing to do per tenant *if* the wildcard in §6 exists.
5. Verify: open `https://acme.<base domain>` — the pre-auth RPC
   `get_organization_by_subdomain` should resolve the org for the login screen.

### Changing the default org's identity
The current install was adopted as the first tenant (`slug = 'unimisk'`). All of
it is editable:
```sql
update public.organizations
   set name = 'UniMisk ERP Solutions', subdomain = null   -- or 'unimisk'
 where slug = 'unimisk';
```

---

## 6. Manual steps (cannot be done from this repo)

> ⚠️ **These are required before any tenant subdomain will actually load.**

1. **Wildcard DNS** — add `*.ops-central.unimisk.com` pointing at the same Vercel
   deployment as the apex.
2. **TLS — the important one.** Cloudflare's free **Universal SSL only covers one
   level** (`*.unimisk.com`). `*.ops-central.unimisk.com` is **two levels deep**
   and is **not covered**. Options:
   - buy Cloudflare **Advanced Certificate Manager**, or
   - move the base domain to `unimisk.com` (tenants become `acme.unimisk.com`) —
     one-line change to `APP_BASE_DOMAIN`, or
   - add each tenant subdomain to Vercel individually (does not scale).
3. **Vercel domains** — add the wildcard domain to the project.
4. **Auth redirect allowlist** — if magic links / OAuth are ever enabled, add
   `https://*.ops-central.unimisk.com/**`.
5. **Kong CORS (known limitation).** The self-hosted Supabase gateway applies a
   `cors` plugin per route in `volumes/api/kong.yml` that returns
   `Access-Control-Allow-Origin: *`, which **overrides** whatever an edge
   function returns. `_shared/cors.ts` is correct and is what future functions
   should import, but tightening the effective origin requires editing
   `kong.yml` — that affects auth/rest/storage too, so it is deliberately left
   alone here.

The SPA rewrite is already host-agnostic — `vercel.json` serves `index.html` for
every hostname, so no per-tenant deployment config is ever needed.

---

## 7. Rules that must not be broken

- **Never** trust a client-supplied `organization_id`, subdomain, or header.
  It is always derived server-side from `auth.uid()` via the membership table.
- **Never** make the hostname the security boundary.
- Keep **features** (booleans) and **settings** (parameters) in separate tables.
- New capabilities default to **off** — add a row to turn them on, never seed them.
