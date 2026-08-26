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
| Base domain | `frontend/src/config.js` → `OPC_ENV.APP_BASE_DOMAIN` | **Single source of truth** — `ops-central.unimisk.com`, so tenants are `acme.ops-central.unimisk.com`. Change this one value to move the platform. |
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
| **3** (`020`, `021`) | **Enforcement**: `NOT NULL` + `member_all_*` → `tenant_all_*`; per-org `config`; org-scoped `users` | ✅ **applied — isolation is LIVE** |
| **4** (`022`) | Active-org scoping + per-org feature flags wired into nav & Settings | ✅ applied |

Phases 1–2 are **non-breaking by construction**: `organization_id` is nullable
and no existing policy was modified, so the app behaves exactly as before. New
rows are already stamped (column `DEFAULT public.default_org_id()`), so by the
time Phase 3 runs the data is ready.

### Phase 3 — what is now enforced

A row is visible only to members of its organization:
```sql
create policy tenant_all_<table> on <table> for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
```
`is_org_member` joins `organization_memberships` against `auth.uid()`. The
hostname is never consulted, and `organization_id` is never accepted from the
client — new rows are stamped by the column default `public.default_org_id()`.

`config` and `users` are scoped too: you see config for your org, and only the
profiles of people you share an organization with.

**Verified on the live database:**

| Check | Result |
|---|---|
| Member of the live org | sees 39 SOs / 23 sourcings / 5 customers — unchanged |
| User with **no** membership | sees **0** rows |
| Second tenant's user | sees only its **own** row, never the live tenant's |
| Live tenant's plain user | **0** rows leaked from the second tenant |
| Duplicate subdomain (different case) | rejected by the unique index |
| `anon` (logged out) | 401 on every table |

**Rollback:** `supabase/migrations/021_phase3_tenant_rls_ROLLBACK.sql` restores the
tenant-blind `member_all_*` policies and drops the `NOT NULL`, without touching
data — so re-applying 021 afterwards is a clean forward step.
Run it with `python scripts/ssh-apply-sql.py supabase/migrations/021_phase3_tenant_rls_ROLLBACK.sql`.

### Gotchas that are already handled
- **New users** get a membership in their creator's org automatically
  (`opc_create_user`) — otherwise they would belong to no org and see nothing.
- **The edge function** runs with the service key (`auth.uid()` is NULL), so the
  column default cannot apply. `float-rfq` derives `organization_id` from the
  parent sourcing and returns a clear 409 if it cannot.

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

1. **Wildcard DNS** — add CNAME `*.ops-central` → the same Vercel target as
   `ops-central.unimisk.com`, set to **DNS only (grey cloud)**. It does not affect
   `ops-central.unimisk.com` or `so-po.unimisk.com`, which have their own records.
2. **TLS — who actually issues the certificate.** `ops-central.unimisk.com` is
   **DNS-only in Cloudflare (grey cloud)** and resolves straight to Vercel, so
   **Vercel terminates TLS and issues the certificate** (verified: `Server: Vercel`,
   no `cf-ray`, cert = Let's Encrypt `CN=ops-central.unimisk.com`).
   Cloudflare's 1-level Universal SSL limit therefore **does not apply to the app**
   — that limit only affects hosts Cloudflare proxies, like the `so-po` tunnel
   (Google Trust Services cert for `unimisk.com`).
   So a **2-level wildcard is fine here**: add `*.ops-central.unimisk.com` as a
   Vercel domain and Vercel issues a wildcard Let's Encrypt cert. Vercel will ask
   for a one-time DNS TXT record (`_acme-challenge.ops-central.unimisk.com`) to
   validate it — add that in Cloudflare.
   ⚠️ Keep the wildcard record **DNS-only / grey cloud**. If you proxy it through
   Cloudflare, Cloudflare terminates TLS again and the 1-level limit comes back.
3. **Vercel domains** — add `*.ops-central.unimisk.com` to the project (one entry
   covers every tenant; never one entry per organization). Complete the TXT
   validation Vercel shows.
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

---

## 8. Active organization (who sees what, when)

Every user — **including platform super-admins** — works inside exactly ONE
organization at a time.

- `active_org_id()` = the org you last switched to, else your primary membership.
- `is_org_member()` / `is_org_admin()` are scoped to that active org, so a master
  admin no longer matches every tenant at once. Without this, the moment a second
  tenant existed a platform admin's app would load every tenant's rows into one
  list, and new rows could be stamped with the wrong org.
- Switch with `select public.opc_set_active_org('<org id>');`
  (any org for a master admin; only your own orgs otherwise).
- New rows are stamped with the **active** org, so work done while switched into
  a tenant belongs to that tenant.
- Master admins can still *list* every organization (to switch into one) — they
  just cannot see two tenants' operational data simultaneously.

Default active org = your primary membership, so behaviour for everyone today is
unchanged.

## 9. Per-organization features

`organization_features` rows drive what a tenant can see:

| State | Meaning |
|---|---|
| row `enabled = true` | on |
| row `enabled = false` | **off — its screens disappear for that org only** |
| no row at all | *inherited* → on |

The "no row = inherited" rule is a deliberate deviation from "no row = off":
these are core ERP modules, so a brand-new tenant gets a working app and the
admin switches OFF what they don't want, rather than starting with a blank
screen. The live organization was seeded with explicit `true` rows by `022`.

Toggle from **Settings → Organization features**, or in SQL:
```sql
select public.opc_set_org_feature('<org id>', 'surplus_pool', false);
```
`FEATURE_ROUTES` in `frontend/src/permissions.jsx` maps a feature key to the nav
routes it controls; both the sidebar and `canAccess()` honour it.

---

## 10. Duplication across organizations — what collides and what doesn't

| Thing | Can two orgs both have it? | Why |
|---|---|---|
| Document numbers (`SO/FY26/0001`, `INQ/…`, `PO/…`, `GRN/…`) | **Yes** | No unique constraint on `so_no`/`src_no`/`po_no`/`grn_no` — each org numbers independently and identical numbers never clash. |
| Record ids (`sales_orders.id`, etc.) | n/a | Client-generated from `Date.now()`, globally unique in practice. |
| Customer / vendor **names** | **Yes** | Only `id` is unique; names are free text. |
| Catalogue ids (`products.id`, `categories.id`, BOM per category) | **Yes — since `023`** | Keys are now `(organization_id, id)`. Before this they were global, so the 2nd tenant to write master data would have hit a PK violation. |
| **User email** | **No — by design** | `users.email` (and Supabase Auth) is globally unique: one email = one login = one person. That person can belong to **many** organizations via `organization_memberships`; they just can't have two separate accounts on the same address. |
| Subdomain | **No** | Enforced case-insensitively by `idx_orgs_subdomain_lower_unique`, plus the `reserved_subdomains` list. |
| Org slug | **No** | `organizations.slug` is unique. |

So: an org's data is invisible to other orgs, **and** nothing an org creates can be
blocked by another org already having used that name or number — the only
deliberate global uniques are login email, org slug and subdomain.
