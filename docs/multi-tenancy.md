# Multi-tenancy — one deployment, many companies

One database, one frontend, many organizations. Two questions are kept separate
because they are genuinely different:

| Question | Answered by |
|---|---|
| What can this company **see**? | feature flags (`organization_features`) |
| How does this company **work**? | workflow profile (`workflow_profiles`) |
| What can this company **read/write**? | **RLS**, on membership — never on hostname |

---

## Isolation

Data access is decided **server-side** by row-level security against
`organization_memberships` joined on `auth.uid()`. The subdomain is a
branding/UX signal only and is never trusted.

```sql
create policy tenant_all_<table> on public.<table> for all to authenticated
  using      (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
```

Everyone — including platform admins — works in **one organization at a time**
(`active_org_id()`), and column defaults stamp it automatically.

**Rules for every new table:**
1. `organization_id uuid not null references organizations(id) on delete cascade
   default public.active_org_id()`
2. Enable RLS and add the `tenant_all_` policy above.
3. `revoke all from anon`.
4. Any service-key insert must set `organization_id` explicitly — the default
   only works for a real signed-in user.

Master data uses composite keys `(organization_id, id)` so two organizations can
legitimately hold the same product code without colliding.

---

## Workflow profiles

Behaviour lives in data, so a new kind of company is an INSERT, not a release.

```
workflow_profiles                       preset catalogue
organizations.workflow_profile          which preset an org runs
organization_settings.data->'workflow'  per-org overrides

effective = preset defaults || overrides        (override wins)
```

Delivered to the browser by `opc_my_context()` as `window.__opcWorkflow`, read
through the `wf()` / `wfOn()` / `wfReceiving()` helpers.

**Every consumer must fall back to the historic behaviour when a key is absent.**
A failed context load, an old cached tab, or an org with no profile must behave
exactly as before — never blank, never a new behaviour by accident.

Never hard-code a role name into a receiving / PO / dispatch path. Read the
setting. See [microlink-procurement-flow.md](./microlink-procurement-flow.md) for
a company whose receiving runs in the opposite direction.

---

## Feature flags

`featureOn(key)` — **absent means inherited (on)**, only an explicit `false`
switches something off. A deliberate deviation from "default deny": a brand-new
tenant with no rows must not open to an empty application.

---

## Things that are per-organization and easy to forget

These are not table rows, so RLS does not protect them. They live on `window`
and **must be cleared when the user or the organization changes**:

| Global | Holds |
|---|---|
| `__opcFeatures` | capability flags |
| `__opcWorkflow` | workflow settings |
| `__opcPerms` | nav / capability customisations |
| `__opcOrg`, `__opcIsMaster` | tenant context |

Cached state in `localStorage` is stamped with `__uid` / `__orgId` and purged
when either changes.

> This bit has bitten twice. `__opcPerms` was left in place across a sign-out, so
> one company's menu applied to the next user's session — and because the config
> effect returns early for an org that has no config row yet (every brand-new
> organization), it never got overwritten. When that stale object was missing a
> field, the shell threw and **every page went white**. The lesson is not "add a
> null check": anything cached per-organization outside the database needs an
> explicit reset path, and that path needs a test.

`scripts/uitest/render-check.js` renders the whole app for every role and route,
including with a previous tenant's partial blob still present.

---

## Subdomains

`<slug>.ops-central.unimisk.com`, assigned from the platform console, which also
provisions the host with Vercel and Cloudflare. Hosts are registered
per-subdomain: a wildcard would require moving nameservers to Vercel.

TLS for tenant hosts is issued by **Vercel**, not Cloudflare — those records are
DNS-only, so Cloudflare's one-level Universal SSL limit does not apply.

---

## Verifying

```bash
SSH_PASSWORD='…' python scripts/ssh-test-tenant-isolation.py
SSH_PASSWORD='…' python scripts/ssh-verify-workflow-profiles.py
node scripts/uitest/render-check.js frontend
```

Run isolation checks **as a real tenant user** (`role=authenticated` plus that
user's JWT claim), never as superuser — superuser bypasses RLS, and a test that
bypasses the thing it is testing always passes.
